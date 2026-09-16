import { sourceApi } from '@renderer/lib/api/emission-source';
import { currentLocale, type Locale } from '@renderer/lib/i18n';
import { localizeChineseText } from '@renderer/lib/localized-data';
import type { EmissionSource, PresetSource } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

type SourceName = Pick<EmissionSource, 'name' | 'template_origin'>;

/** Translate unchanged catalog names, preserving every custom or renamed source. */
export function sourceDisplayName(
  source: SourceName,
  presetsById: ReadonlyMap<string, PresetSource>,
  locale: Locale = currentLocale(),
): string {
  const preset = source.template_origin ? presetsById.get(source.template_origin) : undefined;
  return preset && source.name === preset.name_zh
    ? localizeChineseText(source.name, locale)
    : source.name;
}

/** Share the existing catalog cache across source lists and activity selectors. */
export function useSourceDisplayName(
  sources: readonly SourceName[],
): (source: SourceName) => string {
  const locale = currentLocale();
  const presets = useQuery({
    queryKey: ['source:list-presets'],
    queryFn: () => sourceApi.listPresets(),
    enabled: locale === 'zh-TW' && sources.some((source) => source.template_origin),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const presetsById = useMemo(
    () => new Map((presets.data ?? []).map((preset) => [preset.id, preset])),
    [presets.data],
  );
  return useCallback(
    (source: SourceName) => sourceDisplayName(source, presetsById, locale),
    [presetsById, locale],
  );
}
