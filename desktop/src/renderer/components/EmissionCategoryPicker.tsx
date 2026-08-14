import { Combobox, type ComboboxGroup } from '@renderer/components/ui/combobox';
import { categoryLabel } from '@renderer/lib/category-labels';
import { currentLocale } from '@renderer/lib/i18n';
import * as m from '@renderer/paraglide/messages';
import {
  categoriesForScope,
  type EmissionCategory,
  emissionCategoryLabel,
  findEmissionCategory,
  type Scope,
} from '@shared/emission-categories';

/**
 * Scope-filtered picker over the standard emission-category taxonomy.
 *
 * Replaces the free-text category input the source forms used to carry.
 * That input asked users to type an internal identifier (`fuel.mobile`),
 * showed it untranslated, and — because `EfService.list` narrows the EF
 * candidate pool by that exact string — silently killed factor matching
 * whenever the typed value matched nothing.
 *
 * The value handled here is the **standard code** (stored in
 * `emission_source.ghg_protocol_path`). Callers derive the EF join key
 * from it via `efCategoryForCode`; this component doesn't know about that
 * second field.
 *
 * Scope 3 splits into upstream/downstream groups because that's how the
 * GHG Protocol itself presents the 15 categories, and it halves the
 * scan cost of a 15-row list.
 *
 * Values outside the taxonomy — legacy rows, catalog imports, anything a
 * user types into the custom-value row — are surfaced in their own group
 * and badged non-standard rather than being dropped or silently rewritten.
 */

export interface EmissionCategoryPickerProps {
  id?: string;
  scope: Scope;
  /** Current `ghg_protocol_path`. Empty string = not set. */
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
}

/** Sentinel for the "clear this field" row — cmdk can't carry an empty value. */
const NONE = '__carbonink-no-category__';

function rowLabel(category: EmissionCategory, locale: 'en' | 'zh-CN') {
  return (
    <>
      <span className="truncate">{emissionCategoryLabel(category, locale)}</span>
      {/* The ISO 14064-1 category number, since that's what the report
          groups by. Muted + mono so it reads as reference, not content. */}
      <span className="ml-auto shrink-0 font-mono text-[0.6875rem] text-muted-foreground">
        ISO C{category.isoCategory}
      </span>
    </>
  );
}

function toOption(category: EmissionCategory, locale: 'en' | 'zh-CN') {
  return {
    value: category.code,
    label: rowLabel(category, locale),
    // Match on both locales' labels plus the raw code, so a consultant
    // searching "cat6", "business travel" or "差旅" lands in the same place.
    keywords: [
      category.labelEn,
      category.labelZh,
      category.code,
      ...(category.ghgpNumber ? [`${category.scope}.${category.ghgpNumber}`] : []),
      ...(category.keywords ?? []),
    ],
  };
}

export function EmissionCategoryPicker({
  id,
  scope,
  value,
  onChange,
  disabled,
}: EmissionCategoryPickerProps) {
  const locale = currentLocale();
  const options = categoriesForScope(scope);
  const known = findEmissionCategory(value);

  const groups: ComboboxGroup[] = [];

  // A stored value the taxonomy doesn't recognise (or recognises under a
  // different scope — e.g. the scope was just changed). Pin it at the top
  // so the user can see what they're replacing.
  if (value !== '' && (!known || known.scope !== scope)) {
    groups.push({
      heading: m.sources_form_category_group_current(),
      options: [
        {
          value,
          label: (
            <>
              <span className="truncate">{categoryLabel(value)}</span>
              <span className="ml-auto shrink-0 text-[0.6875rem] text-muted-foreground">
                {m.sources_form_category_nonstandard()}
              </span>
            </>
          ),
        },
      ],
    });
  }

  if (scope === 3) {
    groups.push(
      {
        heading: m.sources_form_category_group_upstream(),
        options: options.filter((c) => (c.ghgpNumber ?? 0) <= 8).map((c) => toOption(c, locale)),
      },
      {
        heading: m.sources_form_category_group_downstream(),
        options: options.filter((c) => (c.ghgpNumber ?? 0) > 8).map((c) => toOption(c, locale)),
      },
    );
  } else {
    groups.push({ options: options.map((c) => toOption(c, locale)) });
  }

  // Clearing lives at the bottom: it's the rarest action, and putting it
  // first would make it the default keyboard target on an empty query.
  if (value !== '') {
    groups.push({
      options: [
        {
          value: NONE,
          label: <span className="text-muted-foreground">{m.sources_form_category_none()}</span>,
        },
      ],
    });
  }

  return (
    <Combobox
      {...(id ? { id } : {})}
      value={value}
      onValueChange={(next) => onChange(next === NONE ? '' : next)}
      groups={groups}
      placeholder={m.sources_form_category_placeholder()}
      searchPlaceholder={m.sources_form_category_search()}
      emptyText={m.sources_form_category_empty()}
      renderValue={(raw) => {
        const cat = findEmissionCategory(raw);
        if (cat) return emissionCategoryLabel(cat, locale);
        // Legacy / custom: fall back to the historical label map, which
        // humanizes the dotted-lowercase and Climatiq flavors.
        return categoryLabel(raw);
      }}
      customValueLabel={(query) => m.sources_form_category_custom({ query })}
      {...(disabled ? { disabled } : {})}
    />
  );
}
