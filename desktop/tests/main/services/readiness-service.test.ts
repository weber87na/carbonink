import { runMigrations } from '@main/db/migrate';
import { ReadinessService } from '@main/services/readiness/index';
import { READINESS_CHECKS } from '@main/services/readiness/registry';
import { UnitConversionService } from '@main/services/unit-conversion-service';
import { type ReadinessCheckId, readinessFindingKey } from '@shared/types';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Every check gets a positive and a negative case, plus one fixture that is
 * deliberately CLEAN and must produce zero findings across all 14. That last
 * one is the real acceptance bar: a checklist that fires on a healthy
 * inventory gets ignored wholesale, which is worse than having no checklist.
 */

const NOW = '2026-02-01T00:00:00.000Z';
const PERIOD = 'rp-1';

let db: Database.Database;
let svc: ReadinessService;

/**
 * The outlier ratio is stubbed rather than read through the real
 * SettingsService: that service wants the credential store, and its own
 * default/fallback behaviour is covered in settings-service.test.ts. What
 * matters here is that ReadinessService honours whatever it is given, which
 * the custom-ratio case below asserts directly.
 */
function build(outlierRatio = 10): ReadinessService {
  return new ReadinessService({
    db,
    now: () => NOW,
    unitConversion: new UnitConversionService({ db }),
    settings: { getImportOutlierRatio: () => outlierRatio },
  });
}

/** A workspace with one source, one factor, one clean activity row. */
function seedClean(): void {
  // base_year_period_id is set after the period exists -- it is a real FK.
  db.prepare(
    `INSERT INTO organization (id, name_en, country_code, boundary_kind, created_at, updated_at)
     VALUES ('org-1', 'Test Org', 'CN', 'operational_control', ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO site (id, organization_id, name_en, country_code, created_at, updated_at)
     VALUES ('site-1', 'org-1', 'HQ', 'CN', ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO reporting_period (id, organization_id, year, granularity, starts_at, ends_at, created_at)
     VALUES ('rp-1', 'org-1', 2024, 'annual', '2024-01-01', '2024-12-31', ?)`,
  ).run(NOW);
  db.prepare(`UPDATE organization SET base_year_period_id = 'rp-1' WHERE id = 'org-1'`).run();
  db.prepare(
    `INSERT INTO emission_source (id, site_id, name, scope) VALUES ('es-1', 'site-1', 'Grid electricity', 2)`,
  ).run();
  pinEf({ code: 'grid.kwh', year: 2024, unit: 'kWh', gwp: 'AR6' });
  seedExtraction('ex-clean');
  insertActivity({ id: 'act-1', amount: 1000, unit: 'kWh', extractionId: 'ex-clean' });
  writeCreatedEvent('act-1');
}

function pinEf(o: {
  code: string;
  year: number;
  unit: string;
  gwp: 'AR5' | 'AR6';
  source?: string;
}): void {
  db.prepare(
    `INSERT INTO pinned_emission_factor
       (factor_code, year, source, geography, dataset_version, scope, input_unit,
        co2e_kg_per_unit, gwp_basis, pinned_at, pinned_from)
     VALUES (?, ?, ?, 'CN', 'v1', 2, ?, 0.5, ?, ?, 'emission_factor')`,
  ).run(o.code, o.year, o.source ?? 'MEE_China', o.unit, o.gwp, NOW);
}

function insertActivity(o: {
  id: string;
  amount: number;
  unit: string;
  code?: string;
  efYear?: number;
  efSource?: string;
  start?: string;
  end?: string;
  fuelCode?: string | null;
  extractionId?: string | null;
}): void {
  db.prepare(
    `INSERT INTO activity_data
       (id, site_id, emission_source_id, reporting_period_id, occurred_at_start, occurred_at_end,
        amount, unit, ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
        computed_co2e_kg, computed_at, fuel_code, extraction_id, notes, created_at, updated_at)
     VALUES (?, 'site-1', 'es-1', 'rp-1', ?, ?, ?, ?, ?, ?, ?, 'CN', 'v1', ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    o.id,
    o.start ?? '2024-01-01',
    o.end ?? '2024-12-31',
    o.amount,
    o.unit,
    o.code ?? 'grid.kwh',
    o.efYear ?? 2024,
    o.efSource ?? 'MEE_China',
    o.amount * 0.5,
    NOW,
    o.fuelCode ?? null,
    o.extractionId ?? null,
    NOW,
    NOW,
  );
}

/** A parsed extraction, which the table's CHECK requires to carry both payloads. */
function seedExtraction(id: string): void {
  db.prepare(
    `INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
     VALUES (?, ?, 'bill.pdf', 'application/pdf', 1, '/tmp/bill.pdf', ?)`,
  ).run(`doc-${id}`, `sha-${id}`, NOW);
  db.prepare(
    `INSERT INTO extraction (id, document_id, llm_provider, llm_model, prompt_version,
                             raw_response, parsed_json, status, created_at)
     VALUES (?, ?, 'p', 'm', 'v1', '{}', '{}', 'parsed', ?)`,
  ).run(id, `doc-${id}`, NOW);
}

function writeCreatedEvent(activityId: string): void {
  db.prepare(
    `INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, 'activity_data.created', ?, ?)`,
  ).run(`ae-${activityId}`, JSON.stringify({ activity_id: activityId }), NOW);
}

function seedOutboundQuestion(answered: boolean): void {
  db.prepare(`INSERT INTO customer (id, name, notes) VALUES ('cu-1', 'Acme', NULL)`).run();
  db.prepare(
    `INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
     VALUES ('doc-1', 'sha', 'q.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1, '/tmp/q', ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, direction, due_date, created_at)
     VALUES ('qn-1', 'cu-1', 'doc-1', 2024, 'mapping', 'outbound', NULL, ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO question (id, questionnaire_id, question_signature, signature_version, normalized_text, raw_text, parsed_intent, question_kind, expected_unit, position, required)
     VALUES ('q-1', 'qn-1', 'sig', 'v1', 'n', 'raw', NULL, 'numerical', 'kWh', 'A1', 0)`,
  ).run();
  if (answered) {
    db.prepare(
      `INSERT INTO answer (id, question_id, value, unit, source_kind, source_summary, finalized_at)
       VALUES ('a-1', 'q-1', '1', 'kWh', 'manual', NULL, NULL)`,
    ).run();
  }
}

function idsFor(check: ReadinessCheckId, report = svc.run(PERIOD)): string[] {
  return report.findings.filter((f) => f.check_id === check).map((f) => f.entity.id);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  seedClean();
  svc = build();
});

describe('readiness — the clean-workspace guard', () => {
  it('reports nothing on a healthy inventory', () => {
    const report = svc.run(PERIOD);
    expect(report.findings).toEqual([]);
    expect(report.counts).toEqual({ blocker: 0, warning: 0, info: 0 });
  });

  it('registers all 14 checks', () => {
    expect(READINESS_CHECKS).toHaveLength(14);
    expect(new Set(READINESS_CHECKS.map((c) => c.id)).size).toBe(14);
  });

  it('returns an empty report for an unknown period instead of throwing', () => {
    expect(svc.run('nope').findings).toEqual([]);
  });
});

describe('readiness — completeness', () => {
  it('C1 flags an active source with no activity, and not one with activity', () => {
    expect(idsFor('C1')).toEqual([]);
    db.prepare(
      `INSERT INTO emission_source (id, site_id, name, scope) VALUES ('es-2', 'site-1', 'Boiler', 1)`,
    ).run();
    expect(idsFor('C1')).toEqual(['es-2']);
  });

  it('C1 ignores an inactive source', () => {
    db.prepare(
      `INSERT INTO emission_source (id, site_id, name, scope, is_active) VALUES ('es-3', 'site-1', 'Retired', 1, 0)`,
    ).run();
    expect(idsFor('C1')).toEqual([]);
  });

  it('C3 flags a row dated outside its period', () => {
    expect(idsFor('C3')).toEqual([]);
    insertActivity({ id: 'act-2', amount: 5, unit: 'kWh', start: '2023-12-01', end: '2023-12-31' });
    writeCreatedEvent('act-2');
    expect(idsFor('C3')).toEqual(['act-2']);
  });

  it('C5 flags an unanswered outbound question but not an answered one', () => {
    seedOutboundQuestion(true);
    expect(idsFor('C5')).toEqual([]);
    db.prepare('DELETE FROM answer WHERE id = ?').run('a-1');
    expect(idsFor('C5')).toEqual(['q-1']);
  });
});

describe('readiness — consistency', () => {
  it('N1 flags a cross-family unit with no fuel binding', () => {
    expect(idsFor('N1')).toEqual([]);
    insertActivity({ id: 'act-x', amount: 10, unit: 'L' });
    writeCreatedEvent('act-x');
    expect(idsFor('N1')).toEqual(['act-x']);
  });

  it('N1 does NOT flag a cross-family unit that carries a fuel binding', () => {
    insertActivity({ id: 'act-y', amount: 10, unit: 'L', fuelCode: 'diesel' });
    writeCreatedEvent('act-y');
    expect(idsFor('N1')).toEqual([]);
  });

  it('N2 flags an amount far from its group median once the group is big enough', () => {
    for (let i = 0; i < 5; i++) {
      insertActivity({ id: `act-n${i}`, amount: 100, unit: 'kWh' });
      writeCreatedEvent(`act-n${i}`);
    }
    expect(idsFor('N2')).toEqual([]);
    insertActivity({ id: 'act-huge', amount: 100_000, unit: 'kWh' });
    writeCreatedEvent('act-huge');
    expect(idsFor('N2')).toContain('act-huge');
  });

  it('N2 honours the configured outlier ratio rather than a hardcoded one', () => {
    for (let i = 0; i < 5; i++) {
      insertActivity({ id: `act-r${i}`, amount: 100, unit: 'kWh' });
      writeCreatedEvent(`act-r${i}`);
    }
    insertActivity({ id: 'act-mild', amount: 400, unit: 'kWh' }); // 4x the median
    writeCreatedEvent('act-mild');

    // Default ratio of 10 lets a 4x row pass.
    expect(idsFor('N2')).toEqual([]);
    // A tighter ratio catches it -- proving the setting is actually consulted.
    svc = build(3);
    expect(idsFor('N2')).toContain('act-mild');
  });

  it('N3 flags the later duplicate only, keeping the first row', () => {
    insertActivity({ id: 'act-dup-a', amount: 42, unit: 'kWh' });
    writeCreatedEvent('act-dup-a');
    expect(idsFor('N3')).toEqual([]);
    insertActivity({ id: 'act-dup-b', amount: 42, unit: 'kWh' });
    writeCreatedEvent('act-dup-b');
    expect(idsFor('N3')).toEqual(['act-dup-b']);
  });

  it('N5 flags mixed GWP bases once per period', () => {
    expect(idsFor('N5')).toEqual([]);
    pinEf({ code: 'other.kwh', year: 2024, unit: 'kWh', gwp: 'AR5' });
    insertActivity({ id: 'act-ar5', amount: 1, unit: 'kWh', code: 'other.kwh' });
    writeCreatedEvent('act-ar5');
    expect(idsFor('N5')).toEqual([PERIOD]);
  });
});

describe('readiness — traceability', () => {
  it('T1 summarises unevidenced rows once per period, not once per row', () => {
    // The clean fixture's row has an extraction behind it, so nothing to say.
    expect(idsFor('T1')).toEqual([]);

    // Three hand-entered rows must still produce exactly ONE finding -- the
    // whole point of making this a period summary.
    for (const id of ['m1', 'm2', 'm3']) {
      insertActivity({ id, amount: 10, unit: 'kWh' });
      writeCreatedEvent(id);
    }
    const findings = svc.run(PERIOD).findings.filter((f) => f.check_id === 'T1');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.facts.unevidenced_count).toBe(3);
    expect(findings[0]?.facts.total_count).toBe(4);
  });

  it('T2 flags a row with no audit trail', () => {
    expect(idsFor('T2')).toEqual([]);
    // Exactly the shape the pre-c802b10 MCP path wrote: a row and no event.
    insertActivity({ id: 'act-ghost', amount: 7, unit: 'kWh' });
    expect(idsFor('T2')).toEqual(['act-ghost']);
  });

  it('T3 flags a factor vintage far from the reporting year', () => {
    expect(idsFor('T3')).toEqual([]);
    pinEf({ code: 'old.kwh', year: 2018, unit: 'kWh', gwp: 'AR6' });
    insertActivity({ id: 'act-old', amount: 1, unit: 'kWh', code: 'old.kwh', efYear: 2018 });
    writeCreatedEvent('act-old');
    expect(idsFor('T3')).toEqual(['act-old']);
  });

  it('T4 flags a factor from a user library that no longer exists', () => {
    pinEf({ code: 'mine.kwh', year: 2024, unit: 'kWh', gwp: 'AR6', source: 'user:MyLib' });
    insertActivity({
      id: 'act-user',
      amount: 1,
      unit: 'kWh',
      code: 'mine.kwh',
      efSource: 'user:MyLib',
    });
    writeCreatedEvent('act-user');
    expect(idsFor('T4')).toEqual(['act-user']);

    db.prepare(
      `INSERT INTO user_ef_library (id, name, source, version, factor_count, imported_at, created_at)
       VALUES ('lib-1', 'MyLib', 'user:MyLib', 'v1', 1, ?, ?)`,
    ).run(NOW, NOW);
    expect(idsFor('T4')).toEqual([]);
  });
});

describe('readiness — delivery', () => {
  it('D1 flags a missing base year', () => {
    expect(idsFor('D1')).toEqual([]);
    db.prepare('UPDATE organization SET base_year_period_id = NULL').run();
    expect(idsFor('D1')).toEqual(['org-1']);
  });

  it('D2 flags a frozen snapshot line that no longer matches the ledger', () => {
    db.prepare(
      `INSERT INTO calculation_snapshot
         (id, reporting_period_id, frozen_at, ef_dataset_versions, total_co2e_kg,
          scope1_kg, scope2_kg_location, scope3_kg_by_cat)
       VALUES ('cs-1', 'rp-1', ?, '{}', 500, 0, 500, '{}')`,
    ).run(NOW);
    db.prepare(
      `INSERT INTO calculation_snapshot_line
         (id, calculation_snapshot_id, original_activity_data_id, site_id_at_freeze, site_name_at_freeze,
          emission_source_id_at_freeze, emission_source_name_at_freeze, reporting_period_id_at_freeze,
          occurred_at_start, occurred_at_end, amount, unit, ef_input_unit, converted_amount,
          ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
          ef_co2e_kg_per_unit, ef_gwp_basis, computed_co2e_kg, scope)
       VALUES ('csl-1', 'cs-1', 'act-1', 'site-1', 'HQ', 'es-1', 'Grid electricity', 'rp-1',
               '2024-01-01', '2024-12-31', 1000, 'kWh', 'kWh', 1000,
               'grid.kwh', 2024, 'MEE_China', 'CN', 'v1', 0.5, 'AR6', 500, 2)`,
    ).run();
    expect(idsFor('D2')).toEqual([]);

    db.prepare('UPDATE activity_data SET amount = 2000, computed_co2e_kg = 1000 WHERE id = ?').run(
      'act-1',
    );
    expect(idsFor('D2')).toEqual(['act-1']);
  });

  it('D3 flags a sent disclosure past its due date', () => {
    db.prepare(`INSERT INTO customer (id, name, notes) VALUES ('cu-2', 'Supplier', NULL)`).run();
    db.prepare(
      `INSERT INTO document (id, sha256, filename, mime_type, size_bytes, storage_path, uploaded_at)
       VALUES ('doc-2', 'sha2', 's.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 1, '/tmp/s', ?)`,
    ).run(NOW);
    db.prepare(
      `INSERT INTO questionnaire (id, customer_id, document_id, reporting_year, status, direction, due_date, created_at)
       VALUES ('qn-2', 'cu-2', 'doc-2', 2024, 'sent', 'inbound', '2020-01-01', ?)`,
    ).run(NOW);
    expect(idsFor('D3')).toEqual(['qn-2']);

    db.prepare(`UPDATE questionnaire SET status = 'received' WHERE id = 'qn-2'`).run();
    expect(idsFor('D3')).toEqual([]);
  });
});

describe('readiness — report assembly', () => {
  it('sorts blockers ahead of warnings', () => {
    db.prepare('UPDATE organization SET base_year_period_id = NULL').run(); // D1 warning
    insertActivity({ id: 'act-ghost', amount: 7, unit: 'kWh' }); // T2 blocker
    // act-ghost is also unevidenced, so this run exercises all three levels.
    const severities = svc.run(PERIOD).findings.map((f) => f.severity);
    expect(severities).toEqual(['blocker', 'warning', 'info']);
  });

  it('honours dismissal and counts it separately', () => {
    db.prepare('UPDATE organization SET base_year_period_id = NULL').run();
    const before = svc.run(PERIOD);
    const finding = before.findings.find((f) => f.check_id === 'D1');
    expect(finding).toBeDefined();

    if (finding) svc.dismiss(readinessFindingKey(finding));
    const after = svc.run(PERIOD);
    expect(after.findings.some((f) => f.check_id === 'D1')).toBe(false);
    expect(after.dismissed_count).toBe(1);

    if (finding) svc.undismiss(readinessFindingKey(finding));
    expect(svc.run(PERIOD).findings.some((f) => f.check_id === 'D1')).toBe(true);
  });

  it('survives a corrupt dismissal setting rather than failing the sweep', () => {
    db.prepare(
      `INSERT INTO setting (key, value, updated_at) VALUES ('readiness.dismissed', 'not json', ?)`,
    ).run(NOW);
    expect(() => svc.run(PERIOD)).not.toThrow();
    expect(svc.dismissedKeys().size).toBe(0);
  });

  it('writes a readiness.reviewed audit event carrying counts only', () => {
    db.prepare('UPDATE organization SET base_year_period_id = NULL').run();
    svc.run(PERIOD);
    const row = db
      .prepare(`SELECT payload FROM audit_event WHERE event_kind = 'readiness.reviewed'`)
      .get() as { payload: string };
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    expect(payload.warning_count).toBe(1); // D1
    expect(payload.check_count).toBe(14);
    // No finding content: every value is a scalar id/number, never a row dump.
    for (const value of Object.values(payload)) {
      expect(['string', 'number']).toContain(typeof value);
    }
  });
});
