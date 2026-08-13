import { ReadinessSection } from '@renderer/components/readiness/ReadinessSection';
import type { ReadinessReport } from '@shared/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/lib/api/readiness', () => ({
  readinessApi: { run: vi.fn(), dismiss: vi.fn(), undismiss: vi.fn() },
}));

import { readinessApi } from '@renderer/lib/api/readiness';

function report(partial: Partial<ReadinessReport> = {}): ReadinessReport {
  return {
    findings: [],
    counts: { blocker: 0, warning: 0, info: 0 },
    dismissed_count: 0,
    checked_at: '2026-02-01T00:00:00.000Z',
    ...partial,
  };
}

function buildHarness(node: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <>{node}</>,
  });
  // Stub every target a finding can deep-link to, so a broken link surfaces
  // here rather than as a dead end in the app.
  const stubs = [
    '/activities',
    '/sources',
    '/settings',
    '/questionnaires/$id',
    '/supplier-disclosures/$id',
  ].map((path) => createRoute({ getParentRoute: () => rootRoute, path, component: () => null }));
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, ...stubs]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

/** The router mounts asynchronously, so the button has to be awaited. */
async function clickRun(): Promise<void> {
  const button = await screen.findByRole('button', { name: /开始体检|Run review/ });
  fireEvent.click(button);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ReadinessSection', () => {
  beforeEach(() => {
    vi.mocked(readinessApi.run).mockResolvedValue(report());
  });

  it('does not run the sweep on mount', () => {
    render(buildHarness(<ReadinessSection reportingPeriodId="rp-1" />));
    // The sweep writes an audit event; running it per page visit would turn
    // the audit log into browsing history.
    expect(readinessApi.run).not.toHaveBeenCalled();
  });

  it('runs on demand and reports an all-clear', async () => {
    render(buildHarness(<ReadinessSection reportingPeriodId="rp-1" />));
    await clickRun();

    await waitFor(() => expect(readinessApi.run).toHaveBeenCalledWith('rp-1'));
    expect(await screen.findByText(/没有发现问题|Nothing to flag/)).toBeTruthy();
  });

  it('renders a blocker with its severity label, not colour alone', async () => {
    vi.mocked(readinessApi.run).mockResolvedValue(
      report({
        findings: [
          {
            check_id: 'N1',
            severity: 'blocker',
            entity: { type: 'activity_data', id: 'act-1' },
            facts: {
              source_name: 'Grid electricity',
              amount: 100,
              unit: 'L',
              ef_input_unit: 'kWh',
            },
          },
        ],
        counts: { blocker: 1, warning: 0, info: 0 },
      }),
    );

    render(buildHarness(<ReadinessSection reportingPeriodId="rp-1" />));
    await clickRun();

    expect(await screen.findByText(/单位与排放因子量纲不符|Unit does not match/)).toBeTruthy();
    // The severity is spelled out; a colour-only indicator would exclude
    // colour-blind users (PRODUCT.md accessibility rule).
    expect(screen.getByText(/^阻断$|^Blocker$/)).toBeTruthy();
    // The interpolated facts reach the copy.
    expect(screen.getByText(/Grid electricity/)).toBeTruthy();
  });

  it('gives a row-level finding a link to the screen that fixes it', async () => {
    vi.mocked(readinessApi.run).mockResolvedValue(
      report({
        findings: [
          {
            check_id: 'T2',
            severity: 'blocker',
            entity: { type: 'activity_data', id: 'act-9' },
            facts: { source_name: 'Grid electricity', created_at: '2026-01-01' },
          },
        ],
        counts: { blocker: 1, warning: 0, info: 0 },
      }),
    );

    render(buildHarness(<ReadinessSection reportingPeriodId="rp-1" />));
    await clickRun();

    const link = await screen.findByRole('link', { name: /查看|Open/ });
    expect(link.getAttribute('href')).toContain('highlight=act-9');
  });

  it('offers no link for a period-level finding, which no single row fixes', async () => {
    vi.mocked(readinessApi.run).mockResolvedValue(
      report({
        findings: [
          {
            check_id: 'N5',
            severity: 'blocker',
            entity: { type: 'period', id: 'rp-1' },
            facts: { year: 2024, bases: 'AR5, AR6' },
          },
        ],
        counts: { blocker: 1, warning: 0, info: 0 },
      }),
    );

    render(buildHarness(<ReadinessSection reportingPeriodId="rp-1" />));
    await clickRun();

    await screen.findByText(/同一报告期混用了 GWP 口径|Mixed GWP bases/);
    expect(screen.queryByRole('link', { name: /查看|Open/ })).toBeNull();
  });

  it('dismisses a finding through the api and re-runs', async () => {
    vi.mocked(readinessApi.run).mockResolvedValue(
      report({
        findings: [
          {
            check_id: 'D1',
            severity: 'warning',
            entity: { type: 'organization', id: 'org-1' },
            facts: { year: 2024 },
          },
        ],
        counts: { blocker: 0, warning: 1, info: 0 },
      }),
    );
    vi.mocked(readinessApi.dismiss).mockResolvedValue(undefined);

    render(buildHarness(<ReadinessSection reportingPeriodId="rp-1" />));
    await clickRun();
    await screen.findByText(/尚未设定基准年|No base year set/);

    fireEvent.click(screen.getByRole('button', { name: /^忽略$|^Dismiss$/ }));
    await waitFor(() => expect(readinessApi.dismiss).toHaveBeenCalledWith('D1:organization:org-1'));
  });
});
