import { Route as IndexRoute } from '@renderer/routes/index';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the IPC wrappers — the dashboard mounts inside a test router with no
// preload bridge, so we intercept at the wrapper layer. Same pattern as the
// sources / activities route tests.
vi.mock('@renderer/lib/api/organization', () => ({
  orgApi: {
    hasAny: vi.fn(),
    getCurrent: vi.fn(),
    listReportingPeriods: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/activity-data', () => ({
  activityApi: {
    totalsByPeriod: vi.fn(),
    listByPeriod: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/emission-source', () => ({
  sourceApi: {
    listByOrg: vi.fn(),
  },
}));

import { activityApi } from '@renderer/lib/api/activity-data';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { orgApi } from '@renderer/lib/api/organization';

const FAKE_ORG = {
  id: 'org_01',
  name_zh: '中山钢铁',
  name_en: null,
  industry: null,
  country_code: 'CN',
  boundary_kind: 'operational_control' as const,
  responsible_person_name: null,
  responsible_person_role: null,
  base_year_period_id: null,
  recalc_threshold_pct: 5.0,
  created_at: '2026-05-11T00:00:00Z',
  updated_at: '2026-05-11T00:00:00Z',
};

const FAKE_PERIOD = {
  id: 'period_01',
  organization_id: 'org_01',
  year: 2026,
  granularity: 'annual' as const,
  starts_at: '2026-01-01',
  ends_at: '2026-12-31',
  is_active: 1,
  created_at: '2026-05-11T00:00:00Z',
  significant_changes_text: null,
  recalculation_reason: null,
};

// Same harness trick as sources/activities tests: we can't reuse the
// file-route under a test root (its generated parent is locked), so we
// rebuild a minimal tree mounting the same component.
const indexComponent: NonNullable<typeof IndexRoute.options.component> = (() => {
  const c = IndexRoute.options.component;
  if (!c) throw new Error('index route is missing a component');
  return c;
})();

function buildHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const rootRoute = createRootRoute({
    component: () => <Outlet />,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: indexComponent,
  });
  // The getting-started checklist links to /sources, /activities and
  // /reports, so all three must exist for the <Link>s to resolve under the
  // test router. The components are irrelevant — assertions only inspect the
  // rendered DOM at /.
  const stubRoutes = ['/sources', '/activities', '/reports'].map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <div />,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, ...stubRoutes]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const FAKE_SOURCE = {
  id: 'src_01',
  site_id: 'site_01',
  name: 'Purchased Electricity',
  scope: 2 as const,
  category: 'electricity.grid',
  ghg_protocol_path: null,
  default_ef_query: null,
  template_origin: null,
  is_active: true,
};

describe('/ dashboard route', () => {
  beforeEach(() => {
    vi.mocked(orgApi.hasAny).mockResolvedValue(true);
    vi.mocked(orgApi.getCurrent).mockResolvedValue(FAKE_ORG);
    vi.mocked(orgApi.listReportingPeriods).mockResolvedValue([FAKE_PERIOD]);
    vi.mocked(sourceApi.listByOrg).mockResolvedValue([]);
    vi.mocked(activityApi.listByPeriod).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders four scope cards with 0 and the empty-state hint when totals are zero', async () => {
    vi.mocked(activityApi.totalsByPeriod).mockResolvedValue({
      total_co2e_kg: 0,
      scope1_kg: 0,
      scope2_kg: 0,
      scope3_kg: 0,
    });

    render(buildHarness());

    // All four labels appear — Total CO2e + Scope 1/2/3.
    expect(await screen.findByText(/Total CO2e|总 CO2e/i)).toBeTruthy();
    expect(screen.getByText(/^Scope 1$|^范围 1$/i)).toBeTruthy();
    expect(screen.getByText(/^Scope 2$|^范围 2$/i)).toBeTruthy();
    expect(screen.getByText(/^Scope 3$|^范围 3$/i)).toBeTruthy();

    // Each card shows "0 kg CO2e" — there are four "0"s on the page.
    await waitFor(() => {
      const zeros = screen.getAllByText(/^0$/);
      expect(zeros.length).toBe(4);
    });

    // Getting-started checklist: with no sources yet, step 1 is the live one
    // and points at /sources with the catalog drawer pre-opened. It must NOT
    // point at /activities — an activity can't exist without a source, which
    // is exactly the dead end this checklist replaced.
    const link = await screen.findByRole('link', {
      name: /Browse the catalog|浏览排放源目录/i,
    });
    expect(link.getAttribute('href')).toBe('/sources?catalog=true');
    expect(screen.queryByRole('link', { name: /Add activity data|添加活动数据/i })).toBeNull();
  });

  it('advances the checklist to the activity step once sources exist', async () => {
    vi.mocked(activityApi.totalsByPeriod).mockResolvedValue({
      total_co2e_kg: 0,
      scope1_kg: 0,
      scope2_kg: 0,
      scope3_kg: 0,
    });
    vi.mocked(sourceApi.listByOrg).mockResolvedValue([FAKE_SOURCE]);

    render(buildHarness());

    // Step 2 is now live and opens the add drawer on arrival.
    const link = await screen.findByRole('link', {
      name: /Add activity data|添加活动数据/i,
    });
    expect(link.getAttribute('href')).toBe('/activities?add=true');

    // Step 1 is done — it keeps its title but loses its button.
    expect(screen.getByText(/Set up emission sources|建立排放源/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Browse the catalog|浏览排放源目录/i })).toBeNull();
  });

  it('formats non-zero totals with thousands separators and hides the empty-state hint', async () => {
    vi.mocked(activityApi.totalsByPeriod).mockResolvedValue({
      total_co2e_kg: 1234.56,
      scope1_kg: 100,
      scope2_kg: 1134.56,
      scope3_kg: 0,
    });

    render(buildHarness());

    // Total formats to "1,234.6" (zh-CN locale, maximumFractionDigits=1).
    expect(await screen.findByText('1,234.6')).toBeTruthy();
    // Scope 2 also formats with thousands separator.
    expect(screen.getByText('1,134.6')).toBeTruthy();
    // Scope 1 = "100" (no decimals when integer).
    expect(screen.getByText('100')).toBeTruthy();

    // total_co2e_kg !== 0 → the getting-started checklist must NOT render.
    expect(screen.queryByText(/Start here|从这里开始/i)).toBeNull();
  });
});
