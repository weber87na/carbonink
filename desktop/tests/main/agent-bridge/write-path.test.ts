import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAgentBridge, stopAgentBridge } from '@main/agent-bridge/server';
import { runMigrations } from '@main/db/migrate';
import { createIpcContext } from '@main/ipc/context';
import { buildDispatchMap } from '@main/ipc/dispatch';
import { agentBridgeAddress } from '@shared/agent-bridge/socket-path';
import type { AuditEvent } from '@shared/types';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * End-to-end over a real socket against a real service layer.
 *
 * The point of the whole spec (2026-08-13-mcp-write-path-integrity) is that a
 * write arriving from an external agent is indistinguishable from one made in
 * the GUI. These assert exactly that: EF unit conversion, the AR6 gas terms,
 * full precision, a ULID id and an `activity_data.created` audit event all
 * appear without the bridge doing anything about them — because the bridge
 * dispatches into `ActivityDataService.create`, not a copy of it.
 */

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function seed(db: Database.Database): void {
  db.prepare(
    `INSERT INTO organization (id, name_en, country_code, boundary_kind, created_at, updated_at)
     VALUES ('org-1', 'Test Org', 'CN', 'operational_control', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO site (id, organization_id, name_en, country_code, created_at, updated_at)
     VALUES ('site-1', 'org-1', 'HQ', 'CN', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO emission_source (id, site_id, name, scope) VALUES ('es-1', 'site-1', 'Grid electricity', 2)`,
  ).run();
  db.prepare(
    `INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, created_at)
     VALUES ('rp-1', 'org-1', 2024, 'annual', '2024-01-01', '2024-12-31', '2026-01-01T00:00:00Z')`,
  ).run();
  // Seeded in `emission_factor`, NOT `pinned_emission_factor`: the service
  // pins it itself inside the create transaction (EfService.pin copies the row
  // across), which is part of what the old direct-SQLite path skipped.
  //
  // Per-MWh with decomposed CH4/N2O so one row exercises BOTH gaps -- the
  // kWh->MWh conversion and the AR6 additive terms.
  db.prepare(
    `INSERT INTO emission_factor
       (factor_code, year, source, geography, dataset_version,
        scope, input_unit, co2e_kg_per_unit, ch4_kg_per_unit, n2o_kg_per_unit, gwp_basis)
     VALUES ('grid.mwh', 2024, 'MEE_China', 'CN', '2024.q4',
             2, 'MWh', 583.9, 0.01, 0.002, 'AR6')`,
  ).run();
}

function boot(): { db: Database.Database; address: string } {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  seed(db);

  const ctx = createIpcContext({ db, now: () => '2026-02-01T00:00:00.000Z' });
  const dispatch = buildDispatchMap(ctx);

  const dir = mkdtempSync(join(tmpdir(), 'carbonink-bridge-e2e-'));
  const address = agentBridgeAddress(dir);
  const server = startAgentBridge({ address, getDispatch: () => dispatch });
  cleanups.push(() => {
    stopAgentBridge(server, address);
    rmSync(dir, { recursive: true, force: true });
    db.close();
  });
  return { db, address };
}

function call(address: string, channel: string, input: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect(address, () =>
      socket.write(`${JSON.stringify({ id: 'x', channel, args: [input] })}\n`),
    );
    socket.setEncoding('utf-8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      socket.destroy();
      try {
        resolve(JSON.parse(line));
      } catch (err) {
        reject(err);
      }
    });
    socket.on('error', reject);
  });
}

const BASE_ACTIVITY = {
  emission_source_id: 'es-1',
  reporting_period_id: 'rp-1',
  occurred_at_start: '2024-01-01',
  occurred_at_end: '2024-12-31',
  ef_factor_code: 'grid.mwh',
  ef_year: 2024,
  ef_source: 'MEE_China',
  ef_geography: 'CN',
  ef_dataset_version: '2024.q4',
};

describe('agent bridge — activity writes match the GUI path', () => {
  it('converts the unit, applies the AR6 gas terms, and keeps full precision', async () => {
    const { db, address } = boot();

    // 1000 kWh against a per-MWh factor. The old direct-SQLite path multiplied
    // 1000 x 583.9 and rounded -- off by 1000x, silently.
    const res = await call(address, 'activity:create', {
      ...BASE_ACTIVITY,
      amount: 1000,
      unit: 'kWh',
    });

    expect(res.ok).toBe(true);
    const row = db.prepare('SELECT * FROM activity_data').get() as {
      id: string;
      computed_co2e_kg: number;
      site_id: string;
    };

    // 1 MWh x (583.9 + 0.01x27.9 + 0.002x273) = 583.9 + 0.279 + 0.546 = 584.725
    expect(row.computed_co2e_kg).toBeCloseTo(584.725, 6);
    // Not the two-decimal truncation the old path applied.
    expect(row.computed_co2e_kg).not.toBe(Math.round(row.computed_co2e_kg * 100) / 100);
    // site_id is derived from the emission source, which is why the tool no
    // longer takes one.
    expect(row.site_id).toBe('site-1');
    expect(row.id).toMatch(ULID);
  });

  it('writes an activity_data.created audit event so the lineage timeline is populated', async () => {
    const { db, address } = boot();

    await call(address, 'activity:create', { ...BASE_ACTIVITY, amount: 1, unit: 'MWh' });

    const events = db
      .prepare(`SELECT * FROM audit_event WHERE event_kind = 'activity_data.created'`)
      .all() as AuditEvent[];
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0]?.payload ?? '{}') as Record<string, unknown>;
    expect(payload['activity_id']).toMatch(ULID);
    expect(payload['emission_source_id']).toBe('es-1');
    expect(payload['computed_co2e_kg']).toBeCloseTo(584.725, 6);
  });

  it('rejects a cross-family unit without a fuel binding and writes nothing', async () => {
    const { db, address } = boot();

    const res = await call(address, 'activity:create', {
      ...BASE_ACTIVITY,
      amount: 100,
      unit: 'L', // volume against an energy factor
    });

    expect(res.ok).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM activity_data').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_event').get()).toEqual({ n: 0 });
  });
});

describe('agent bridge — answer writes record agent provenance', () => {
  function seedQuestion(db: Database.Database): void {
    db.prepare(`INSERT INTO customer (id, name, notes) VALUES ('cu-1', 'Acme', NULL)`).run();
    db.prepare(
      `INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
       VALUES ('doc-1', 'a1b2c3', 'q.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1, '/tmp/q.xlsx', '2026-01-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, due_date, created_at)
       VALUES ('qn-1', 'cu-1', 'doc-1', 2024, 'mapping', NULL, '2026-01-01T00:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required)
       VALUES ('q-1', 'qn-1', 'sig', 'v1', 'normalized', 'raw', NULL, 'numerical', 'kWh', 'A1', 0)`,
    ).run();
  }

  it('inserts an answer for a never-answered question as ai_suggested', async () => {
    const { db, address } = boot();
    seedQuestion(db);

    const res = await call(address, 'answer:save', {
      question_id: 'q-1',
      value: '1234',
      unit: 'kWh',
      finalize: false,
      source_kind: 'ai_suggested',
    });

    expect(res.ok).toBe(true);
    const row = db.prepare('SELECT * FROM answer WHERE question_id = ?').get('q-1') as {
      id: string;
      value: string;
      source_kind: string;
      finalized_at: string | null;
    };
    expect(row.value).toBe('1234');
    expect(row.source_kind).toBe('ai_suggested');
    expect(row.finalized_at).toBeNull();
    expect(row.id).toMatch(ULID);
  });

  it('updates an existing answer and can finalize it', async () => {
    const { db, address } = boot();
    seedQuestion(db);

    await call(address, 'answer:save', {
      question_id: 'q-1',
      value: 'first',
      unit: null,
      finalize: false,
      source_kind: 'ai_suggested',
    });
    await call(address, 'answer:save', {
      question_id: 'q-1',
      value: 'second',
      unit: null,
      finalize: true,
      source_kind: 'ai_suggested',
    });

    const rows = db.prepare('SELECT * FROM answer WHERE question_id = ?').all('q-1') as Array<{
      value: string;
      finalized_at: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe('second');
    expect(rows[0]?.finalized_at).not.toBeNull();
  });

  it('defaults to manual when source_kind is omitted, so the renderer keeps claiming manual', async () => {
    const { db, address } = boot();
    seedQuestion(db);

    await call(address, 'answer:save', {
      question_id: 'q-1',
      value: 'typed by a human',
      unit: null,
      finalize: false,
    });

    const row = db.prepare('SELECT source_kind FROM answer WHERE question_id = ?').get('q-1');
    expect(row).toEqual({ source_kind: 'manual' });
  });

  it('fails cleanly for an unknown question instead of writing an orphan row', async () => {
    const { db, address } = boot();
    seedQuestion(db);

    const res = await call(address, 'answer:save', {
      question_id: 'does-not-exist',
      value: 'x',
      unit: null,
      finalize: false,
      source_kind: 'ai_suggested',
    });

    expect(res.ok).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM answer').get()).toEqual({ n: 0 });
  });
});
