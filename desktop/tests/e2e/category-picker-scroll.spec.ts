import { expect, test } from '@playwright/test';
import { launchApp, teardown } from './_setup.js';
import { baselineIpcMocks, FIXTURE_SOURCES_WITH_STATS } from './fixtures.js';
import { navigateTo, waitForReactMount, waitForRouteSettled } from './helpers.js';

/**
 * The emission-category picker's option list must scroll inside the edit
 * drawer.
 *
 * This needs a real browser: the failure was `react-remove-scroll`
 * cancelling wheel events. vaul (and Radix dialogs) mount it with their own
 * content element as the sole shard, so a popover portaled to
 * `document.body` — Radix's default — renders and clicks perfectly but
 * refuses to scroll. jsdom/happy-dom have no wheel-to-scroll behaviour to
 * cancel, so unit tests can only assert where the portal mounts; whether
 * the list actually moves is only observable here.
 *
 * Scope 3 is the case that exposes it — 15 categories overflow the list's
 * max height, where scope 1 and 2 (four each) never do.
 */
test('scope 3 category list scrolls inside the source edit drawer', async () => {
  const setup = await launchApp({
    cannedExtractions: {},
    cannedRecommendations: {},
    cannedIpc: {
      ...baselineIpcMocks(),
      'source:list-by-org-with-stats': FIXTURE_SOURCES_WITH_STATS,
    },
  });

  try {
    const { window } = setup;
    await waitForReactMount(window);
    await navigateTo(window, '/sources');
    await waitForRouteSettled(window);

    // The scope 3 fixture — opens the drawer with 15 categories on offer.
    await window.getByRole('button', { name: /员工出差/ }).click();
    await expect(window.getByRole('heading', { name: '编辑排放源' })).toBeVisible();

    await window.getByRole('combobox', { name: /分类/ }).click();
    const list = window.locator('[data-slot="command-list"]');
    await expect(list).toBeVisible();

    // Precondition: the list really does overflow. Without this the scroll
    // assertion below would pass vacuously if the taxonomy ever shrank.
    const overflows = await list.evaluate((el) => el.scrollHeight > el.clientHeight + 8);
    expect(overflows).toBe(true);

    expect(await list.evaluate((el) => el.scrollTop)).toBe(0);

    await list.hover();
    await window.mouse.wheel(0, 240);
    await expect
      .poll(async () => list.evaluate((el) => el.scrollTop), { timeout: 5_000 })
      .toBeGreaterThan(0);

    // And the categories further down are reachable, which is the point.
    await expect(window.getByRole('option', { name: /3\.15 投资/ })).toBeVisible();
  } finally {
    await teardown(setup);
  }
});
