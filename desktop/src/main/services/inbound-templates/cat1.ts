import type { InboundTemplate } from '@shared/types';

/**
 * Cat 1 (Purchased Goods and Services) supplier disclosure template — v2.0.
 *
 * Structure follows GHG Protocol Scope 3 Standard, Chapter 7's tiered
 * preference order:
 *
 *  - **Tier 1** — supplier-specific per-unit product carbon footprint
 *    (kgCO2e/kg). Highest fidelity; used preferentially when present.
 *  - **Tier 2** — supplier-allocated company-level emissions (total Scope
 *    1+2 + allocation method + share attributable to our purchase).
 *
 * The three "meta.*" questions carry `tier: null` — they're descriptive
 * context (legal name, reporting period, inventory status) that ingest
 * doesn't translate into `activity_data` but does surface in the review
 * UI for the user to confirm the disclosure is well-formed.
 *
 * Tier 3 (supplier reports raw activity data — electricity, fuel — that
 * we convert via our public EF table) is deliberately deferred to v2.1.
 *
 * The template is hard-coded as a TypeScript constant rather than a DB
 * row because v2.0 ships exactly one template and the content is part
 * of the product, not user-authored. v2.x with multi-template + an
 * authoring UI may move templates into the DB.
 *
 * Each question's `cell_ref` (e.g. `'tier2!B5'`) is the xlsx cell address
 * where the supplier types their answer. ExcelTemplateRenderer reads
 * these to lay out the workbook on export and to look up filled values
 * on parse. Changing a `cell_ref` is a breaking change for any in-flight
 * xlsx (the sentinel sheet's `template_version` would have to bump too).
 */
export const CAT1_SUPPLIER_DISCLOSURE: InboundTemplate = {
  template_kind: 'cat1_supplier_disclosure',
  version: '1.0',
  scope: 3,
  category: 'purchased_goods',
  ghg_protocol_path: 'scope3.cat1_purchased_goods',
  questions: [
    // ----- Metadata (no tier) -------------------------------------------
    {
      position: 'meta.1',
      tier: null,
      kind: 'narrative',
      raw_zh: '請填寫貴公司法定名稱（與營業執照一致）。',
      raw_en: "Please enter your company's legal name (matching business license).",
      expected_unit: null,
      cell_ref: 'metadata!B5',
    },
    {
      position: 'meta.2',
      tier: null,
      kind: 'narrative',
      raw_zh:
        '本次填報對應的報告期間。我方採購報告期間為 {{period_year}} 年，請填寫貴公司對應的報告期間（例如 2025 曆年、2024 會計年度）。',
      raw_en:
        'Reporting period this disclosure covers. Our purchase period: {{period_year}}. Please enter your company’s corresponding reporting period (e.g. 2025 calendar year, FY2024).',
      expected_unit: null,
      cell_ref: 'metadata!B7',
    },
    {
      position: 'meta.3',
      tier: null,
      kind: 'categorical',
      raw_zh:
        '貴公司是否已編製正式的溫室氣體清冊？請填寫：無 / 自行盤查尚未查證 / 第三方查證 / 已取得 ISO 14064 / 其他。',
      raw_en:
        'Does your company maintain a formal GHG inventory? Please choose: None / Self-reported, unverified / Third-party verified / ISO 14064 certified / Other.',
      expected_unit: null,
      cell_ref: 'metadata!B9',
    },

    // ----- Tier 1: supplier-specific product carbon footprint -----------
    {
      position: 'tier1.1',
      tier: 1,
      kind: 'numerical',
      raw_zh:
        '貴公司供應我方產品的單位碳足跡（kgCO2e/kg 產品）。如有第三方 PCF 報告，請將檔案作為附件一併回傳，並在備註欄註明檔名。',
      raw_en:
        'Per-kg product carbon footprint of goods supplied to us (kgCO2e/kg). If a third-party PCF report exists, please attach it to your reply email and note the filename in the comment column.',
      expected_unit: 'kgCO2e/kg',
      cell_ref: 'tier1!B5',
    },

    // ----- Tier 2: allocated company emissions --------------------------
    {
      position: 'tier2.1',
      tier: 2,
      kind: 'numerical',
      raw_zh: '貴公司報告期間內範疇一（Scope 1）+ 範疇二（Scope 2）排放總量（kgCO2e）。',
      raw_en: "Your company's total Scope 1 + Scope 2 emissions for the reporting period (kgCO2e).",
      expected_unit: 'kgCO2e',
      cell_ref: 'tier2!B5',
    },
    {
      position: 'tier2.2',
      tier: 2,
      kind: 'categorical',
      raw_zh: '排放分配方法（按質量比例 / 按經濟價值 / 按物理量 / 其他）。',
      raw_en: 'Allocation method (mass-based / economic / physical / other).',
      expected_unit: null,
      cell_ref: 'tier2!B7',
    },
    {
      position: 'tier2.3',
      tier: 2,
      kind: 'numerical',
      raw_zh: '依上述分配方法歸屬於我方採購的排放量（kgCO2e）。',
      raw_en: 'Emissions attributable to our purchase (kgCO2e), per the allocation method above.',
      expected_unit: 'kgCO2e',
      cell_ref: 'tier2!B9',
    },
  ],
};
