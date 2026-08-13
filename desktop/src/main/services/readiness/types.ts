import type { SettingsService } from '@main/services/settings-service.js';
import type { UnitConversionService } from '@main/services/unit-conversion-service.js';
import type { ReadinessFinding } from '@shared/types.js';
import type Database from 'better-sqlite3';

/** The reporting period every check is scoped to. */
export interface ReadinessPeriod {
  id: string;
  organization_id: string;
  year: number;
  starts_at: string;
  ends_at: string;
}

/**
 * Everything a check may read. Deliberately narrow — a check that needs
 * something not in here is a signal that it is doing more than checking.
 *
 * `settings` is `Pick`ed rather than the whole service so tests can hand a
 * check a one-method stub instead of standing up the credential store.
 */
export interface CheckContext {
  db: Database.Database;
  period: ReadinessPeriod;
  unitConversion: UnitConversionService;
  settings: Pick<SettingsService, 'getImportOutlierRatio'>;
}

/**
 * One check. Pure with respect to the ledger: it reads and returns findings,
 * and never writes.
 *
 * Must not throw. A check that cannot evaluate (an unknown unit, a missing
 * row) returns `[]` — one broken rule taking down the whole sweep would make
 * the feature less trustworthy than having no sweep at all. The registry
 * enforces this with a try/catch as a second line of defence.
 */
export interface ReadinessCheck {
  id: string;
  run: (ctx: CheckContext) => ReadinessFinding[];
}
