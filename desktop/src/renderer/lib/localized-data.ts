import { currentLocale, type Locale } from '@renderer/lib/i18n';
import { toTaiwanTraditional } from '@renderer/lib/traditional-chinese';
import { type EmissionFactor, USER_EF_SOURCE_PREFIX } from '@shared/types';

/** Localize display text without changing imported data or stored names. */
export function localizeChineseText(value: string, locale: Locale = currentLocale()): string {
  return locale === 'zh-TW' ? toTaiwanTraditional(value) : value;
}

/** Translate bundled catalog names; imported library names retain their spelling. */
export function emissionFactorName(
  factor: Pick<EmissionFactor, 'source' | 'name_zh' | 'name_en' | 'factor_code'>,
  locale: Locale = currentLocale(),
): string {
  const name = factor.name_zh ?? factor.name_en ?? factor.factor_code;
  return factor.source.startsWith(USER_EF_SOURCE_PREFIX) ? name : localizeChineseText(name, locale);
}
