#!/usr/bin/env node
/**
 * Seed the LOCAL running app's sqlite with a realistic inventory so the
 * questionnaire AI answer flow has data to summarize from.
 *
 * This used to carry ~8 hand-written synthetic rows (3,200 kWh here, 152.8 L
 * there, and a business-travel row that borrowed the *electricity* factor
 * because no travel factor was wired up yet). Those numbers taught you nothing
 * about whether a screen holds up, and the borrowed factor was quietly wrong.
 * It now loads one of the real-company packs in src/main/data/demo/ instead —
 * figures transcribed from published sustainability reports, each row carrying
 * the report page it came from.
 *
 * Usage (unchanged for callers):
 *   node scripts/seed-test-data.mjs
 *   node scripts/seed-test-data.mjs --db /custom/path/to/app.sqlite
 *   node scripts/seed-test-data.mjs --pack sf-holding-fy2025
 *
 * Default pack: hsbc-fy2025. It is the only one with activity rows in all
 * three scopes, which is what the answer-generation flow and the MCP
 * list_emission_sources(scope=N) queries need. The others publish Scope 3 as
 * bare tCO2e totals with no activity quantities behind them.
 *
 * Pre-flight: the app must have been launched at least once so the
 * organization + first site rows exist. This script attaches to the existing
 * organization (--adopt-org), so the org keeps whatever name onboarding gave
 * it while the inventory underneath is real. Every activity row's `notes`
 * carries its provenance, so the mix is visible rather than misleading.
 *
 * For a clean single-company database instead, skip this wrapper:
 *   node scripts/seed-demo-company.mjs --pack catl-fy2025 --db /tmp/x.sqlite --init
 *
 * ABI note: run under plain node. After `pnpm build` / electron-rebuild the
 * better-sqlite3 binding is built for Electron and this fails with
 * NODE_MODULE_VERSION mismatch. Fix: pnpm --filter carbonink run rebuild:node
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PACK = 'hsbc-fy2025';

const { values } = parseArgs({
  options: {
    db: { type: 'string' },
    pack: { type: 'string' },
  },
});

const args = [
  join(HERE, 'seed-demo-company.mjs'),
  '--pack',
  values.pack ?? DEFAULT_PACK,
  // The dev database already holds whatever organization onboarding created.
  // organization is a hard singleton, so the pack cannot bring its own.
  '--adopt-org',
];
if (values.db) args.push('--db', values.db);

const res = spawnSync('node', args, { stdio: 'inherit' });
process.exit(res.status ?? 1);
