import { runMigrations } from '@main/db/migrate';
import { createIpcContext, type IpcContext } from '@main/ipc/context';
import { readinessHandlers } from '@main/ipc/handlers/readiness';
import type { CredentialService } from '@main/services/credential-service';
import type { ReadinessReport } from '@shared/types';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * IPC glue only — the sweep itself is asserted in readiness-service.test.ts.
 * What matters here is that the channels validate their input and that
 * running a review needs no AI provider, which is the whole reason the rule
 * layer exists separately from the agent layer.
 */

/**
 * The readiness service getter chains into SettingsService -> CredentialService,
 * whose default construction builds a real CredentialStore -- and that throws on
 * Linux, where CI runs. Nothing here needs a real keychain: `get` returning null
 * IS the "no AI provider configured" case these tests assert.
 */
function noCredentials(): CredentialService {
  return {
    get: () => null,
    getMasked: () => null,
    set: () => {},
    delete: () => {},
    isAvailable: () => false,
  } as unknown as CredentialService;
}

const NOW = '2026-02-01T00:00:00.000Z';

let db: Database.Database;
let ctx: IpcContext;
let handlers: ReturnType<typeof readinessHandlers>;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  db.prepare(
    `INSERT INTO organization (id, name_en, country_code, boundary_kind, created_at, updated_at)
     VALUES ('org-1', 'Test Org', 'CN', 'operational_control', ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, created_at)
     VALUES ('rp-1', 'org-1', 2024, 'annual', '2024-01-01', '2024-12-31', ?)`,
  ).run(NOW);
  ctx = createIpcContext({ db, now: () => NOW }, { credentialService: noCredentials() });
  handlers = readinessHandlers(ctx);
});

describe('readiness IPC handlers', () => {
  it('readiness:run returns a report without any AI provider configured', async () => {
    const report = (await handlers['readiness:run']?.({
      reporting_period_id: 'rp-1',
    })) as ReadinessReport;

    expect(report.counts).toBeDefined();
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.checked_at).toBe(NOW);
    // D1 fires: the seeded org has no base year.
    expect(report.findings.map((f) => f.check_id)).toContain('D1');
  });

  // The handlers are synchronous, so zod throws at the call rather than
  // returning a rejected promise.
  it('readiness:run rejects a blank period id', () => {
    expect(() => handlers['readiness:run']?.({ reporting_period_id: '' })).toThrow();
  });

  it('readiness:dismiss hides the finding from the next run, undismiss restores it', async () => {
    const key = 'D1:organization:org-1';

    await handlers['readiness:dismiss']?.({ key });
    const afterDismiss = (await handlers['readiness:run']?.({
      reporting_period_id: 'rp-1',
    })) as ReadinessReport;
    expect(afterDismiss.findings.map((f) => f.check_id)).not.toContain('D1');
    expect(afterDismiss.dismissed_count).toBe(1);

    await handlers['readiness:undismiss']?.({ key });
    const afterUndismiss = (await handlers['readiness:run']?.({
      reporting_period_id: 'rp-1',
    })) as ReadinessReport;
    expect(afterUndismiss.findings.map((f) => f.check_id)).toContain('D1');
  });

  it('readiness:dismiss rejects a blank key', () => {
    expect(() => handlers['readiness:dismiss']?.({ key: '' })).toThrow();
  });
});
