import {
  c1SourceWithoutActivity,
  c3ActivityOutsidePeriod,
  c5QuestionWithoutAnswer,
} from './checks/completeness.js';
import {
  n1UnitDimensionMismatch,
  n2AmountOutlier,
  n3SuspectedDuplicate,
  n5MixedGwpBasis,
} from './checks/consistency.js';
import {
  d1NoBaseYear,
  d2SnapshotDivergedFromLedger,
  d3OverdueSupplierDisclosure,
} from './checks/delivery.js';
import {
  t1ActivityWithoutEvidence,
  t2ActivityWithoutAuditTrail,
  t3StaleEfVintage,
  t4OrphanedUserLibraryFactor,
} from './checks/traceability.js';
import type { ReadinessCheck } from './types.js';

/**
 * The single place a check is registered. Mirrors `llm/stages/registry.ts`:
 * adding a check means appending here and nowhere else, and the array order is
 * only a tiebreaker — findings are sorted by severity first.
 *
 * Four checks the design considered are deliberately absent (month-coverage
 * gaps, site-without-Scope-2, year-over-year swings, stale narrative figures).
 * Each was dropped for a stated reason in
 * `docs/specs/2026-08-13-inventory-readiness-rules.md` rather than shipped as
 * noise — a checklist that cries wolf stops being read.
 */
export const READINESS_CHECKS: ReadonlyArray<ReadinessCheck> = [
  c1SourceWithoutActivity,
  c3ActivityOutsidePeriod,
  c5QuestionWithoutAnswer,
  n1UnitDimensionMismatch,
  n2AmountOutlier,
  n3SuspectedDuplicate,
  n5MixedGwpBasis,
  t1ActivityWithoutEvidence,
  t2ActivityWithoutAuditTrail,
  t3StaleEfVintage,
  t4OrphanedUserLibraryFactor,
  d1NoBaseYear,
  d2SnapshotDivergedFromLedger,
  d3OverdueSupplierDisclosure,
];
