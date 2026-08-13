import type { ReadinessFinding } from '@shared/types.js';
import type { CheckContext, ReadinessCheck } from '../types.js';

/**
 * C1 — an active emission source with nothing recorded against it all period.
 *
 * Usually means data was never collected for that source, which is the single
 * most common way an inventory ends up understated. Not a blocker: a source
 * can legitimately be dormant (a decommissioned boiler kept for comparability).
 */
export const c1SourceWithoutActivity: ReadinessCheck = {
  id: 'C1',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const rows = ctx.db
      .prepare(
        `SELECT es.id, es.name, es.scope
           FROM emission_source es
           JOIN site s ON s.id = es.site_id
          WHERE s.organization_id = ?
            AND es.is_active = 1
            AND NOT EXISTS (
              SELECT 1 FROM activity_data ad
               WHERE ad.emission_source_id = es.id
                 AND ad.reporting_period_id = ?
            )
          ORDER BY es.scope, es.name`,
      )
      .all(ctx.period.organization_id, ctx.period.id) as Array<{
      id: string;
      name: string;
      scope: number;
    }>;

    return rows.map((r) => ({
      check_id: 'C1' as const,
      severity: 'warning' as const,
      entity: { type: 'emission_source' as const, id: r.id },
      facts: { source_name: r.name, scope: r.scope, year: ctx.period.year },
    }));
  },
};

/**
 * C3 — an activity row dated outside the period it is filed under.
 *
 * A blocker because it silently misstates two periods at once: the row inflates
 * the one it is filed under and is missing from the one it belongs to. Mirrors
 * the `period_mismatch` rule bulk import already applies at the file level,
 * extended to the whole ledger.
 */
export const c3ActivityOutsidePeriod: ReadinessCheck = {
  id: 'C3',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const rows = ctx.db
      .prepare(
        `SELECT ad.id, ad.occurred_at_start, ad.occurred_at_end, es.name AS source_name
           FROM activity_data ad
           JOIN emission_source es ON es.id = ad.emission_source_id
          WHERE ad.reporting_period_id = ?
            AND (ad.occurred_at_start < ? OR ad.occurred_at_end > ?)
          ORDER BY ad.occurred_at_start`,
      )
      .all(ctx.period.id, ctx.period.starts_at, ctx.period.ends_at) as Array<{
      id: string;
      occurred_at_start: string;
      occurred_at_end: string;
      source_name: string;
    }>;

    return rows.map((r) => ({
      check_id: 'C3' as const,
      severity: 'blocker' as const,
      entity: { type: 'activity_data' as const, id: r.id },
      facts: {
        source_name: r.source_name,
        occurred: `${r.occurred_at_start}~${r.occurred_at_end}`,
        period: `${ctx.period.starts_at}~${ctx.period.ends_at}`,
      },
    }));
  },
};

/**
 * C5 — a question nobody has answered.
 *
 * Scoped to questionnaires for the period's reporting year, and to outbound
 * ones only: an unanswered inbound question is the supplier's homework, not
 * ours, and is already tracked by the disclosure status machine (see D3).
 */
export const c5QuestionWithoutAnswer: ReadinessCheck = {
  id: 'C5',
  run: (ctx: CheckContext): ReadinessFinding[] => {
    const rows = ctx.db
      .prepare(
        `SELECT q.id,
                q.questionnaire_id,
                COALESCE(q.raw_text, q.normalized_text) AS question_text,
                c.name AS customer_name
           FROM question q
           JOIN questionnaire qn ON qn.id = q.questionnaire_id
           JOIN customer c ON c.id = qn.customer_id
      LEFT JOIN answer a ON a.question_id = q.id
          WHERE qn.reporting_year = ?
            AND qn.direction = 'outbound'
            AND a.id IS NULL
          ORDER BY qn.id, q.position`,
      )
      .all(ctx.period.year) as Array<{
      id: string;
      questionnaire_id: string;
      question_text: string | null;
      customer_name: string;
    }>;

    return rows.map((r) => ({
      check_id: 'C5' as const,
      severity: 'warning' as const,
      entity: { type: 'question' as const, id: r.id },
      facts: {
        customer_name: r.customer_name,
        question_text: (r.question_text ?? '').slice(0, 120),
        // Carried so the renderer can deep-link to the questionnaire: a
        // finding the user cannot reach in one click does not get fixed.
        questionnaire_id: r.questionnaire_id,
      },
    }));
  },
};
