import type { ReportNarrative } from '@main/llm/report-narrative';
import type { InventoryReportData } from '@main/services/report-data-service';
import { writeAppendixXlsx } from '@main/services/report-export-service';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

function fakeData(): InventoryReportData {
  return {
    org: {
      id: 'org-1',
      name_zh: '测试',
      name_en: 'Test',
      industry: null,
      country_code: 'CN',
      boundary_kind: 'operational_control',
      responsible: { name: '张三', role: null },
    },
    period: {
      id: 'per-2025',
      year: 2025,
      granularity: 'annual',
      start: '2025-01-01',
      end: '2025-12-31',
      is_base_year: false,
      significant_changes_text: null,
    },
    sites: [{ id: 'site-1', name_zh: '北京', name_en: 'Beijing', address: null }],
    scope_totals: { scope1_kg: 100, scope2_kg: 200, scope3_kg: 50, total_kg: 350, biogenic_kg: 0 },
    all_sources: [
      { id: 's1', name: 'A', scope: 1, co2e_kg: 100, share_pct: 28.6 },
      { id: 's2', name: 'B', scope: 2, co2e_kg: 200, share_pct: 57.1 },
    ],
    activities: [
      {
        id: 'a1',
        site_name: '北京',
        source_name: 'A',
        scope: 1,
        amount: 32,
        unit: 'kg',
        pinned_ef_source: 'IPCC',
        co2e_kg: 100,
      },
      {
        id: 'a2',
        site_name: '北京',
        source_name: 'B',
        scope: 2,
        amount: 1000,
        unit: 'kWh',
        pinned_ef_source: 'IPCC',
        co2e_kg: 200,
      },
    ],
    ef_sources_used: [{ source: 'IPCC', count: 2, gwp_basis: 'AR5' }],
    language: 'zh-CN',
    prior_period_summary: null,
    base_year_summary: null,
  };
}
const fakeNarrative: ReportNarrative = {
  boundary_description: 'a'.repeat(60),
  reporting_boundary_description: 'b'.repeat(60),
  methodology_description: 'c'.repeat(120),
  emissions_summary: 'd'.repeat(120),
  significant_changes: 'e'.repeat(30),
  notable_observations: 'f'.repeat(60),
};

describe('writeAppendixXlsx', () => {
  it('localizes zh-TW workbook labels without rewriting data or edited narratives', async () => {
    const narrative = { ...fakeNarrative, boundary_description: '测试公司提供的原文' };
    const buf = await writeAppendixXlsx({
      data: { ...fakeData(), language: 'zh-TW' },
      narrative,
      language: 'zh-TW',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((sheet) => sheet.name)).toEqual([
      '概覽',
      '活動明細',
      '排放係數',
      '排放源',
      '敘述',
    ]);
    expect(wb.getWorksheet('概覽')?.getCell('A1').value).toBe('組織');
    expect(wb.getWorksheet('概覽')?.getCell('B1').value).toBe('测试');
    expect(wb.getWorksheet('概覽')?.getCell('A3').value).toBe('範疇一 (kg CO2e)');
    expect(wb.getWorksheet('概覽')?.getCell('B3').value).toBe(100);
    expect(wb.getWorksheet('活動明細')?.getCell('A1').value).toBe('活動 ID');
    expect(wb.getWorksheet('活動明細')?.getCell('D1').value).toBe('範疇');
    expect(wb.getWorksheet('敘述')?.getCell('A1').value).toBe('章節');
    expect(wb.getWorksheet('敘述')?.getCell('A2').value).toBe('組織邊界');
    expect(wb.getWorksheet('敘述')?.getCell('B2').value).toBe(narrative.boundary_description);
  });

  it('uses Taiwan terminology for the TCFD appendix pillars', async () => {
    const buf = await writeAppendixXlsx({
      data: { ...fakeData(), language: 'zh-TW' },
      narrative: {
        governance: '治理',
        strategy: '策略',
        risk_management: '風險',
        metrics_targets: '目標',
      },
      language: 'zh-TW',
      kind: 'tcfd',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const narrative = wb.getWorksheet('敘述');
    expect(narrative?.getCell('A3').value).toBe('策略');
    expect(narrative?.getCell('A4').value).toBe('風險管理');
    expect(narrative?.getCell('A5').value).toBe('指標與目標');
  });

  it('produces a workbook with 5 sheets in zh-CN', async () => {
    const buf = await writeAppendixXlsx({
      data: fakeData(),
      narrative: fakeNarrative,
      language: 'zh-CN',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(['概览', '活动明细', '排放因子', '排放源', '叙述']);
  });

  it('produces a workbook with 5 sheets in en', async () => {
    const buf = await writeAppendixXlsx({
      data: { ...fakeData(), language: 'en' },
      narrative: fakeNarrative,
      language: 'en',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual([
      'Overview',
      'Activities',
      'Emission Factors',
      'Emission Sources',
      'Narrative',
    ]);
  });

  it('writes one narrative row per section (6 total)', async () => {
    const buf = await writeAppendixXlsx({
      data: fakeData(),
      narrative: fakeNarrative,
      language: 'zh-CN',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const narrative = wb.getWorksheet('叙述')!;
    // Header row + 6 narrative rows = 7 rows.
    expect(narrative.rowCount).toBe(7);
  });

  it('lists each emission source on the Sources sheet', async () => {
    const buf = await writeAppendixXlsx({
      data: fakeData(),
      narrative: fakeNarrative,
      language: 'zh-CN',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sources = wb.getWorksheet('排放源')!;
    // Header + 2 data rows.
    expect(sources.rowCount).toBe(3);
  });

  it('lists each activity on the Activities sheet', async () => {
    const buf = await writeAppendixXlsx({
      data: fakeData(),
      narrative: fakeNarrative,
      language: 'zh-CN',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const activities = wb.getWorksheet('活动明细')!;
    // Header + 2 data rows.
    expect(activities.rowCount).toBe(3);
  });

  it('kind=tcfd fills the narrative sheet with the four pillars', async () => {
    const buf = await writeAppendixXlsx({
      data: fakeData(),
      narrative: {
        governance: 'GOV'.repeat(30),
        strategy: 'STR'.repeat(30),
        risk_management: 'RSK'.repeat(30),
        metrics_targets: 'MET'.repeat(40),
      },
      language: 'zh-CN',
      kind: 'tcfd',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const narrativeSheet = wb.worksheets.at(-1)!;
    // Header + 4 pillar rows (vs 6 ISO sections).
    expect(narrativeSheet.rowCount).toBe(5);
    expect(narrativeSheet.getRow(2).getCell(1).value).toBe('治理');
    expect(narrativeSheet.getRow(5).getCell(1).value).toBe('指标与目标');
    // The data sheets are unchanged — same appendix backbone as ISO.
    expect(wb.getWorksheet('活动明细')!.rowCount).toBe(3);
  });
});
