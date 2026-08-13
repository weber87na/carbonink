import type { SettingsService } from '@main/services/settings-service.js';
import type { UnitConversionService } from '@main/services/unit-conversion-service.js';
import {
  type ReadinessFinding,
  type ReadinessReport,
  type ReadinessSeverity,
  readinessFindingKey,
} from '@shared/types.js';
import { newId } from '@shared/ulid.js';
import type Database from 'better-sqlite3';
import { READINESS_CHECKS } from './registry.js';
import type { CheckContext, ReadinessPeriod } from './types.js';

export const READINESS_DISMISSED_SETTING = 'readiness.dismissed';

const SEVERITY_ORDER: Record<ReadinessSeverity, number> = { blocker: 0, warning: 1, info: 2 };

export interface ReadinessDeps {
  db: Database.Database;
  now: () => string;
  unitConversion: UnitConversionService;
  settings: Pick<SettingsService, 'getImportOutlierRatio'>;
}

/**
 * Runs the deterministic readiness checks over one reporting period
 * (spec 2026-08-13-inventory-readiness-rules).
 *
 * No LLM anywhere in this file — that is the point. With no AI provider
 * configured the user still gets the full checklist, and the later agent layer
 * only adds explanation on top of these findings.
 */
export class ReadinessService {
  constructor(private readonly deps: ReadinessDeps) {}

  run(reportingPeriodId: string): ReadinessReport {
    const period = this.deps.db
      .prepare(
        `SELECT id, organization_id, year, starts_at, ends_at
           FROM reporting_period WHERE id = ?`,
      )
      .get(reportingPeriodId) as ReadinessPeriod | undefined;

    const checkedAt = this.deps.now();
    if (!period) {
      return {
        findings: [],
        counts: { blocker: 0, warning: 0, info: 0 },
        dismissed_count: 0,
        checked_at: checkedAt,
      };
    }

    const ctx: CheckContext = {
      db: this.deps.db,
      period,
      unitConversion: this.deps.unitConversion,
      settings: this.deps.settings,
    };

    const raw: ReadinessFinding[] = [];
    for (const check of READINESS_CHECKS) {
      try {
        raw.push(...check.run(ctx));
      } catch {
        // A check that blows up must not take the sweep with it: a partial
        // checklist is useful, a crashed one is not. The check contract says
        // "return [] when you cannot evaluate"; this is the backstop for when
        // a check forgets.
      }
    }

    const dismissed = this.dismissedKeys();
    const findings = raw.filter((f) => !dismissed.has(readinessFindingKey(f)));
    findings.sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        a.check_id.localeCompare(b.check_id) ||
        a.entity.id.localeCompare(b.entity.id),
    );

    const counts = { blocker: 0, warning: 0, info: 0 };
    for (const f of findings) counts[f.severity] += 1;

    // Audit payload discipline: counts only. Which rows are problematic is
    // derivable from the ledger at any time; recording it here would duplicate
    // the ledger into an append-only table for no gain.
    this.deps.db
      .prepare('INSERT INTO audit_event (id, event_kind, payload, occurred_at) VALUES (?, ?, ?, ?)')
      .run(
        newId(),
        'readiness.reviewed',
        JSON.stringify({
          reporting_period_id: period.id,
          year: period.year,
          blocker_count: counts.blocker,
          warning_count: counts.warning,
          info_count: counts.info,
          dismissed_count: raw.length - findings.length,
          check_count: READINESS_CHECKS.length,
        }),
        checkedAt,
      );

    return {
      findings,
      counts,
      dismissed_count: raw.length - findings.length,
      checked_at: checkedAt,
    };
  }

  /**
   * Suppress a finding by its stable key. Stored in `setting` rather than a
   * table: dismissal is a per-workspace preference, the set is small, and it
   * needs no migration — the same call the outlier ratio makes.
   */
  dismiss(key: string): void {
    const keys = this.dismissedKeys();
    if (keys.has(key)) return;
    keys.add(key);
    this.writeDismissed(keys);
  }

  undismiss(key: string): void {
    const keys = this.dismissedKeys();
    if (!keys.delete(key)) return;
    this.writeDismissed(keys);
  }

  dismissedKeys(): Set<string> {
    const row = this.deps.db
      .prepare('SELECT value FROM setting WHERE key = ?')
      .get(READINESS_DISMISSED_SETTING) as { value: string } | undefined;
    if (!row) return new Set();
    try {
      const parsed = JSON.parse(row.value) as unknown;
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((k): k is string => typeof k === 'string'));
    } catch {
      // A hand-edited or truncated value must not make the whole sweep
      // unreachable; an unreadable dismissal list just means nothing is
      // dismissed.
      return new Set();
    }
  }

  private writeDismissed(keys: Set<string>): void {
    const ts = this.deps.now();
    this.deps.db
      .prepare(
        `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(READINESS_DISMISSED_SETTING, JSON.stringify([...keys].sort()), ts);
  }
}
