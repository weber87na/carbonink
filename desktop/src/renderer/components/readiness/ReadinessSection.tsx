import {
  detail,
  READINESS_CHECK_COUNT,
  severityLabel,
  title,
} from '@renderer/components/readiness/copy';
import { Button } from '@renderer/components/ui/button';
import { readinessApi } from '@renderer/lib/api/readiness';
import * as m from '@renderer/paraglide/messages';
import type { ReadinessFinding, ReadinessReport, ReadinessSeverity } from '@shared/types';
import { readinessFindingKey } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { useState } from 'react';

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

  // Layer 2 lives in its own mutation, not folded into the sweep: the rules
  // are free and instant, the review spends the user's tokens. Pressing the
  // button is the authorization, as with batch extraction.
  const [agentFindings, setAgentFindings] = useState<ReadinessFinding[]>([]);
  const [agentRan, setAgentRan] = useState(false);
  const reviewMutation = useMutation({
    mutationFn: () => readinessApi.review(reportingPeriodId),
    onSuccess: (result) => {
      setAgentFindings(result.findings);
      setAgentRan(true);
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (key: string) => readinessApi.dismiss(key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      void refetch();
    },
  });

  // Agent findings are always `info`, so appending keeps the blocker-first
  // order the service established.
  const shown: ReadinessFinding[] = data ? [...data.findings, ...agentFindings] : agentFindings;

  return (
    <section className="flex flex-col gap-3" data-testid="readiness-section">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{m.readiness_title()}</h2>
          <p className="text-xs text-muted-foreground">{m.readiness_description()}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            {isFetching ? m.readiness_running() : data ? m.readiness_rerun() : m.readiness_run()}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => reviewMutation.mutate()}
            disabled={reviewMutation.isPending}
            title={m.readiness_agent_hint()}
          >
            {reviewMutation.isPending ? m.readiness_reviewing_agent() : m.readiness_review_agent()}
          </Button>
        </div>
      </div>

      {/* An empty result is indistinguishable from "no provider configured"
       * by design -- the channel never errors -- so say so once the review has
       * run and produced nothing, rather than leaving the button looking
       * broken. */}
      {agentRan && agentFindings.length === 0 ? (
        <p className="text-xs text-muted-foreground">{m.readiness_agent_unavailable()}</p>
      ) : null}

      {data ? (
        shown.length === 0 ? (
          <div className="flex items-start gap-3 rounded-md border border-border bg-card px-4 py-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{m.readiness_all_clear_title()}</p>
              <p className="text-xs text-muted-foreground">
                {m.readiness_all_clear_body({ count: String(READINESS_CHECK_COUNT) })}
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
              {shown.map((f) => {
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
