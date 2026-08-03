import { Main } from '@renderer/components/layout/main';
import { Button } from '@renderer/components/ui/button';
import { activityApi } from '@renderer/lib/api/activity-data';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { orgApi } from '@renderer/lib/api/organization';
import { formatCo2e } from '@renderer/lib/format';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type { ActivityData, EmissionSource } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, Navigate } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useMemo } from 'react';

export const Route = createFileRoute('/')({
  component: Dashboard,
});

// Round 4 #12: number formatting unified across the app via
// `formatCo2e` (see `lib/format.ts`). Dashboard, audit cards, and
// reports now use the same zh-CN locale + max-1-decimal contract.

function Dashboard() {
  const hasAny = useQuery({ queryKey: ['org:has-any'], queryFn: orgApi.hasAny });

  const orgQuery = useQuery({
    queryKey: ['org:get-current'],
    queryFn: orgApi.getCurrent,
    enabled: hasAny.data === true,
  });
  const orgId = orgQuery.data?.id;

  const periodsQuery = useQuery({
    queryKey: ['org:list-reporting-periods', orgId],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: orgId! }),
    enabled: !!orgId,
  });
  const currentPeriodId = periodsQuery.data?.[0]?.id;

  const totalsQuery = useQuery({
    queryKey: ['activity:totals-by-period', currentPeriodId],
    queryFn: () => activityApi.totalsByPeriod({ reporting_period_id: currentPeriodId! }),
    enabled: !!currentPeriodId,
  });

  // Round 4 #5: pull the full activity list once so the recent-activities
  // widget + monthly-trend widget can derive their data without two more
  // round-trips. The activity:list-by-period query is already cached, so
  // adding a second consumer is free.
  const activitiesQuery = useQuery({
    queryKey: ['activity:list-by-period', currentPeriodId],
    queryFn: () => activityApi.listByPeriod({ reporting_period_id: currentPeriodId! }),
    enabled: !!currentPeriodId,
  });

  // Sources lookup so the recent-activities row can render
  // "厂区电表" instead of the raw emission_source_id.
  const sourcesQuery = useQuery<EmissionSource[]>({
    queryKey: ['source:list-by-org', orgId],
    queryFn: () => sourceApi.listByOrg({ organization_id: orgId! }),
    enabled: !!orgId,
  });

  if (hasAny.isLoading) {
    return <p className="text-muted-foreground">{m.loading()}</p>;
  }
  if (!hasAny.data) {
    return <Navigate to="/onboarding/$step" params={{ step: '1' }} />;
  }

  const totals = totalsQuery.data;
  const showEmptyHint = totals?.total_co2e_kg === 0;
  const activities = activitiesQuery.data ?? [];
  const sourceById = new Map((sourcesQuery.data ?? []).map((s) => [s.id, s]));

  // The getting-started checklist reads real state, so we hold it back until
  // both feeder queries have settled — otherwise a user who already has
  // sources sees "set up your first source" flash before the data lands.
  // A failed query counts as settled: falling back to "not done yet" is the
  // harmless direction (the step links still work).
  const startupReady = !sourcesQuery.isLoading && !activitiesQuery.isLoading;

  return (
    <Main className="space-y-6">
      <h1 className="text-2xl font-semibold">{m.dashboard_inventory_title()}</h1>

      <div className="grid grid-cols-4 gap-4">
        <ScopeCard label={m.dashboard_total_co2e()} value={totals?.total_co2e_kg} />
        <ScopeCard label={m.dashboard_scope_1()} value={totals?.scope1_kg} />
        <ScopeCard label={m.dashboard_scope_2()} value={totals?.scope2_kg} />
        <ScopeCard label={m.dashboard_scope_3()} value={totals?.scope3_kg} />
      </div>

      {showEmptyHint && startupReady && (
        <GettingStartedCard
          hasSources={(sourcesQuery.data ?? []).length > 0}
          hasActivities={activities.length > 0}
        />
      )}

      {/* Two-column widget row below the KPI cards. Round 4 #5: was empty
       * space until now. Left = monthly trend (bar chart); right = recent
       * activities list. */}
      {!showEmptyHint && activities.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
          <MonthlyTrendCard activities={activities} />
          <RecentActivitiesCard activities={activities} sourceById={sourceById} />
        </div>
      )}
    </Main>
  );
}

/**
 * Zero-state guidance for a freshly-onboarded org.
 *
 * The old empty state was one line — "No emissions data yet. Add your first
 * activity →" — pointing straight at /activities. That was a dead end: the
 * onboarding wizard creates an org, a period, a boundary and a site, but NO
 * emission sources, and an activity can't exist without one. Users clicked
 * through, hit "no sources yet" inside the form, and had to work out on their
 * own that /sources came first.
 *
 * So the empty state now mirrors the actual dependency chain — source →
 * activity → report — and reads live state to decide where the user is in it.
 * Completed steps stay visible with a check (progress is reassuring, and it
 * explains why the next step is the next step); the first unfinished step is
 * the only one carrying a button, which keeps the One Mark Rule intact no
 * matter which step is live.
 */
function GettingStartedCard({
  hasSources,
  hasActivities,
}: {
  hasSources: boolean;
  hasActivities: boolean;
}) {
  const steps = [
    {
      key: 'sources',
      done: hasSources,
      title: m.dashboard_start_sources_title(),
      body: m.dashboard_start_sources_body(),
      // `catalog: true` pops the preset catalog drawer on arrival — the
      // fastest path from nothing to a usable source is picking templates,
      // not hand-typing one.
      link: (
        <Link to="/sources" search={{ catalog: true }}>
          {m.dashboard_start_sources_cta()}
        </Link>
      ),
    },
    {
      key: 'activities',
      done: hasActivities,
      title: m.dashboard_start_activities_title(),
      body: m.dashboard_start_activities_body(),
      link: (
        <Link to="/activities" search={{ add: true }}>
          {m.dashboard_start_activities_cta()}
        </Link>
      ),
    },
    {
      key: 'report',
      // Never pre-satisfied: this card only renders while total CO2e is 0,
      // so the report step is always the one still ahead.
      done: false,
      title: m.dashboard_start_report_title(),
      body: m.dashboard_start_report_body(),
      link: <Link to="/reports">{m.dashboard_start_report_cta()}</Link>,
    },
  ];
  const currentIndex = steps.findIndex((s) => !s.done);

  return (
    <div className="rounded-lg border border-border/60 p-6">
      <h2 className="text-sm font-semibold text-foreground">{m.dashboard_start_title()}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{m.dashboard_start_subtitle()}</p>

      <ol className="mt-4 divide-y divide-border/40">
        {steps.map((step, i) => {
          const isCurrent = i === currentIndex;
          return (
            <li key={step.key} className="flex items-start gap-3 py-3">
              <StepMarker index={i} done={step.done} current={isCurrent} />
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'text-sm font-medium',
                    step.done ? 'text-muted-foreground' : 'text-foreground',
                  )}
                >
                  {step.title}
                </div>
                {/* Only the live step needs its "why" spelled out. Keeping the
                 * body on done/upcoming steps too would turn a 3-line
                 * checklist into a wall of prose. */}
                {isCurrent && (
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {step.body}
                  </p>
                )}
              </div>
              {isCurrent && (
                <Button asChild size="sm" className="shrink-0">
                  {/* cloneElement-free: Slot forwards the button styling onto
                   * the <Link> so the CTA is a real anchor (right-click,
                   * middle-click, keyboard all behave natively). */}
                  {step.link}
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Step bullet: green check when done, filled number when live, hollow number
 * when still ahead. State never rides on color alone — the check glyph and
 * the border weight carry it too.
 */
function StepMarker({ index, done, current }: { index: number; done: boolean; current: boolean }) {
  if (done) {
    return (
      <span
        // role="img" + aria-label so screen readers announce "done" rather
        // than skipping a decorative glyph — the check is the only thing
        // marking a completed step.
        role="img"
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
        aria-label={m.dashboard_start_step_done()}
      >
        <Check className="size-3" strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium tabular-nums',
        current
          ? 'bg-primary text-primary-foreground'
          : 'border border-border text-muted-foreground',
      )}
    >
      {index + 1}
    </span>
  );
}

/**
 * Single scope/total card. Round 2: label (uppercase tracking-wide) →
 * number (text-2xl) → unit (text-xs muted) read as three peers, not
 * "MASSIVE NUMBER with tiny suffix".
 */
function ScopeCard({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="bg-card text-card-foreground rounded-lg border border-border/60 p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{formatCo2e(value)}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{m.unit_kg_co2e()}</div>
    </div>
  );
}

/**
 * Recent activities widget — 5 most-recent activities by occurred_at_end.
 * Each row: source name, date, value. No emission factor / unit display
 * to keep it scannable; user clicks through to /activities for the full
 * table.
 */
function RecentActivitiesCard({
  activities,
  sourceById,
}: {
  activities: ActivityData[];
  sourceById: Map<string, EmissionSource>;
}) {
  // Sort desc by occurred_at_end so the freshest entries appear first.
  // listByPeriod returns ascending so we copy + reverse rather than
  // mutating the cached array.
  const recent = useMemo(
    () =>
      [...activities]
        .sort((a, b) => b.occurred_at_end.localeCompare(a.occurred_at_end))
        .slice(0, 5),
    [activities],
  );

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{m.dashboard_recent_activities()}</h2>
        <Link
          to="/activities"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {m.dashboard_widget_view_all()} →
        </Link>
      </div>
      {recent.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{m.dashboard_recent_empty()}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border/40">
          {recent.map((a) => {
            const source = sourceById.get(a.emission_source_id);
            return (
              <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{source?.name ?? a.emission_source_id}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {a.occurred_at_end.slice(0, 10)}
                  </span>
                </div>
                <span className="ml-3 shrink-0 font-mono tabular-nums text-foreground">
                  {formatCo2e(a.computed_co2e_kg)}{' '}
                  <span className="text-xs text-muted-foreground">{m.unit_kg_co2e()}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Monthly trend bar chart. Round 4 #5: no chart library — divs sized by
 * percentage of the max month. Simple, reads at a glance.
 *
 * Aggregation: bucket by YYYY-MM (occurred_at_end's month). Show last
 * 12 months. Months with no data render as a 1px-tall track so the eye
 * still sees the time axis without thinking "data missing".
 */
function MonthlyTrendCard({ activities }: { activities: ActivityData[] }) {
  const months = useMemo(() => buildMonthBuckets(activities), [activities]);
  const max = months.reduce((m, b) => Math.max(m, b.total), 0);

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{m.dashboard_monthly_trend()}</h2>
      </div>
      {max === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{m.dashboard_no_data_for_chart()}</p>
      ) : (
        <div
          className="mt-4 grid items-end gap-1"
          style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))`, height: 120 }}
        >
          {months.map((b) => {
            // Height as a percentage of the tallest bar; 1px floor so
            // empty months still render the axis baseline.
            const heightPct = b.total === 0 ? 1 : Math.max(2, (b.total / max) * 100);
            return (
              <div key={b.label} className="flex flex-col items-stretch gap-1">
                <div
                  className="flex items-end justify-center"
                  style={{ height: `${heightPct}%` }}
                  title={`${b.label} · ${formatCo2e(b.total)} kg CO2e`}
                >
                  <div className="w-full rounded-t bg-primary/60 hover:bg-primary transition-colors" />
                </div>
                <div className="text-center text-[10px] text-muted-foreground">{b.shortLabel}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type Bucket = { label: string; shortLabel: string; total: number };

function buildMonthBuckets(activities: ActivityData[]): Bucket[] {
  // Last 12 calendar months including current month.
  const now = new Date();
  const months: Bucket[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yyyymm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({
      label: yyyymm,
      shortLabel: `${d.getMonth() + 1}`, // "1", "2", ... — bar labels are tight
      total: 0,
    });
  }
  const byMonth = new Map(months.map((b) => [b.label, b]));
  for (const a of activities) {
    const key = a.occurred_at_end.slice(0, 7); // YYYY-MM
    const bucket = byMonth.get(key);
    if (bucket) bucket.total += a.computed_co2e_kg;
  }
  return months;
}
