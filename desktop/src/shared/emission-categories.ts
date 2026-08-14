/**
 * Canonical emission-source category taxonomy.
 *
 * One vocabulary, keyed by the reporting standard rather than by whatever
 * the EF catalog happened to be tagged with. Every source-category picker
 * in the app reads from here.
 *
 * ## Why the standard drives the vocabulary
 *
 * CDP / CSRD / ISSB disclosure tables are laid out by GHG Protocol
 * category number, and CarbonInk emits ISO 14064-1 reports, which group by
 * the ISO categories. The list a user picks from therefore isn't a product
 * choice — it's dictated by what has to come out the other end. So the
 * taxonomy is:
 *
 *  - Scope 1 — the GHG Protocol Corporate Standard's four direct-emission
 *    types (stationary / mobile combustion, process, fugitive)
 *  - Scope 2 — the four purchased-energy types. Note that location- vs
 *    market-based is a *methodology* axis, not a source type; it is not
 *    modelled here (legacy rows carrying `scope2.location` /
 *    `scope2.market` still render — see `category-labels.ts`).
 *  - Scope 3 — the 15 numbered categories, upstream 1–8 / downstream 9–15,
 *    mutually exclusive by design so value-chain partners don't
 *    double-count.
 *
 * ## The two stored fields
 *
 * `code` is what lands in `emission_source.ghg_protocol_path` — it extends
 * the vocabulary already present in demo data and the EF seeds
 * (`scope1.mobile_combustion`, `scope3.cat6_business_travel`).
 *
 * `efCategory` is the *internal join key* written to
 * `emission_source.category`. `EfService.list` narrows the candidate pool
 * with `category = ? OR category LIKE '<cat>.%'`, matching against the EF
 * table's own (looser, older, self-inconsistent) vocabulary. Mapping the
 * standard code to an EF prefix keeps that filter working — and fixes
 * sources whose category never matched anything, which silently produced
 * zero EF recommendations.
 *
 * `efCategory` is deliberately **undefined** where the bundled EF catalog
 * has no coverage. Writing a dead string would filter the pool down to
 * nothing; writing nothing at all leaves the matcher with the scope-wide
 * pool, which is the useful fallback.
 *
 * ## Why labels live here and not in paraglide
 *
 * Same rationale as `renderer/lib/category-labels.ts`: these are domain
 * term mappings maintained by engineers against a published standard, not
 * UI prose needing a translator workflow. Keeping ~25 pairs out of the
 * paraglide tree keeps the translator queue readable. The surrounding
 * chrome (field labels, placeholders, the "non-standard" badge) *is* in
 * paraglide.
 */

export type Scope = 1 | 2 | 3;

/** ISO 14064-1:2018 emission category number. */
export type IsoCategory = 1 | 2 | 3 | 4 | 5 | 6;

export type EmissionCategory = {
  /**
   * Stable code. Stored verbatim in `emission_source.ghg_protocol_path`.
   * Never renamed — existing rows reference it.
   */
  code: string;
  scope: Scope;
  /**
   * GHG Protocol Scope 3 category number (1–15). Absent for scope 1/2,
   * which the standard doesn't number.
   */
  ghgpNumber?: number;
  isoCategory: IsoCategory;
  labelEn: string;
  labelZh: string;
  /**
   * EF-catalog category prefix written to `emission_source.category`.
   * Undefined where the bundled catalog has no factors for this category
   * — see the module header.
   */
  efCategory?: string;
  /** Extra search terms (both locales) beyond the labels themselves. */
  keywords?: string[];
};

/**
 * GHG Protocol → ISO 14064-1 crosswalk, applied below.
 *
 *   ISO C1 ← Scope 1
 *   ISO C2 ← Scope 2
 *   ISO C3 (transport)                ← Scope 3 cat 4, 6, 7, 9
 *   ISO C4 (products used by the org) ← Scope 3 cat 1, 2, 3, 5, 8
 *   ISO C5 (use of the org's products)← Scope 3 cat 10, 11, 12, 13, 14
 *   ISO C6 (other)                    ← Scope 3 cat 15
 */
export const EMISSION_CATEGORIES: readonly EmissionCategory[] = [
  // --- Scope 1 — direct emissions (ISO C1) ------------------------------
  {
    code: 'scope1.stationary_combustion',
    scope: 1,
    isoCategory: 1,
    labelEn: 'Stationary combustion',
    labelZh: '固定燃烧',
    efCategory: 'fuel.stationary',
    keywords: ['boiler', 'furnace', 'natural gas', 'coal', '锅炉', '窑炉', '天然气', '燃煤'],
  },
  {
    code: 'scope1.mobile_combustion',
    scope: 1,
    isoCategory: 1,
    labelEn: 'Mobile combustion',
    labelZh: '移动燃烧',
    efCategory: 'fuel.mobile',
    keywords: ['fleet', 'vehicle', 'diesel', 'gasoline', '车队', '公务车', '柴油', '汽油', '叉车'],
  },
  {
    code: 'scope1.process_emissions',
    scope: 1,
    isoCategory: 1,
    labelEn: 'Process emissions',
    labelZh: '工艺过程排放',
    keywords: ['cement', 'calcination', 'chemical', '水泥', '煅烧', '碳酸盐', '化工'],
  },
  {
    code: 'scope1.fugitive_emissions',
    scope: 1,
    isoCategory: 1,
    labelEn: 'Fugitive emissions',
    labelZh: '逸散排放',
    keywords: ['refrigerant', 'sf6', 'leak', '制冷剂', '冷媒', '泄漏', '六氟化硫'],
  },

  // --- Scope 2 — imported energy (ISO C2) -------------------------------
  {
    code: 'scope2.purchased_electricity',
    scope: 2,
    isoCategory: 2,
    labelEn: 'Purchased electricity',
    labelZh: '外购电力',
    efCategory: 'electricity',
    keywords: ['grid', 'power', '电网', '用电', '购电'],
  },
  {
    code: 'scope2.purchased_heat',
    scope: 2,
    isoCategory: 2,
    labelEn: 'Purchased heat',
    labelZh: '外购热力',
    keywords: ['district heating', 'hot water', '集中供热', '热水'],
  },
  {
    code: 'scope2.purchased_steam',
    scope: 2,
    isoCategory: 2,
    labelEn: 'Purchased steam',
    labelZh: '外购蒸汽',
    keywords: ['steam', '蒸汽'],
  },
  {
    code: 'scope2.purchased_cooling',
    scope: 2,
    isoCategory: 2,
    labelEn: 'Purchased cooling',
    labelZh: '外购冷力',
    keywords: ['chilled water', 'district cooling', '冷冻水', '集中供冷'],
  },

  // --- Scope 3 upstream — categories 1–8 --------------------------------
  {
    code: 'scope3.cat1_purchased_goods',
    scope: 3,
    ghgpNumber: 1,
    isoCategory: 4,
    labelEn: 'Purchased goods and services',
    labelZh: '采购的商品和服务',
    efCategory: 'purchase',
    keywords: ['supplier', 'materials', 'procurement', '供应商', '原材料', '采购', '服务'],
  },
  {
    code: 'scope3.cat2_capital_goods',
    scope: 3,
    ghgpNumber: 2,
    isoCategory: 4,
    labelEn: 'Capital goods',
    labelZh: '资本商品',
    keywords: ['equipment', 'machinery', 'buildings', '设备', '机器', '厂房', '固定资产'],
  },
  {
    code: 'scope3.cat3_fuel_energy_related',
    scope: 3,
    ghgpNumber: 3,
    isoCategory: 4,
    labelEn: 'Fuel- and energy-related activities',
    labelZh: '燃料和能源相关活动',
    keywords: ['wtt', 't&d losses', 'upstream fuel', '燃料上游', '输配电损耗'],
  },
  {
    code: 'scope3.cat4_upstream_transportation',
    scope: 3,
    ghgpNumber: 4,
    isoCategory: 3,
    labelEn: 'Upstream transportation and distribution',
    labelZh: '上游运输和配送',
    efCategory: 'freight',
    keywords: ['inbound freight', 'logistics', '入厂物流', '货运', '仓储'],
  },
  {
    code: 'scope3.cat5_waste_generated',
    scope: 3,
    ghgpNumber: 5,
    isoCategory: 4,
    labelEn: 'Waste generated in operations',
    labelZh: '运营中产生的废弃物',
    keywords: ['landfill', 'incineration', 'wastewater', '填埋', '焚烧', '污水', '固废'],
  },
  {
    code: 'scope3.cat6_business_travel',
    scope: 3,
    ghgpNumber: 6,
    isoCategory: 3,
    labelEn: 'Business travel',
    labelZh: '商务差旅',
    efCategory: 'travel',
    keywords: ['flight', 'hotel', 'rail', 'taxi', '机票', '酒店', '高铁', '出差'],
  },
  {
    code: 'scope3.cat7_employee_commuting',
    scope: 3,
    ghgpNumber: 7,
    isoCategory: 3,
    labelEn: 'Employee commuting',
    labelZh: '员工通勤',
    keywords: ['commute', 'remote work', '通勤', '班车', '居家办公'],
  },
  {
    code: 'scope3.cat8_upstream_leased_assets',
    scope: 3,
    ghgpNumber: 8,
    isoCategory: 4,
    labelEn: 'Upstream leased assets',
    labelZh: '上游租赁资产',
    keywords: ['leased', '租入', '租赁'],
  },

  // --- Scope 3 downstream — categories 9–15 -----------------------------
  {
    code: 'scope3.cat9_downstream_transportation',
    scope: 3,
    ghgpNumber: 9,
    isoCategory: 3,
    labelEn: 'Downstream transportation and distribution',
    labelZh: '下游运输和配送',
    efCategory: 'freight',
    keywords: ['outbound freight', 'delivery', '出厂物流', '配送', '末端配送'],
  },
  {
    code: 'scope3.cat10_processing_of_sold_products',
    scope: 3,
    ghgpNumber: 10,
    isoCategory: 5,
    labelEn: 'Processing of sold products',
    labelZh: '售出产品的加工',
    keywords: ['downstream processing', '下游加工', '客户加工'],
  },
  {
    code: 'scope3.cat11_use_of_sold_products',
    scope: 3,
    ghgpNumber: 11,
    isoCategory: 5,
    labelEn: 'Use of sold products',
    labelZh: '售出产品的使用',
    keywords: ['use phase', '使用阶段', '产品用电'],
  },
  {
    code: 'scope3.cat12_end_of_life_treatment',
    scope: 3,
    ghgpNumber: 12,
    isoCategory: 5,
    labelEn: 'End-of-life treatment of sold products',
    labelZh: '售出产品的报废处理',
    keywords: ['disposal', 'recycling', '报废', '回收', '处置'],
  },
  {
    code: 'scope3.cat13_downstream_leased_assets',
    scope: 3,
    ghgpNumber: 13,
    isoCategory: 5,
    labelEn: 'Downstream leased assets',
    labelZh: '下游租赁资产',
    keywords: ['leased out', '租出', '出租'],
  },
  {
    code: 'scope3.cat14_franchises',
    scope: 3,
    ghgpNumber: 14,
    isoCategory: 5,
    labelEn: 'Franchises',
    labelZh: '特许经营',
    keywords: ['franchise', '加盟', '门店'],
  },
  {
    code: 'scope3.cat15_investments',
    scope: 3,
    ghgpNumber: 15,
    isoCategory: 6,
    labelEn: 'Investments',
    labelZh: '投资',
    keywords: ['financed emissions', 'portfolio', 'pcaf', '投融资排放', '资产组合'],
  },
];

const BY_CODE = new Map(EMISSION_CATEGORIES.map((c) => [c.code, c]));

/** The taxonomy entry for a stored `ghg_protocol_path`, or null. */
export function findEmissionCategory(code: string | null | undefined): EmissionCategory | null {
  if (!code) return null;
  return BY_CODE.get(code) ?? null;
}

/** Categories valid under one scope, in standard order. */
export function categoriesForScope(scope: Scope): EmissionCategory[] {
  return EMISSION_CATEGORIES.filter((c) => c.scope === scope);
}

/**
 * The `emission_source.category` value a picked code implies. `null` for
 * categories the bundled EF catalog doesn't cover — see the module header
 * on why that beats writing a dead string.
 */
export function efCategoryForCode(code: string | null | undefined): string | null {
  return findEmissionCategory(code)?.efCategory ?? null;
}

/**
 * Display label. Scope 3 entries are prefixed with their standard number
 * (`3.6 商务差旅`) because that numbering is how CDP/CSRD tables — and
 * every consultant reviewing them — refer to the categories.
 */
export function emissionCategoryLabel(category: EmissionCategory, locale: 'en' | 'zh-CN'): string {
  const name = locale === 'zh-CN' ? category.labelZh : category.labelEn;
  return category.ghgpNumber ? `${category.scope}.${category.ghgpNumber} ${name}` : name;
}
