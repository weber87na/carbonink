import * as m from '@renderer/paraglide/messages';
import type { ReadinessFinding, ReadinessSeverity } from '@shared/types';

/**
 * Localized copy for a readiness finding.
 *
 * Lives in the renderer because that is where paraglide is: the service
 * returns `check_id` + raw facts and stays locale-free, so the same finding
 * can be shown in the UI and written into a client deliverable without the
 * main process ever holding a copy table.
 */

/**
 * How many checks the sweep runs. Reported in the deliverable so a reviewer
 * knows the denominator behind "nothing was flagged"; kept beside the copy
 * because both are what the user sees rather than what the ledger holds.
 */
export const READINESS_CHECK_COUNT = 14;

export function severityLabel(severity: ReadinessSeverity): string {
  if (severity === 'blocker') return m.readiness_severity_blocker();
  if (severity === 'warning') return m.readiness_severity_warning();
  return m.readiness_severity_info();
}

/**
 * Facts arrive as a flat scalar map, but paraglide types each message's inputs
 * exactly. Spelling the arguments out per check keeps that guarantee: add a
 * placeholder to a message and forget the fact here, and this stops compiling.
 */
function s(f: ReadinessFinding, key: string): string {
  return String(f.facts[key] ?? '');
}

export function title(f: ReadinessFinding): string {
  switch (f.check_id) {
    case 'C1':
      return m.readiness_check_C1_title();
    case 'C3':
      return m.readiness_check_C3_title();
    case 'C5':
      return m.readiness_check_C5_title();
    case 'N1':
      return m.readiness_check_N1_title();
    case 'N2':
      return m.readiness_check_N2_title();
    case 'N3':
      return m.readiness_check_N3_title();
    case 'N5':
      return m.readiness_check_N5_title();
    case 'T1':
      return m.readiness_check_T1_title();
    case 'T2':
      return m.readiness_check_T2_title();
    case 'T3':
      return m.readiness_check_T3_title();
    case 'T4':
      return m.readiness_check_T4_title();
    case 'D1':
      return m.readiness_check_D1_title();
    case 'D2':
      return m.readiness_check_D2_title();
    case 'D3':
      return m.readiness_check_D3_title();
    case 'C6':
      return m.readiness_check_C6_title();
    case 'N6':
      return m.readiness_check_N6_title();
  }
}

export function detail(f: ReadinessFinding): string {
  switch (f.check_id) {
    case 'C1':
      return m.readiness_check_C1_detail({
        source_name: s(f, 'source_name'),
        scope: s(f, 'scope'),
        year: s(f, 'year'),
      });
    case 'C3':
      return m.readiness_check_C3_detail({
        source_name: s(f, 'source_name'),
        occurred: s(f, 'occurred'),
        period: s(f, 'period'),
      });
    case 'C5':
      return m.readiness_check_C5_detail({
        customer_name: s(f, 'customer_name'),
        question_text: s(f, 'question_text'),
      });
    case 'N1':
      return m.readiness_check_N1_detail({
        source_name: s(f, 'source_name'),
        amount: s(f, 'amount'),
        unit: s(f, 'unit'),
        ef_input_unit: s(f, 'ef_input_unit'),
      });
    case 'N2':
      return m.readiness_check_N2_detail({
        source_name: s(f, 'source_name'),
        amount: s(f, 'amount'),
        unit: s(f, 'unit'),
        detail: s(f, 'detail'),
        ratio: s(f, 'ratio'),
      });
    case 'N3':
      return m.readiness_check_N3_detail({
        source_name: s(f, 'source_name'),
        amount: s(f, 'amount'),
        unit: s(f, 'unit'),
        occurred: s(f, 'occurred'),
      });
    case 'N5':
      return m.readiness_check_N5_detail({ year: s(f, 'year'), bases: s(f, 'bases') });
    case 'T1':
      return m.readiness_check_T1_detail({
        unevidenced_count: s(f, 'unevidenced_count'),
        total_count: s(f, 'total_count'),
        co2e_share_pct: s(f, 'co2e_share_pct'),
      });
    case 'T2':
      return m.readiness_check_T2_detail({
        source_name: s(f, 'source_name'),
        created_at: s(f, 'created_at'),
      });
    case 'T3':
      return m.readiness_check_T3_detail({
        source_name: s(f, 'source_name'),
        factor_code: s(f, 'factor_code'),
        ef_year: s(f, 'ef_year'),
        reporting_year: s(f, 'reporting_year'),
      });
    case 'T4':
      return m.readiness_check_T4_detail({
        source_name: s(f, 'source_name'),
        factor_code: s(f, 'factor_code'),
        ef_source: s(f, 'ef_source'),
      });
    case 'D1':
      return m.readiness_check_D1_detail();
    case 'D2':
      return f.facts.reason === 'deleted'
        ? m.readiness_check_D2_detail_deleted({
            source_name: s(f, 'source_name'),
            frozen_co2e_kg: s(f, 'frozen_co2e_kg'),
          })
        : m.readiness_check_D2_detail_edited({
            source_name: s(f, 'source_name'),
            frozen_co2e_kg: s(f, 'frozen_co2e_kg'),
            live_co2e_kg: s(f, 'live_co2e_kg'),
          });
    case 'D3':
      return m.readiness_check_D3_detail({
        supplier_name: s(f, 'supplier_name'),
        due_date: s(f, 'due_date'),
      });
    // The agent checks carry the model's own sentence, so the copy is a frame
    // around it rather than a template it has to fill.
    case 'C6':
      return m.readiness_check_C6_detail({ observation: s(f, 'observation') });
    case 'N6':
      return m.readiness_check_N6_detail({ observation: s(f, 'observation') });
  }
}
