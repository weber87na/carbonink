import { detectAmountOutliers } from '@main/services/activity-import/grouping.js';
import type { ReadinessFinding } from '@shared/types.js';
import type { CheckContext, ReadinessCheck } from '../types.js';

/**
 * N1 — the activity's unit and its pinned factor's unit are in different
 * families, with no fuel binding to cross between them.
 *
 * A blocker, and the highest-value check here: the number is not merely
 * suspicious, it is arithmetically meaningless (litres multiplied by a per-kg
 * coefficient). Rows written by the pre-c802b10 MCP path are exactly this
 * shape, which is how that defect gets surfaced rather than silently repaired
 * (spec 2026-08-13-mcp-write-path-integrity).
 *
 * Cross-family is only a defect when no fuel binding explains it, so rows with
 * a `fuel_code` are excluded. Writing this check is what exposed that
 * `fuel_code` was never persisted (migration 021) — without it the ledger could
 * not tell a correctly converted row from a broken one, and could not recompute
 * either.
 */
export const n1UnitDimensionMismatch: ReadinessCheck = {
  id: 'N1',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const rows = ctx.db
      .prepare(
        `SELECT ad.id, ad.unit, ad.amount, pef.input_unit, es.name AS source_name
           FROM activity_data ad
           JOIN pinned_emission_factor pef
             ON pef.factor_code = ad.ef_factor_code
            AND pef.year = ad.ef_year
            AND pef.source = ad.ef_source
            AND pef.geography = ad.ef_geography
            AND pef.dataset_version = ad.ef_dataset_version
           JOIN emission_source es ON es.id = ad.emission_source_id
          WHERE ad.reporting_period_id = ?
            AND ad.fuel_code IS NULL`,
      )
      .all(ctx.period.id) as Array<{
      id: string;
      unit: string;
      amount: number;
      input_unit: string;
      source_name: string;
    }>;

    const findings: ReadinessFinding[] = [];
    for (const r of rows) {
      // isCompatible swallows unknown-unit errors and returns false. An unknown
      // unit IS a real problem, but reporting it as a dimension mismatch would
      // mislabel it, so only flag when both units resolve and differ in family.
      let bothKnown = true;
      try {
        ctx.unitConversion.normalize(r.unit);
        ctx.unitConversion.normalize(r.input_unit);
      } catch {
        bothKnown = false;
      }
      if (!bothKnown) continue;
      if (ctx.unitConversion.isCompatible(r.unit, r.input_unit)) continue;

      findings.push({
        check_id: 'N1',
        severity: 'blocker',
        entity: { type: 'activity_data', id: r.id },
        facts: {
          source_name: r.source_name,
          amount: r.amount,
          unit: r.unit,
          ef_input_unit: r.input_unit,
        },
      });
    }
    return findings;
  },
};

/**
 * N2 — an amount far from the median of comparable rows.
 *
 * Reuses the bulk-import outlier detector and its per-workspace ratio setting,
 * but over the whole period instead of one file: a dropped or duplicated zero
 * is just as likely to arrive by hand as by spreadsheet. Groups smaller than
 * the detector's minimum are skipped by the detector itself, so a period with
 * few rows produces nothing rather than noise.
 */
export const n2AmountOutlier: ReadinessCheck = {
  id: 'N2',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const rows = ctx.db
      .prepare(
        `SELECT ad.id, ad.amount, ad.unit, ad.emission_source_id, es.name AS source_name
           FROM activity_data ad
           JOIN emission_source es ON es.id = ad.emission_source_id
          WHERE ad.reporting_period_id = ?
          ORDER BY ad.created_at`,
      )
      .all(ctx.period.id) as Array<{
      id: string;
      amount: number;
      unit: string;
      emission_source_id: string;
      source_name: string;
    }>;

    // detectAmountOutliers keys issues by a 1-based row number, which is what
    // the import wizard needs. Here rows are ledger entries, so index back to
    // the activity id.
    const asImportRows = rows.map((r, i) => ({
      row: i + 1,
      description: r.source_name,
      unit: r.unit,
      source_id: r.emission_source_id,
      amount: r.amount,
    }));

    const ratio = ctx.settings.getImportOutlierRatio();
    const issues = detectAmountOutliers(
      asImportRows as unknown as Parameters<typeof detectAmountOutliers>[0],
      ratio,
    );

    return issues.flatMap((issue) => {
      const r = rows[issue.row - 1];
      if (!r) return [];
      return [
        {
          check_id: 'N2' as const,
          severity: 'warning' as const,
          entity: { type: 'activity_data' as const, id: r.id },
          facts: {
            source_name: r.source_name,
            amount: r.amount,
            unit: r.unit,
            detail: issue.detail ?? '',
            ratio,
          },
        },
      ];
    });
  },
};

/**
 * N3 — two or more rows identical in source, dates, amount and unit.
 *
 * Almost always the same bill entered twice (once by hand, once by import).
 * Reports the duplicates only — the first occurrence is presumed the keeper —
 * so acting on every finding leaves exactly one row standing.
 */
export const n3SuspectedDuplicate: ReadinessCheck = {
  id: 'N3',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const rows = ctx.db
      .prepare(
        `SELECT ad.id, ad.amount, ad.unit, ad.occurred_at_start, ad.occurred_at_end,
                es.name AS source_name,
                FIRST_VALUE(ad.id) OVER (
                  PARTITION BY ad.emission_source_id, ad.occurred_at_start,
                               ad.occurred_at_end, ad.amount, ad.unit
                  ORDER BY ad.created_at, ad.id
                ) AS keeper_id,
                COUNT(*) OVER (
                  PARTITION BY ad.emission_source_id, ad.occurred_at_start,
                               ad.occurred_at_end, ad.amount, ad.unit
                ) AS dupe_count
           FROM activity_data ad
           JOIN emission_source es ON es.id = ad.emission_source_id
          WHERE ad.reporting_period_id = ?`,
      )
      .all(ctx.period.id) as Array<{
      id: string;
      amount: number;
      unit: string;
      occurred_at_start: string;
      occurred_at_end: string;
      source_name: string;
      keeper_id: string;
      dupe_count: number;
    }>;

    return rows
      .filter((r) => r.dupe_count > 1 && r.id !== r.keeper_id)
      .map((r) => ({
        check_id: 'N3' as const,
        severity: 'warning' as const,
        entity: { type: 'activity_data' as const, id: r.id },
        facts: {
          source_name: r.source_name,
          amount: r.amount,
          unit: r.unit,
          occurred: `${r.occurred_at_start}~${r.occurred_at_end}`,
          duplicate_of: r.keeper_id,
        },
      }));
  },
};

/**
 * N5 — AR5 and AR6 factors both used inside one reporting period.
 *
 * A blocker under ISO 14064-1: totals computed on two GWP bases are not
 * additive, so the period's headline number means nothing. One finding per
 * period rather than per row — the fix is a decision about the whole
 * inventory, not a row-by-row edit.
 */
export const n5MixedGwpBasis: ReadinessCheck = {
  id: 'N5',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const rows = ctx.db
      .prepare(
        `SELECT DISTINCT pef.gwp_basis
           FROM activity_data ad
           JOIN pinned_emission_factor pef
             ON pef.factor_code = ad.ef_factor_code
            AND pef.year = ad.ef_year
            AND pef.source = ad.ef_source
            AND pef.geography = ad.ef_geography
            AND pef.dataset_version = ad.ef_dataset_version
          WHERE ad.reporting_period_id = ?
          ORDER BY pef.gwp_basis`,
      )
      .all(ctx.period.id) as Array<{ gwp_basis: string }>;

    if (rows.length < 2) return [];
    return [
      {
        check_id: 'N5',
        severity: 'blocker',
        entity: { type: 'period', id: ctx.period.id },
        facts: {
          year: ctx.period.year,
          bases: rows.map((r) => r.gwp_basis).join(', '),
        },
      },
    ];
  },
};
