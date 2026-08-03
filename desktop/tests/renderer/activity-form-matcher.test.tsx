/**
 * Tests for the "Recommended for this document" section in ActivityForm.
 * Covers:
 *   1. Happy path — matcherHint + source selected → Recommended section renders.
 *   2. LLM failure fallback — recommend() rejects → no heading, full list preserved.
 *   3. No matcherHint — recommend() is never called.
 */

// Module-level mocks MUST precede any imports that reference the mocked modules.
vi.mock('@renderer/lib/api/routing', () => ({
  routingApi: {
    lookup: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/ef-matcher', () => ({
  efMatcherApi: {
    recommend: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/organization', () => ({
  orgApi: {
    getCurrent: vi.fn(),
    listReportingPeriods: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/activity-data', () => ({
  activityApi: {
    create: vi.fn(),
    listByPeriod: vi.fn(),
  },
}));
vi.mock('@renderer/lib/api/ef-library', () => ({
  efApi: {
    list: vi.fn(),
  },
}));

import { ActivityForm } from '@renderer/components/ActivityForm';
import { efApi } from '@renderer/lib/api/ef-library';
import { efMatcherApi } from '@renderer/lib/api/ef-matcher';
import { orgApi } from '@renderer/lib/api/organization';
import { routingApi } from '@renderer/lib/api/routing';
import type { EmissionFactor, EmissionSource, ReportingPeriod } from '@shared/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Shared fixtures ──────────────────────────────────────────────────────────

const FAKE_SOURCE: EmissionSource = {
  id: 'src_diesel',
  site_id: 'site_01',
  name: '柴油锅炉',
  scope: 1 as const,
  category: 'fuel.combustion',
  ghg_protocol_path: null,
  default_ef_query: null,
  template_origin: null,
  is_active: true,
};

const FAKE_PERIOD: ReportingPeriod = {
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

const BASE_EF: EmissionFactor = {
  factor_code: 'fuel.diesel.combustion',
  year: 2024,
  source: 'IPCC_AR6',
  geography: 'GLOBAL',
  dataset_version: '2024.q1',
  scope: 1,
  category: 'fuel.combustion',
  ghg_protocol_path: null,
  input_unit: 'L',
  co2e_kg_per_unit: 2.68,
  ch4_kg_per_unit: null,
  n2o_kg_per_unit: null,
  hfc_kg_per_unit: null,
  pfc_kg_per_unit: null,
  sf6_kg_per_unit: null,
  nf3_kg_per_unit: null,
  gwp_basis: 'AR6',
  name_zh: '柴油',
  name_en: 'Diesel',
  description_zh: null,
  description_en: null,
  notes: null,
  biogenic_co2_factor: null,
  citation_url: null,
};

const GASOLINE_EF: EmissionFactor = {
  ...BASE_EF,
  factor_code: 'fuel.gasoline.combustion',
  name_zh: '汽油',
  name_en: 'Gasoline',
};

const LPG_EF: EmissionFactor = {
  ...BASE_EF,
  factor_code: 'fuel.lpg.combustion',
  name_zh: '液化石油气',
  name_en: 'LPG',
};

// ── Harness ──────────────────────────────────────────────────────────────────

/**
 * Wraps ActivityForm in a QueryClientProvider. The form is rendered directly
 * (no route) since we're testing component-level behaviour.
 */
function buildHarness(props: React.ComponentProps<typeof ActivityForm>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ActivityForm {...props} />
    </QueryClientProvider>
  );
}

const DEFAULT_PROPS = {
  organizationId: 'org_01',
  sources: [FAKE_SOURCE],
  onCancel: vi.fn(),
  onSuccess: vi.fn(),
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ActivityForm — matcher recommended section', () => {
  beforeEach(() => {
    vi.mocked(orgApi.listReportingPeriods).mockResolvedValue([FAKE_PERIOD]);
    // Default: full EF list returns only BASE_EF (full list must remain visible).
    vi.mocked(efApi.list).mockResolvedValue([BASE_EF, GASOLINE_EF, LPG_EF]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders Recommended section when matcherHint + source selected + LLM happy path', async () => {
    vi.mocked(efMatcherApi.recommend).mockResolvedValue({
      recommended: [
        { ef: BASE_EF, reasoning_zh: '直接命中柴油' },
        { ef: GASOLINE_EF, reasoning_zh: '同类燃料' },
        { ef: LPG_EF, reasoning_zh: '兜底' },
      ],
      ranked_full: [BASE_EF],
    });

    render(
      buildHarness({
        ...DEFAULT_PROPS,
        initialValues: {
          matcherHint: { extraction_id: 'e1', stage_id: 'fuel_receipt.v1' },
        },
      }),
    );

    // Pick a source to enable the matcher query.
    const sourceSelect = (await screen.findByLabelText(
      /Emission source|^排放源$/i,
    )) as HTMLSelectElement;
    fireEvent.change(sourceSelect, { target: { value: FAKE_SOURCE.id } });

    // The recommended heading should appear.
    expect(await screen.findByText(/Recommended for this document|为本单据推荐/)).toBeTruthy();

    // All three reasoning strings should be in the DOM.
    expect(await screen.findByText('直接命中柴油')).toBeTruthy();
    expect(screen.getByText('同类燃料')).toBeTruthy();
    expect(screen.getByText('兜底')).toBeTruthy();

    // efMatcherApi.recommend was called with the right params.
    expect(efMatcherApi.recommend).toHaveBeenCalledWith({
      extraction_id: 'e1',
      emission_source_id: FAKE_SOURCE.id,
    });
  });

  it('omits Recommended section when LLM fails, and preserves full list', async () => {
    vi.mocked(efMatcherApi.recommend).mockRejectedValue(new Error('LLM down'));

    render(
      buildHarness({
        ...DEFAULT_PROPS,
        initialValues: {
          matcherHint: { extraction_id: 'e1', stage_id: 'fuel_receipt.v1' },
        },
      }),
    );

    const sourceSelect = (await screen.findByLabelText(
      /Emission source|^排放源$/i,
    )) as HTMLSelectElement;
    fireEvent.change(sourceSelect, { target: { value: FAKE_SOURCE.id } });

    // Wait for the efApi full list to resolve (radios appear).
    const radios = await screen.findAllByRole('radio');
    expect(radios.length).toBeGreaterThan(0);

    // Recommended heading must NOT be in the DOM.
    expect(screen.queryByText(/Recommended for this document|为本单据推荐/)).toBeNull();
  });

  it('does not call matcher when matcherHint is absent', async () => {
    render(
      buildHarness({
        ...DEFAULT_PROPS,
        initialValues: { unit: 'kWh' }, // no matcherHint
      }),
    );

    const sourceSelect = (await screen.findByLabelText(
      /Emission source|^排放源$/i,
    )) as HTMLSelectElement;
    fireEvent.change(sourceSelect, { target: { value: FAKE_SOURCE.id } });

    // Wait for the EF list to load so any async work has settled.
    await screen.findAllByRole('radio');

    // efMatcherApi.recommend must never have been called.
    await waitFor(() => {
      expect(efMatcherApi.recommend).not.toHaveBeenCalled();
    });
  });
});

// ── Routing lookup button ────────────────────────────────────────────────────

describe('ActivityForm — routing lookup button', () => {
  beforeEach(() => {
    vi.mocked(orgApi.listReportingPeriods).mockResolvedValue([FAKE_PERIOD]);
    vi.mocked(efApi.list).mockResolvedValue([BASE_EF]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders Look up distance button when freight row has origin+destination', async () => {
    render(
      buildHarness({
        ...DEFAULT_PROPS,
        initialValues: {
          unit: 'kg',
          routingHint: {
            stage: 'freight',
            origin: '北京',
            destination: '上海',
          },
        },
      }),
    );

    // Wait for form to mount.
    await screen.findByLabelText(/Emission source|^排放源$/i);

    // The "Look up distance" button should be present.
    const btn = screen.getByRole('button', { name: /Look up distance|查询距离/i });
    expect(btn).toBeTruthy();
  });

  it('does not render Look up distance button when routingHint is absent', async () => {
    render(
      buildHarness({
        ...DEFAULT_PROPS,
        initialValues: { unit: 'kg' },
      }),
    );

    await screen.findByLabelText(/Emission source|^排放源$/i);

    expect(screen.queryByRole('button', { name: /Look up distance|查询距离/i })).toBeNull();
  });

  it('calls routingApi.lookup with correct args on button click and shows badge', async () => {
    vi.mocked(routingApi.lookup).mockResolvedValue({
      ok: true,
      distance_km: 1085,
      source: 'amap',
      cached: false,
    });

    render(
      buildHarness({
        ...DEFAULT_PROPS,
        initialValues: {
          unit: 'kg',
          amount: '500',
          routingHint: {
            stage: 'freight',
            origin: '北京',
            destination: '上海',
          },
        },
      }),
    );

    await screen.findByLabelText(/Emission source|^排放源$/i);

    const btn = screen.getByRole('button', { name: /Look up distance|查询距离/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(routingApi.lookup).toHaveBeenCalledWith({
        mode: 'driving',
        origin: '北京',
        destination: '上海',
      });
    });

    // Source badge should show.
    await screen.findByText(/AMap.*1085|高德.*1085/);
  });
});

/**
 * Prerequisite guard. Moved here from `activities.test.tsx`, which used to
 * drive it by clicking the page's toolbar Add button — that button is now
 * hidden while the activity list is empty, so the guard has to be exercised
 * at the component boundary instead.
 *
 * The guard renders a message + escape hatches instead of the form body, so
 * users can't fill in dates and amounts only to meet a permanently-disabled
 * submit button. The "go set up sources" escape hatch is a router <Link>,
 * hence the RouterProvider wrapper.
 */
describe('ActivityForm — missing prerequisites', () => {
  beforeEach(() => {
    vi.mocked(orgApi.listReportingPeriods).mockResolvedValue([FAKE_PERIOD]);
    vi.mocked(efApi.list).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders the no-sources message and a link out, not the form body', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    const rootRoute = createRootRoute({
      component: () => (
        <ActivityForm {...DEFAULT_PROPS} sources={[]} onCancel={vi.fn()} onSuccess={vi.fn()} />
      ),
    });
    const sourcesRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/sources',
      component: () => <div />,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([sourcesRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/No sources yet|还没有排放源。请先在/i)).toBeTruthy();

    // The escape hatch out of the dead end.
    const link = screen.getByRole('link', { name: /Set up emission sources|去建立排放源/i });
    expect(link.getAttribute('href')).toBe('/sources?catalog=true');

    // The form body does NOT render.
    expect(screen.queryByLabelText(/Emission source|^排放源$/i)).toBeNull();
    expect(screen.queryByLabelText(/Reporting period|报告期/i)).toBeNull();
    expect(screen.queryByLabelText(/Start date|开始日期/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Record activity|记录活动/i })).toBeNull();
  });
});
