import type { ReadinessFinding } from '@shared/types.js';
import type { CheckContext, ReadinessCheck } from '../types.js';

/** How far a factor's vintage may drift from the reporting year before it is worth a look. */
const EF_YEAR_DRIFT_LIMIT = 2;

/**
 * T1 — how much of the period rests on rows with nothing behind them: no
 * extraction, no attached evidence, no supplier disclosure.
 *
 * ONE finding for the period, not one per row. Hand entry is legitimate and
 * common — a consultant typing 200 rows would otherwise get 200 warnings, and
 * a checklist that fires on normal work stops being read. What is actually
 * useful before a delivery is the proportion: "42 of 120 rows, 18% of the
 * total, have no evidence attached" is a sampling risk you can act on.
 *
 * `info`, because nothing here is wrong — it is a statement about how much of
 * the inventory a verifier will want to test.
 */
export const t1ActivityWithoutEvidence: ReadinessCheck = {
  id: 'T1',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const row = ctx.db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN unevidenced THEN 1 ELSE 0 END), 0) AS unevidenced_count,
                COALESCE(SUM(computed_co2e_kg), 0) AS total_co2e,
                COALESCE(SUM(CASE WHEN unevidenced THEN computed_co2e_kg ELSE 0 END), 0)
                  AS unevidenced_co2e
           FROM (
             SELECT ad.computed_co2e_kg,
                    (ad.extraction_id IS NULL
                     AND ad.inbound_question_id IS NULL
                     AND NOT EXISTS (
                       SELECT 1 FROM evidence_attachment ea WHERE ea.activity_data_id = ad.id
                     )) AS unevidenced
               FROM activity_data ad
              WHERE ad.reporting_period_id = ?
           )`,
      )
      .get(ctx.period.id) as {
      total: number;
      unevidenced_count: number;
      total_co2e: number;
      unevidenced_co2e: number;
    };

    if (row.unevidenced_count === 0) return [];

    const share = row.total_co2e > 0 ? (row.unevidenced_co2e / row.total_co2e) * 100 : 0;
    return [
      {
        check_id: 'T1',
        severity: 'info',
        entity: { type: 'period', id: ctx.period.id },
        facts: {
          unevidenced_count: row.unevidenced_count,
          total_count: row.total,
          co2e_share_pct: Math.round(share * 10) / 10,
        },
      },
    ];
  },
};

/**
 * T2 — an activity row with no audit trail at all.
 *
 * Every row created through the app writes `activity_data.created`. A row
 * without one arrived some other way — the pre-c802b10 MCP path wrote rows
 * exactly like this. A blocker because the row's origin is unknowable, which
 * is the one thing this product promises never to be true.
 *
 * The payload path mirrors `AuditEventService.RECORD_PATHS`; kept in SQL
 * rather than going through the service so the whole period is one query
 * instead of one query per row. Only `activity_data.created` is consulted:
 * bulk import routes every row through `ActivityDataService.create`, so those
 * rows have their own event too — `activity_data.bulk_imported` is a counts
 * summary, not a per-row record.
 */
export const t2ActivityWithoutAuditTrail: ReadinessCheck = {
  id: 'T2',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const rows = ctx.db
      .prepare(
        `SELECT ad.id, ad.created_at, es.name AS source_name
           FROM activity_data ad
           JOIN emission_source es ON es.id = ad.emission_source_id
          WHERE ad.reporting_period_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM audit_event ae
               WHERE ae.event_kind = 'activity_data.created'
                 AND json_extract(ae.payload, '$.activity_id') = ad.id
            )
          ORDER BY ad.created_at`,
      )
      .all(ctx.period.id) as Array<{
      id: string;
      created_at: string;
      source_name: string;
    }>;

    return rows.map((r) => ({
      check_id: 'T2' as const,
      severity: 'blocker' as const,
      entity: { type: 'activity_data' as const, id: r.id },
      facts: { source_name: r.source_name, created_at: r.created_at },
    }));
  },
};

/**
 * T3 — the pinned factor's vintage is far from the year being reported.
 *
 * Using a 2019 grid factor for 2024 electricity is defensible if nothing newer
 * has been published, and indefensible if it has. The check cannot tell which,
 * so it surfaces the drift and leaves the judgement to the user.
 */
export const t3StaleEfVintage: ReadinessCheck = {
  id: 'T3',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const rows = ctx.db
      .prepare(
        `SELECT ad.id, ad.ef_factor_code, ad.ef_year, es.name AS source_name
           FROM activity_data ad
           JOIN emission_source es ON es.id = ad.emission_source_id
          WHERE ad.reporting_period_id = ?
            AND ABS(ad.ef_year - ?) > ?
          ORDER BY ABS(ad.ef_year - ?) DESC`,
      )
      .all(ctx.period.id, ctx.period.year, EF_YEAR_DRIFT_LIMIT, ctx.period.year) as Array<{
      id: string;
      ef_factor_code: string;
      ef_year: number;
      source_name: string;
    }>;

    return rows.map((r) => ({
      check_id: 'T3' as const,
      severity: 'warning' as const,
      entity: { type: 'activity_data' as const, id: r.id },
      facts: {
        source_name: r.source_name,
        factor_code: r.ef_factor_code,
        ef_year: r.ef_year,
        reporting_year: ctx.period.year,
      },
    }));
  },
};

/**
 * T4 — pinned to a factor from a user-imported library that has since been
 * deleted.
 *
 * The number stays correct: deleting a library leaves pinned snapshots intact
 * by design, which is what makes the audit story hold. What is lost is the
 * ability to show a verifier where the coefficient came from, so this is a
 * documentation gap rather than a calculation one.
 */
export const t4OrphanedUserLibraryFactor: ReadinessCheck = {
  id: 'T4',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const rows = ctx.db
      .prepare(
        `SELECT DISTINCT ad.id, ad.ef_source, ad.ef_factor_code, es.name AS source_name
           FROM activity_data ad
           JOIN emission_source es ON es.id = ad.emission_source_id
          WHERE ad.reporting_period_id = ?
            AND ad.ef_source LIKE 'user:%'
            AND NOT EXISTS (
              SELECT 1 FROM user_ef_library lib WHERE lib.source = ad.ef_source
            )
          ORDER BY ad.ef_source`,
      )
      .all(ctx.period.id) as Array<{
      id: string;
      ef_source: string;
      ef_factor_code: string;
      source_name: string;
    }>;

    return rows.map((r) => ({
      check_id: 'T4' as const,
      severity: 'warning' as const,
      entity: { type: 'activity_data' as const, id: r.id },
      facts: {
        source_name: r.source_name,
        ef_source: r.ef_source,
        factor_code: r.ef_factor_code,
      },
    }));
  },
};
