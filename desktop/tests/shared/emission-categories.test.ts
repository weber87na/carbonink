import {
  categoriesForScope,
  EMISSION_CATEGORIES,
  efCategoryForCode,
  emissionCategoryLabel,
  findEmissionCategory,
} from '@shared/emission-categories';
import { describe, expect, it } from 'vitest';

/**
 * The taxonomy is a data table transcribed from two published standards,
 * so the tests that matter are structural: does it still say what the
 * standards say, and do the codes stay stable for rows that reference
 * them?
 */
describe('emission category taxonomy', () => {
  it('has unique, immutable codes', () => {
    const codes = EMISSION_CATEGORIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    // Codes are stored in emission_source.ghg_protocol_path. Renaming one
    // orphans every row pointing at it, so the prefix convention is
    // pinned here on purpose.
    for (const c of EMISSION_CATEGORIES) {
      expect(c.code.startsWith(`scope${c.scope}.`)).toBe(true);
    }
  });

  it('covers the GHG Protocol categories exactly once per scope', () => {
    // Scope 1: the Corporate Standard's four direct-emission types.
    expect(categoriesForScope(1)).toHaveLength(4);
    // Scope 2: the four purchased-energy types.
    expect(categoriesForScope(2)).toHaveLength(4);
    // Scope 3: all 15 numbered categories, no gaps, no duplicates.
    const numbers = categoriesForScope(3)
      .map((c) => c.ghgpNumber)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('numbers only scope 3 — the standard does not number scope 1/2', () => {
    for (const c of EMISSION_CATEGORIES) {
      if (c.scope === 3) expect(c.ghgpNumber).toBeGreaterThan(0);
      else expect(c.ghgpNumber).toBeUndefined();
    }
  });

  it('applies the ISO 14064-1 crosswalk', () => {
    const isoFor = (code: string) => findEmissionCategory(code)?.isoCategory;
    // C1 ← scope 1, C2 ← scope 2.
    for (const c of categoriesForScope(1)) expect(c.isoCategory).toBe(1);
    for (const c of categoriesForScope(2)) expect(c.isoCategory).toBe(2);

    // C3 transport ← cat 4, 6, 7, 9.
    expect(isoFor('scope3.cat4_upstream_transportation')).toBe(3);
    expect(isoFor('scope3.cat6_business_travel')).toBe(3);
    expect(isoFor('scope3.cat7_employee_commuting')).toBe(3);
    expect(isoFor('scope3.cat9_downstream_transportation')).toBe(3);

    // C4 products used by the org ← cat 1, 2, 3, 5, 8.
    expect(isoFor('scope3.cat1_purchased_goods')).toBe(4);
    expect(isoFor('scope3.cat2_capital_goods')).toBe(4);
    expect(isoFor('scope3.cat3_fuel_energy_related')).toBe(4);
    expect(isoFor('scope3.cat5_waste_generated')).toBe(4);
    expect(isoFor('scope3.cat8_upstream_leased_assets')).toBe(4);

    // C5 use of the org's products ← cat 10–14. C6 other ← cat 15.
    for (const n of [10, 11, 12, 13, 14]) {
      const cat = categoriesForScope(3).find((c) => c.ghgpNumber === n);
      expect(cat?.isoCategory).toBe(5);
    }
    expect(isoFor('scope3.cat15_investments')).toBe(6);
  });

  it('ships both locales for every entry', () => {
    for (const c of EMISSION_CATEGORIES) {
      expect(c.labelEn.length).toBeGreaterThan(0);
      expect(c.labelZh.length).toBeGreaterThan(0);
    }
  });

  it('prefixes scope 3 labels with the standard number', () => {
    const label = (code: string, locale: 'en' | 'zh-CN') => {
      const cat = findEmissionCategory(code);
      return cat ? emissionCategoryLabel(cat, locale) : null;
    };

    expect(label('scope3.cat6_business_travel', 'zh-CN')).toBe('3.6 商务差旅');
    expect(label('scope3.cat6_business_travel', 'en')).toBe('3.6 Business travel');

    // Scope 1/2 carry no number, so the label is the bare name.
    expect(label('scope1.mobile_combustion', 'zh-CN')).toBe('移动燃烧');
    expect(label('scope1.mobile_combustion', 'en')).toBe('Mobile combustion');
  });

  describe('EF join key', () => {
    it('maps to a prefix the EF catalog actually uses', () => {
      // These are the prefixes EfService.list matches with
      // `category = ? OR category LIKE '<cat>.%'` against the seeded
      // emission_factor rows (migrations 008 + 011). A typo here silently
      // empties the candidate pool, so they're pinned.
      expect(efCategoryForCode('scope1.stationary_combustion')).toBe('fuel.stationary');
      expect(efCategoryForCode('scope1.mobile_combustion')).toBe('fuel.mobile');
      expect(efCategoryForCode('scope2.purchased_electricity')).toBe('electricity');
      expect(efCategoryForCode('scope3.cat1_purchased_goods')).toBe('purchase');
      expect(efCategoryForCode('scope3.cat4_upstream_transportation')).toBe('freight');
      expect(efCategoryForCode('scope3.cat6_business_travel')).toBe('travel');
    });

    it('returns null where the catalog has no factors', () => {
      // Null, not a dead string: an unmatched category filters the pool to
      // nothing, whereas null leaves the matcher its scope-wide pool.
      expect(efCategoryForCode('scope1.process_emissions')).toBeNull();
      expect(efCategoryForCode('scope3.cat15_investments')).toBeNull();
    });

    it('returns null for unknown or empty input', () => {
      expect(efCategoryForCode(null)).toBeNull();
      expect(efCategoryForCode('')).toBeNull();
      expect(efCategoryForCode('fuel.mobile')).toBeNull(); // a category, not a code
    });
  });

  it('scopes lookups — categoriesForScope never leaks across scopes', () => {
    for (const scope of [1, 2, 3] as const) {
      for (const c of categoriesForScope(scope)) {
        expect(c.scope).toBe(scope);
      }
    }
  });
});
