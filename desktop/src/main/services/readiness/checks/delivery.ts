import { localTodayMain } from '@main/services/overdue-notify-service.js';
import type { ReadinessFinding } from '@shared/types.js';
import type { CheckContext, ReadinessCheck } from '../types.js';

/**
 * D1 — no base year recorded on the organization.
 *
 * ISO 14064-1 reporting leans on a base year for comparability, and the
 * report's year-over-year section has nothing to anchor to without one. A
 * warning rather than a blocker: a first inventory legitimately has no prior
 * year to point at yet.
 */
export const d1NoBaseYear: ReadinessCheck = {
  id: 'D1',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const org = ctx.db
      .prepare('SELECT id, base_year_period_id FROM organization WHERE id = ?')
      .get(ctx.period.organization_id) as
      | { id: string; base_year_period_id: string | null }
      | undefined;
    if (!org || org.base_year_period_id !== null) return [];
    return [
      {
        check_id: 'D1',
        severity: 'warning',
        entity: { type: 'organization', id: org.id },
        facts: { year: ctx.period.year },
      },
    ];
  },
};

/**
 * D2 — a frozen snapshot line no longer matches the activity row it came from.
 *
 * A snapshot is the number that went out the door in a finalized answer or an
 * exported report. If the underlying row has been edited since, the delivered
 * figure and the current ledger disagree — and the recipient is holding the
 * stale one. A blocker: it is the only check here where something already left
 * the building.
 *
 * Compares the frozen amount / unit / CO2e / factor identity against the live
 * row. A deleted row (`original_activity_data_id` pointing at nothing) is
 * reported too — that is the same divergence in its strongest form.
 */
export const d2SnapshotDivergedFromLedger: ReadinessCheck = {
  id: 'D2',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const rows = ctx.db
      .prepare(
        `SELECT csl.id AS line_id,
                csl.original_activity_data_id AS activity_id,
                csl.emission_source_name_at_freeze AS source_name,
                csl.amount AS frozen_amount,
                csl.unit AS frozen_unit,
                csl.computed_co2e_kg AS frozen_co2e,
                csl.ef_factor_code AS frozen_factor_code,
                ad.id AS live_id,
                ad.amount AS live_amount,
                ad.unit AS live_unit,
                ad.computed_co2e_kg AS live_co2e,
                ad.ef_factor_code AS live_factor_code
           FROM calculation_snapshot_line csl
           JOIN calculation_snapshot cs ON cs.id = csl.calculation_snapshot_id
      LEFT JOIN activity_data ad ON ad.id = csl.original_activity_data_id
          WHERE cs.reporting_period_id = ?`,
      )
      .all(ctx.period.id) as Array<{
      line_id: string;
      activity_id: string | null;
      source_name: string;
      frozen_amount: number;
      frozen_unit: string;
      frozen_co2e: number;
      frozen_factor_code: string;
      live_id: string | null;
      live_amount: number | null;
      live_unit: string | null;
      live_co2e: number | null;
      live_factor_code: string | null;
    }>;

    const findings: ReadinessFinding[] = [];
    for (const r of rows) {
      if (r.activity_id === null) continue; // never linked to a row; nothing to diverge from

      if (r.live_id === null) {
        findings.push({
          check_id: 'D2',
          severity: 'blocker',
          entity: { type: 'activity_data', id: r.activity_id },
          facts: {
            source_name: r.source_name,
            reason: 'deleted',
            frozen_co2e_kg: r.frozen_co2e,
          },
        });
        continue;
      }

      const changed =
        r.live_amount !== r.frozen_amount ||
        r.live_unit !== r.frozen_unit ||
        r.live_co2e !== r.frozen_co2e ||
        r.live_factor_code !== r.frozen_factor_code;
      if (!changed) continue;

      findings.push({
        check_id: 'D2',
        severity: 'blocker',
        entity: { type: 'activity_data', id: r.activity_id },
        facts: {
          source_name: r.source_name,
          reason: 'edited',
          frozen_co2e_kg: r.frozen_co2e,
          live_co2e_kg: r.live_co2e ?? 0,
        },
      });
    }
    return findings;
  },
};

/**
 * D3 — a supplier disclosure that was sent and is past its due date.
 *
 * Reuses the same rule the launch notification and the sidebar badge apply:
 * overdue means `sent` (not `received` — that backlog is ours, not the
 * supplier's) and a due date before today in LOCAL time, because a bare date
 * compared against UTC misfires east of Greenwich.
 */
export const d3OverdueSupplierDisclosure: ReadinessCheck = {
  id: 'D3',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const today = localTodayMain();
    const rows = ctx.db
      .prepare(
        `SELECT qn.id, qn.due_date, c.name AS supplier_name
           FROM questionnaire qn
           JOIN customer c ON c.id = qn.customer_id
          WHERE qn.direction = 'inbound'
            AND qn.status = 'sent'
            AND qn.reporting_year = ?
            AND qn.due_date IS NOT NULL
            AND qn.due_date < ?
          ORDER BY qn.due_date`,
      )
      .all(ctx.period.year, today) as Array<{
      id: string;
      due_date: string;
      supplier_name: string;
    }>;

    return rows.map((r) => ({
      check_id: 'D3' as const,
      severity: 'warning' as const,
      entity: { type: 'questionnaire' as const, id: r.id },
      facts: { supplier_name: r.supplier_name, due_date: r.due_date },
    }));
  },
};
