import { toTaiwanTraditional } from '@renderer/lib/traditional-chinese';
import { describe, expect, it } from 'vitest';

describe('Taiwan Traditional Chinese conversion', () => {
  it('converts dynamic Simplified Chinese domain data with Taiwan terminology', () => {
    expect(toTaiwanTraditional('国家电网软件数据')).toBe('國家電網軟體資料');
  });

  it('preserves interpolation placeholders', () => {
    expect(toTaiwanTraditional('服务商 {provider}')).toBe('服務商 {provider}');
  });
});
