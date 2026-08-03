import { expect, test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { baselineIpcMocks, FIXTURE_SOURCES, FIXTURE_SOURCES_WITH_STATS } from './fixtures.js';
import { navigateTo, snap, waitForReactMount, waitForRouteSettled } from './helpers.js';

/**
 * First-run zero state, in a real Electron window.
 *
 * The regression this guards: the dashboard used to offer exactly one
 * next step — "add your first activity" → /activities — but the onboarding
 * wizard never creates an emission source, and an activity can't exist
 * without one. The only CTA on a brand-new install led to a form that could
 * only refuse. vitest covers the branching; this spec proves the real chain
 * a first-time user walks is unbroken end to end.
 */

const EMPTY_TOTALS = { total_co2e_kg: 0, scope1_kg: 0, scope2_kg: 0, scope3_kg: 0 };

/** Baseline with every inventory-bearing channel emptied out. */
function emptyWorkspaceMocks(): Record<string, unknown> {
  return {
    ...baselineIpcMocks(),
    'source:list-by-org': [],
    'source:list-by-org-with-stats': [],
    'activity:list-by-period': [],
    'activity:totals-by-period': EMPTY_TOTALS,
  };
}

test('zero state: the dashboard sends a new user to sources, not to a dead end', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    cannedIpc: emptyWorkspaceMocks(),
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);
    await waitForRouteSettled(window);

    // Step 1 is the live one and it points at /sources — NOT /activities.
    const cta = window.getByRole('link', { name: '浏览排放源目录' });
    await expect(cta).toBeVisible({ timeout: 10_000 });
    await expect(window.getByRole('link', { name: '添加活动数据' })).toHaveCount(0);
    await snap(window, 'zero-state-01-dashboard-no-sources');

    // Following it opens the preset catalog drawer straight away.
    await cta.click();
    await expect(window.getByRole('heading', { name: '排放源' })).toBeVisible();
    await window.waitForTimeout(500);
    await snap(window, 'zero-state-02-sources-catalog-deeplink');

    // Close the drawer to reveal the /sources empty state behind it.
    await window.keyboard.press('Escape');
    await window.waitForTimeout(500);
    await expect(window.getByText('还没有排放源')).toBeVisible();
    await snap(window, 'zero-state-03-sources-empty');

    // /activities names the missing prerequisite and hands over the link.
    await navigateTo(window, '/activities');
    await waitForRouteSettled(window);
    await expect(window.getByText('请先建立排放源')).toBeVisible();
    await expect(window.getByRole('link', { name: '去建立排放源' })).toBeVisible();
    // The trap is gone: no way to open a form that can only refuse.
    await expect(window.getByRole('button', { name: '添加活动数据' })).toHaveCount(0);
    await expect(window.getByRole('button', { name: '批量导入' })).toHaveCount(0);
    await snap(window, 'zero-state-04-activities-needs-sources');
  } finally {
    await teardown(setup);
  }
});

test('zero state: the checklist advances to the activity step once sources exist', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    cannedIpc: {
      ...emptyWorkspaceMocks(),
      'source:list-by-org': FIXTURE_SOURCES,
      'source:list-by-org-with-stats': FIXTURE_SOURCES_WITH_STATS.map((s) => ({
        ...s,
        activity_count: 0,
        total_co2e_kg: 0,
        last_activity_at: null,
      })),
    },
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);
    await waitForRouteSettled(window);

    // Step 1 carries a check now; step 2 is live and opens the add drawer.
    const cta = window.getByRole('link', { name: '添加活动数据' });
    await expect(cta).toBeVisible({ timeout: 10_000 });
    await expect(window.getByRole('link', { name: '浏览排放源目录' })).toHaveCount(0);
    await snap(window, 'zero-state-05-dashboard-has-sources');

    await cta.click();
    await waitForRouteSettled(window);
    await expect(window.getByLabel('排放源')).toBeVisible({ timeout: 10_000 });
    await snap(window, 'zero-state-06-activities-add-deeplink');
  } finally {
    await teardown(setup);
  }
});
