import { Button } from '@renderer/components/ui/button';
import { readinessApi } from '@renderer/lib/api/readiness';
import * as m from '@renderer/paraglide/messages';
import type { ReadinessFinding, ReadinessReport, ReadinessSeverity } from '@shared/types';
import { readinessFindingKey } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';

/**
 * The readiness checklist for one reporting period (spec
 * 2026-08-13-inventory-readiness-rules).
 *
 * Runs on demand rather than on mount: the sweep writes a `readiness.reviewed`
 * audit event, and an event per page visit would turn the audit log into
 * navigation history.
 */

const SEVERITY_ICON: Record<ReadinessSeverity, typeof OctagonAlert> = {
  blocker: OctagonAlert,
  warning: AlertTriangle,
  info: Info,
};

/**
 * Severity is never carried by colour alone — each row pairs a distinct icon
 * and a text label with its tint (PRODUCT.md accessibility rule). Only
 * `blocker` gets the destructive tint, and as a 10% wash rather than a fill
 * (DESIGN.md: alarm red warns, it does not scream).
 */
const SEVERITY_STYLE: Record<ReadinessSeverity, string> = {
  blocker: 'bg-destructive/10 text-destructive',
  warning: 'bg-foreground-8 text-foreground',
  info: 'bg-muted text-muted-foreground',
};

function severityLabel(severity: ReadinessSeverity): string {
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

function title(f: ReadinessFinding): string {
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
  }
}

function detail(f: ReadinessFinding): string {
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
  }
}

/**
 * Where the user goes to act on a finding. A checklist whose entries are not
 * one click from their fix becomes a wall of red text nobody works through,
 * so every entity type resolves somewhere concrete.
 *
 * Rendered per case rather than returned as a `{to, search}` bag because the
 * router types `to`, `params` and `search` together — a generic object cannot
 * satisfy that, and widening it would give up the route-existence check.
 */
function FixLink({ f }: { f: ReadinessFinding }) {
  const label = m.readiness_open();
  switch (f.entity.type) {
    case 'activity_data':
      return (
        <Button variant="ghost" size="sm" asChild>
          <Link to="/activities" search={{ highlight: f.entity.id }}>
            {label}
          </Link>
        </Button>
      );
    case 'emission_source':
      return (
        <Button variant="ghost" size="sm" asChild>
          <Link to="/sources">{label}</Link>
        </Button>
      );
    case 'question': {
      const questionnaireId = String(f.facts.questionnaire_id ?? '');
      if (questionnaireId === '') return null;
      return (
        <Button variant="ghost" size="sm" asChild>
          <Link to="/questionnaires/$id" params={{ id: questionnaireId }}>
            {label}
          </Link>
        </Button>
      );
    }
    case 'questionnaire':
      return (
        <Button variant="ghost" size="sm" asChild>
          <Link to="/supplier-disclosures/$id" params={{ id: f.entity.id }}>
            {label}
          </Link>
        </Button>
      );
    case 'organization':
      return (
        <Button variant="ghost" size="sm" asChild>
          <Link to="/settings">{label}</Link>
        </Button>
      );
    // A period-level finding (mixed GWP bases, the evidence summary) is not
    // fixed at one row, so sending the user somewhere specific would mislead.
    case 'period':
      return null;
  }
}

export function ReadinessSection({ reportingPeriodId }: { reportingPeriodId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['readiness', reportingPeriodId];

  const { data, isFetching, refetch } = useQuery<ReadinessReport>({
    queryKey,
    queryFn: () => readinessApi.run(reportingPeriodId),
    // On-demand only: see the note above about audit-log noise.
    enabled: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const dismissMutation = useMutation({
    mutationFn: (key: string) => readinessApi.dismiss(key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      void refetch();
    },
  });

  return (
    <section className="flex flex-col gap-3" data-testid="readiness-section">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{m.readiness_title()}</h2>
          <p className="text-xs text-muted-foreground">{m.readiness_description()}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="shrink-0"
        >
          {isFetching ? m.readiness_running() : data ? m.readiness_rerun() : m.readiness_run()}
        </Button>
      </div>

      {data ? (
        data.findings.length === 0 ? (
          <div className="flex items-start gap-3 rounded-md border border-border bg-card px-4 py-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{m.readiness_all_clear_title()}</p>
              <p className="text-xs text-muted-foreground">
                {m.readiness_all_clear_body({ count: String(14) })}
              </p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground tabular-nums">
              {m.readiness_counts({
                blocker: String(data.counts.blocker),
                warning: String(data.counts.warning),
                info: String(data.counts.info),
              })}
              {data.dismissed_count > 0
                ? ` · ${m.readiness_dismissed_note({ count: String(data.dismissed_count) })}`
                : ''}
            </p>
            <ul className="divide-y divide-border rounded-md border border-border bg-card">
              {data.findings.map((f) => {
                const Icon = SEVERITY_ICON[f.severity];
                const key = readinessFindingKey(f);
                return (
                  <li key={key} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30">
                    <span
                      className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${SEVERITY_STYLE[f.severity]}`}
                    >
                      <Icon className="size-3" aria-hidden="true" />
                      {severityLabel(f.severity)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={title(f)}>
                        {title(f)}
                      </p>
                      <p className="text-xs text-muted-foreground">{detail(f)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <FixLink f={f} />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dismissMutation.mutate(key)}
                        disabled={dismissMutation.isPending}
                      >
                        {m.readiness_dismiss()}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )
      ) : null}
    </section>
  );
}
