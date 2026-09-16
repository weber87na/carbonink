import { COMMON_COUNTRIES, INDUSTRIES, lookupLabel } from '@renderer/features/onboarding/lookups';
import { setLocale } from '@renderer/lib/i18n';
import { emissionFactorName, localizeChineseText } from '@renderer/lib/localized-data';
import { sourceDisplayName } from '@renderer/lib/source-labels';
import { stageLabel } from '@renderer/lib/stage-labels';
import type { PresetSource } from '@shared/types';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => setLocale('en'));

describe('Traditional Chinese display data', () => {
  it('converts unchanged preset source names while preserving renamed and custom sources', () => {
    const preset: PresetSource = {
      id: 'natural-gas',
      name_zh: '天然气燃烧',
      name_en: 'Natural gas combustion',
      scope: 1,
      category: 'fuel',
      hint_unit: 'm3',
    };
    const presets = new Map([[preset.id, preset]]);
    const source = { name: preset.name_zh, template_origin: preset.id };

    expect(sourceDisplayName(source, presets, 'zh-TW')).toBe('天然氣燃燒');
    expect(sourceDisplayName(source, presets, 'zh-CN')).toBe('天然气燃烧');
    expect(sourceDisplayName({ ...source, name: '客户指定燃气' }, presets, 'zh-TW')).toBe(
      '客户指定燃气',
    );
    expect(sourceDisplayName({ ...source, template_origin: null }, presets, 'zh-TW')).toBe(
      '天然气燃烧',
    );
    expect(sourceDisplayName(source, new Map(), 'zh-TW')).toBe('天然气燃烧');
    expect(source.name).toBe(preset.name_zh);
  });

  it('converts bundled EF names without rewriting catalog data', () => {
    const factor = {
      source: 'MEE',
      name_zh: '全国电网平均排放因子',
      name_en: 'National grid average emission factor',
      factor_code: 'electricity.grid.cn',
    };

    expect(emissionFactorName(factor, 'zh-TW')).toBe('全國電網平均排放因子');
    expect(emissionFactorName(factor, 'zh-CN')).toBe('全国电网平均排放因子');
    expect(factor.name_zh).toBe('全国电网平均排放因子');
    expect(emissionFactorName({ ...factor, source: 'user:客户资料' }, 'zh-TW')).toBe(
      '全国电网平均排放因子',
    );
  });

  it('preserves identifier fallbacks and English text', () => {
    expect(
      emissionFactorName(
        { source: 'MEE', name_zh: null, name_en: null, factor_code: 'electricity.grid.cn' },
        'zh-TW',
      ),
    ).toBe('electricity.grid.cn');
    expect(localizeChineseText('Grid electricity', 'zh-TW')).toBe('Grid electricity');
  });

  it('updates lookup labels when the language changes, keeping option values intact', () => {
    const industry = INDUSTRIES.find((option) => option.value === 'manufacturing');
    const country = COMMON_COUNTRIES.find((option) => option.code === 'TW');
    if (!industry || !country) throw new Error('Required lookup fixtures are missing');

    setLocale('zh-TW');
    expect(lookupLabel(industry)).toBe('製造業 · Manufacturing');
    expect(lookupLabel(country)).toBe('臺灣 · Taiwan');

    setLocale('zh-CN');
    expect(lookupLabel(industry)).toBe('制造业 · Manufacturing');
    expect(country.code).toBe('TW');
    expect(industry.value).toBe('manufacturing');
  });

  it('localizes document types at call time and keeps unknown stage IDs readable', () => {
    setLocale('zh-TW');
    expect(stageLabel('china_utility.v1')).toBe('電費帳單');
    expect(stageLabel('travel.v1')).toBe('差旅單據');
    expect(stageLabel(null)).toBe('未分類');
    expect(stageLabel('custom_stage.v2')).toBe('custom_stage.v2');

    setLocale('zh-CN');
    expect(stageLabel('china_utility.v1')).toBe('电费账单');

    setLocale('en');
    expect(stageLabel('china_utility.v1')).toBe('Electricity bill');
  });
});
