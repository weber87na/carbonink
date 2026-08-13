/**
 * Integrity tests for the real-company demo packs in src/main/data/demo/.
 *
 * These packs carry figures transcribed from published sustainability reports,
 * so the tests here are less about code behaviour than about keeping the data
 * honest as it is edited:
 *
 *   - every factor_code, unit and fuel_code still exists in the seeded library;
 *   - every activity row still converts (a pack row that cannot reach its EF's
 *     input unit is a broken row, not a runtime surprise);
 *   - a row claiming to be `disclosed` really does carry the published number
 *     verbatim, and a `derived` row's arithmetic actually reproduces from the
 *     disclosed figure it cites;
 *   - the packs still reconcile against what the companies published, within
 *     the tolerance each pack states and in the direction it states.
 *
 * That last group doubles as a regression net on the calculation chain itself.
 * CATL's electricity line is 13.7 TWh against the MEE national grid factor and
 * lands within ~2% of an audited disclosure — if unit conversion, EF pinning or
 * CalculationService drifts, that assertion goes first.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '@main/db/migrate';
import { CalculationService } from '@main/services/calculation-service';
import { UnitConversionService } from '@main/services/unit-conversion-service';
import type { PinnedEmissionFactor } from '@shared/types';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Note: this test deliberately does NOT live in a `tests/main/data/` folder —
// .gitignore has a blanket `data/` rule, so a test file there would never be
// committed. The negation only covers desktop/src/main/data.
const DEMO_DIR = fileURLToPath(new URL('../../src/main/data/demo', import.meta.url));

type Provenance = {
  kind: 'disclosed' | 'derived' | 'modeled';
  source_ref: string;
  locator: string;
  disclosed?: { value: number; unit: string };
  derivation?: {
    op: string;
    lhv_mj_per_m3?: number;
    lhv_mj_per_kg?: number;
    density_kg_per_l?: number;
    factor?: number;
  };
  assumption?: string;
};

type Pack = {
  pack_id: string;
  schema_version: number;
  label: { zh: string; en: string };
  archetype: string;
  sources: Array<{ ref: string; publisher: string; title: string; url: string }>;
  organization: { country_code: string; boundary_kind: string };
  sites: Array<{ key: string; country_code: string; carries_activity?: boolean }>;
  reporting_periods: Array<{ key: string; year: number; granularity: string }>;
  emission_sources: Array<{ key: string; site: string; scope: 1 | 2 | 3; name: string }>;
  activities: Array<{
    source: string;
    period: string;
    amount: number;
    unit: string;
    fuel_code: string | null;
    ef: string;
    provenance: Provenance;
  }>;
  disclosed_totals: Array<Record<string, unknown>>;
  expected_reconciliation?: Array<{
    period: string;
    scope: 1 | 2 | 3;
    compare_to: string;
    expect_within_pct: number | null;
    expect_direction?: 'below' | 'above';
    why: string;
  }>;
  gaps?: Array<{ item: string; reason: string }>;
};

const packFiles = readdirSync(DEMO_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
const packs: Pack[] = packFiles.map(
  (f) => JSON.parse(readFileSync(join(DEMO_DIR, f), 'utf8')) as Pack,
);
const index = JSON.parse(readFileSync(join(DEMO_DIR, 'index.json'), 'utf8')) as {
  packs: Array<{ pack_id: string; file: string }>;
};

let db: Database.Database;
let calc: CalculationService;

beforeAll(() => {
  db = new Database(':memory:');
  runMigrations(db);
  calc = new CalculationService({ unitConversion: new UnitConversionService({ db }) });
});

afterAll(() => {
  db.close();
});

/** emission_factor and pinned_emission_factor share every column the calc reads. */
function loadEf(code: string): PinnedEmissionFactor {
  const row = db.prepare('SELECT * FROM emission_factor WHERE factor_code = ?').get(code);
  return row as unknown as PinnedEmissionFactor;
}

function countEf(code: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM emission_factor WHERE factor_code = ?')
    .get(code) as {
    n: number;
  };
  return row.n;
}

/** Resolves 'scope3_by_category_tco2e.6' against a disclosed_totals entry. */
function readPath(obj: Record<string, unknown>, path: string): number | undefined {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return typeof cur === 'number' ? cur : undefined;
}

describe('demo pack registry', () => {
  it('index.json lists exactly the packs present on disk', () => {
    expect(index.packs.map((p) => p.file).sort()).toEqual([...packFiles].sort());
    expect(index.packs.map((p) => p.pack_id).sort()).toEqual(packs.map((p) => p.pack_id).sort());
  });

  it('ships at least the four archetypes the demos rely on', () => {
    expect(packs.length).toBeGreaterThanOrEqual(4);
    const archetypes = packs.map((p) => p.archetype);
    expect(new Set(archetypes).size).toBe(archetypes.length);
  });
});

describe.each(packs.map((p) => [p.pack_id, p] as const))('demo pack %s', (_id, pack) => {
  it('declares the fields the loader depends on', () => {
    expect(pack.schema_version).toBe(1);
    expect(pack.label.en).toBeTruthy();
    expect(pack.label.zh).toBeTruthy();
    expect(pack.sources.length).toBeGreaterThan(0);
    for (const s of pack.sources) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.publisher).toBeTruthy();
    }
    expect(['equity_share', 'financial_control', 'operational_control']).toContain(
      pack.organization.boundary_kind,
    );
  });

  it('resolves every internal key reference', () => {
    const siteKeys = new Set(pack.sites.map((s) => s.key));
    const periodKeys = new Set(pack.reporting_periods.map((p) => p.key));
    const sourceKeys = new Set(pack.emission_sources.map((s) => s.key));

    for (const s of pack.emission_sources) {
      expect(siteKeys, `source ${s.key} -> site ${s.site}`).toContain(s.site);
    }
    for (const a of pack.activities) {
      expect(sourceKeys, `activity -> source ${a.source}`).toContain(a.source);
      expect(periodKeys, `activity -> period ${a.period}`).toContain(a.period);
    }
    // A site that carries activity must say so — the flag is what tells a
    // reader that the other sites are real places with no published data,
    // rather than places we forgot to fill in.
    const carrying = new Set(pack.emission_sources.map((s) => s.site));
    for (const site of pack.sites) {
      if (carrying.has(site.key)) {
        expect(site.carries_activity, `site ${site.key} carries activity`).toBe(true);
      }
    }
  });

  it('references only emission factors that exist and are unambiguous', () => {
    for (const code of new Set(pack.activities.map((a) => a.ef))) {
      expect(countEf(code), `EF ${code} must resolve to exactly one library row`).toBe(1);
    }
  });

  it('converts every activity row into its factor unit', () => {
    for (const a of pack.activities) {
      const ef = loadEf(a.ef);
      const run = () =>
        calc.compute({
          amount: a.amount,
          unit: a.unit,
          ef,
          ...(a.fuel_code ? { fuelCode: a.fuel_code } : {}),
        });
      expect(run, `${pack.pack_id} ${a.source} ${a.period}`).not.toThrow();
      const out = run();
      expect(out.co2e_kg).toBeGreaterThan(0);
      expect(Number.isFinite(out.co2e_kg)).toBe(true);
    }
  });

  it('labels every row with provenance that points at a real source', () => {
    const refs = new Set(pack.sources.map((s) => s.ref));
    for (const a of pack.activities) {
      const p = a.provenance;
      expect(['disclosed', 'derived', 'modeled']).toContain(p.kind);
      expect(refs, `provenance.source_ref ${p.source_ref}`).toContain(p.source_ref);
      expect(p.locator, `${a.source} ${a.period} locator`).toBeTruthy();
      expect(p.disclosed?.value, `${a.source} ${a.period} disclosed value`).toBeTypeOf('number');
      expect(p.disclosed?.unit).toBeTruthy();
      // A modeled row without a stated assumption is just an unlabelled guess.
      if (p.kind === 'modeled') {
        expect(p.assumption, `${a.source} ${a.period} must state its assumption`).toBeTruthy();
      }
      // A derived row must show its work.
      if (p.kind === 'derived') {
        expect(p.derivation, `${a.source} ${a.period} must carry its derivation`).toBeTruthy();
      }
    }
  });

  it('reproduces every stated number from the figure it cites', () => {
    for (const a of pack.activities) {
      const p = a.provenance;
      const disclosed = p.disclosed?.value;
      if (typeof disclosed !== 'number') continue;

      if (!p.derivation) {
        // No derivation claimed, so the amount must be the published figure
        // untouched. This is the invariant that keeps 'disclosed' meaningful.
        expect(a.amount, `${pack.pack_id} ${a.source} ${a.period} must be verbatim`).toBe(
          disclosed,
        );
        continue;
      }

      const d = p.derivation;
      let expected: number;
      switch (d.op) {
        case 'energy_to_volume_via_lhv_per_m3': {
          const lhv = d.lhv_mj_per_m3;
          expect(lhv, `${a.source} needs lhv_mj_per_m3`).toBeTypeOf('number');
          expected = (disclosed * 3600) / (lhv as number);
          break;
        }
        case 'energy_to_volume_via_lhv_and_density': {
          const lhv = d.lhv_mj_per_kg;
          const density = d.density_kg_per_l;
          expect(lhv, `${a.source} needs lhv_mj_per_kg`).toBeTypeOf('number');
          expect(density, `${a.source} needs density_kg_per_l`).toBeTypeOf('number');
          expected = (disclosed * 3600) / (lhv as number) / (density as number);
          break;
        }
        case 'scale': {
          const factor = d.factor;
          expect(factor, `${a.source} needs factor`).toBeTypeOf('number');
          expected = disclosed * (factor as number);
          break;
        }
        default:
          throw new Error(`Unknown derivation op in ${pack.pack_id}: ${d.op}`);
      }
      // Packs store derived amounts rounded to 2dp.
      expect(a.amount, `${pack.pack_id} ${a.source} ${a.period} derivation`).toBeCloseTo(
        expected,
        1,
      );
    }
  });

  it('still reconciles against what the company published', () => {
    for (const r of pack.expected_reconciliation ?? []) {
      if (r.expect_within_pct === null) continue;

      const disclosedRow = pack.disclosed_totals.find((d) => d.period === r.period);
      expect(disclosedRow, `${pack.pack_id} disclosed_totals for ${r.period}`).toBeTruthy();
      if (!disclosedRow) continue;
      const disclosed = readPath(disclosedRow, r.compare_to);
      expect(disclosed, `${pack.pack_id} ${r.compare_to}`).toBeTypeOf('number');
      if (typeof disclosed !== 'number') continue;

      const scopeOf = new Map(pack.emission_sources.map((s) => [s.key, s.scope]));
      let kg = 0;
      for (const a of pack.activities) {
        if (a.period !== r.period || scopeOf.get(a.source) !== r.scope) continue;
        kg += calc.compute({
          amount: a.amount,
          unit: a.unit,
          ef: loadEf(a.ef),
          ...(a.fuel_code ? { fuelCode: a.fuel_code } : {}),
        }).co2e_kg;
      }

      const computedT = kg / 1000;
      const deltaPct = ((computedT - disclosed) / disclosed) * 100;
      const label = `${pack.pack_id} ${r.period} scope ${r.scope}: computed ${computedT.toFixed(0)} vs disclosed ${disclosed} (${deltaPct.toFixed(1)}%)`;

      expect(Math.abs(deltaPct), label).toBeLessThanOrEqual(r.expect_within_pct);
      if (r.expect_direction === 'below') expect(deltaPct, label).toBeLessThan(0);
      if (r.expect_direction === 'above') expect(deltaPct, label).toBeGreaterThan(0);
    }
  });

  it('explains anything it could not load', () => {
    for (const g of pack.gaps ?? []) {
      expect(g.item).toBeTruthy();
      expect(g.reason.length, `gap "${g.item}" needs a real reason`).toBeGreaterThan(40);
    }
  });
});
