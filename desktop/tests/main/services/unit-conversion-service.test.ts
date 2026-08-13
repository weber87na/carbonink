import { runMigrations } from '@main/db/migrate';
import {
  DimensionMismatchError,
  UnitConversionService,
  UnknownUnitError,
} from '@main/services/unit-conversion-service';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let db: Database.Database;
let svc: UnitConversionService;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  svc = new UnitConversionService({ db });
});

afterEach(() => db.close());

describe('UnitConversionService.normalize', () => {
  it('returns canonical unit for known unit', () => {
    expect(svc.normalize('kWh')).toEqual({ unit: 'kWh', family: 'energy' });
  });

  it('resolves chinese alias', () => {
    expect(svc.normalize('度')).toEqual({ unit: 'kWh', family: 'energy' });
    expect(svc.normalize('吨')).toEqual({ unit: 't', family: 'mass' });
    expect(svc.normalize('公里')).toEqual({ unit: 'km', family: 'distance' });
  });

  it('resolves case-insensitive english alias', () => {
    expect(svc.normalize('kwh')).toEqual({ unit: 'kWh', family: 'energy' });
    expect(svc.normalize('KG')).toEqual({ unit: 'kg', family: 'mass' });
  });

  it('throws UnknownUnitError for unknown', () => {
    expect(() => svc.normalize('foobar')).toThrow(UnknownUnitError);
  });
});

describe('UnitConversionService.convert', () => {
  it('same-unit returns same amount', () => {
    expect(svc.convert(1000, 'kWh', 'kWh')).toBe(1000);
  });

  it('kWh → MWh', () => {
    expect(svc.convert(1000, 'kWh', 'MWh')).toBeCloseTo(1, 6);
  });

  it('MJ → kWh (1 kWh = 3.6 MJ)', () => {
    expect(svc.convert(3.6, 'MJ', 'kWh')).toBeCloseTo(1, 6);
  });

  it('L → m3 (1000 L = 1 m3)', () => {
    expect(svc.convert(1000, 'L', 'm3')).toBeCloseTo(1, 6);
  });

  it('kg → t', () => {
    expect(svc.convert(1500, 'kg', 't')).toBeCloseTo(1.5, 6);
  });

  it('mile → km', () => {
    expect(svc.convert(100, 'mile', 'km')).toBeCloseTo(160.934, 3);
  });

  it('resolves alias on both sides', () => {
    expect(svc.convert(1000, '度', 'kWh')).toBe(1000);
    expect(svc.convert(1, '公吨', 'kg')).toBe(1000);
  });

  it('throws DimensionMismatchError for cross-family', () => {
    expect(() => svc.convert(100, 'kg', 'L')).toThrow(DimensionMismatchError);
  });
});

describe('UnitConversionService.convertWithFuel', () => {
  it('gasoline L → kg (density 0.745)', () => {
    expect(svc.convertWithFuel(100, 'L', 'kg', 'gasoline')).toBeCloseTo(74.5, 1);
  });

  it('natural_gas m3 → MJ (LHV 35.9)', () => {
    expect(svc.convertWithFuel(1, 'm3', 'MJ', 'natural_gas')).toBeCloseTo(35.9, 1);
  });

  it('diesel kg → MJ (LHV 43.0)', () => {
    expect(svc.convertWithFuel(1, 'kg', 'MJ', 'diesel')).toBeCloseTo(43.0, 1);
  });

  it('throws if fuel_code unknown', () => {
    expect(() => svc.convertWithFuel(1, 'L', 'kg', 'unobtanium')).toThrow();
  });

  it('throws UnknownUnitError-like error on bad fuel_code even for same-family conversion', () => {
    expect(() => svc.convertWithFuel(1, 'L', 'L', 'unobtanium')).toThrow();
  });

  it('throws if conversion path impossible (e.g. distance → mass)', () => {
    expect(() => svc.convertWithFuel(1, 'km', 'kg', 'gasoline')).toThrow();
  });
});

// Migration 022 filled two fuel_property holes that blocked the energy-
// denominated fuel figures sustainability reports actually publish. Both
// conversions below threw before it. See src/main/data/demo/README.md.
describe('UnitConversionService.convertWithFuel — energy-denominated fuel (migration 022)', () => {
  it('natural_gas MWh → m3, the unit gas is actually disclosed in', () => {
    // 1 MWh = 3600 MJ; at 35.9 MJ/m3 that is 100.28 m3.
    expect(svc.convertWithFuel(1, 'MWh', 'm3', 'natural_gas')).toBeCloseTo(100.28, 1);
  });

  it('natural_gas reaches the same m3 whether it goes via mass or via volumetric LHV', () => {
    // The per-kg and per-L values in migration 022 are derived from the row's
    // own m3 figures precisely so these two paths agree. If someone later
    // replaces 50.0697 MJ/kg with a quoted IPCC default (48.0), the ratio
    // moves ~4% and this fails — which is the point. Compared as a ratio
    // because the quantities are ~1e5, where an absolute tolerance says
    // nothing useful.
    const viaMass = svc.convertWithFuel(1000, 'MWh', 'm3', 'natural_gas');
    const direct = (1000 * 3600) / 35.9;
    expect(viaMass / direct).toBeCloseTo(1, 5);
  });

  it('jet_a MWh → L (NCV 44.1 MJ/kg, density 0.800 kg/L)', () => {
    // 3600 MJ / 44.1 MJ/kg = 81.63 kg; / 0.800 kg/L = 102.04 L.
    expect(svc.convertWithFuel(1, 'MWh', 'L', 'jet_a')).toBeCloseTo(102.04, 1);
  });

  it('jet_a L → kg (density 0.800)', () => {
    expect(svc.convertWithFuel(100, 'L', 'kg', 'jet_a')).toBeCloseTo(80, 1);
  });
});

describe('UnitConversionService.listAll', () => {
  it('returns at least the canonical units (kWh, L, kg, km)', () => {
    const all = svc.listAll();
    const units = new Set(all.map((u) => u.unit));
    expect(units.has('kWh')).toBe(true);
    expect(units.has('L')).toBe(true);
    expect(units.has('kg')).toBe(true);
    expect(units.has('km')).toBe(true);
  });

  it('is ordered by (family, display_order, unit)', () => {
    const all = svc.listAll();
    // For each consecutive pair, assert the sort invariant.
    for (let i = 1; i < all.length; i += 1) {
      const prev = all[i - 1];
      const curr = all[i];
      if (!prev || !curr) throw new Error('unreachable');
      if (prev.family === curr.family) {
        expect(prev.display_order).toBeLessThanOrEqual(curr.display_order);
      } else {
        // family changes — `prev.family` must lex-sort before `curr.family`.
        expect(prev.family < curr.family).toBe(true);
      }
    }
  });
});

describe('UnitConversionService.isCompatible', () => {
  it('returns true for same family', () => {
    expect(svc.isCompatible('kWh', 'MJ')).toBe(true);
  });

  it('returns false for different family', () => {
    expect(svc.isCompatible('kg', 'L')).toBe(false);
  });

  it('works with aliases', () => {
    expect(svc.isCompatible('度', 'GJ')).toBe(true);
  });
});
