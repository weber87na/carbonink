import type { IpcContext } from './context.js';
import { activityDataHandlers } from './handlers/activity-data.js';
import { activityImportHandlers } from './handlers/activity-import.js';
import { agentSkillHandlers } from './handlers/agent-skill.js';
import { answerHandlers } from './handlers/answer.js';
import { appHandlers } from './handlers/app.js';
import { auditHandlers } from './handlers/audit.js';
import { dataHandlers } from './handlers/data.js';
import { documentHandlers } from './handlers/document.js';
import { efLibraryHandlers } from './handlers/ef-library.js';
import { efMatcherHandlers } from './handlers/ef-matcher.js';
import { emissionSourceHandlers } from './handlers/emission-source.js';
import { evidenceHandlers } from './handlers/evidence.js';
import { extractionHandlers } from './handlers/extraction.js';
import { inboundQuestionnaireHandlers } from './handlers/inbound-questionnaire.js';
import { lineageHandlers } from './handlers/lineage.js';
import { mcpHandlers } from './handlers/mcp.js';
import { organizationHandlers } from './handlers/organization.js';
import { questionnaireHandlers } from './handlers/questionnaire.js';
import { readinessHandlers } from './handlers/readiness.js';
import { reportHandlers } from './handlers/report.js';
import { routingHandlers } from './handlers/routing.js';
import { settingsHandlers } from './handlers/settings.js';
import { supplierHandlers } from './handlers/supplier.js';
import { undoHandlers } from './handlers/undo.js';
import { updaterHandlers } from './handlers/updater.js';
import { userEfLibraryHandlers } from './handlers/user-ef-library.js';
import { workspaceHandlers } from './handlers/workspace.js';
import { sanitize } from './sanitize.js';
import type { IpcTypeMap } from './types.js';

type HandlerMap = { [K in keyof IpcTypeMap]?: IpcTypeMap[K] };
type HandlerFactory = (ctx: IpcContext) => HandlerMap;

/**
 * Channel → sanitized handler, with the Electron `IpcMainInvokeEvent` already
 * peeled off. This is the process-wide dispatch table: the renderer reaches it
 * through `IpcListener`, and the agent bridge (spec
 * 2026-08-13-mcp-write-path-integrity) reaches the SAME entries over a local
 * socket, so an external agent's write and a click in the UI run identical code.
 *
 * Deliberately keyed by plain `string` rather than `keyof IpcTypeMap`: the
 * bridge receives channel names off the wire and must be able to look up an
 * arbitrary string (and refuse it) without a cast at every call site.
 */
export type DispatchMap = ReadonlyMap<string, (...args: unknown[]) => unknown>;

const HANDLER_FACTORIES: ReadonlyArray<HandlerFactory> = [
  organizationHandlers,
  efLibraryHandlers,
  userEfLibraryHandlers,
  efMatcherHandlers,
  emissionSourceHandlers,
  activityDataHandlers,
  activityImportHandlers,
  settingsHandlers,
  documentHandlers,
  extractionHandlers,
  questionnaireHandlers,
  inboundQuestionnaireHandlers,
  supplierHandlers,
  answerHandlers,
  routingHandlers,
  mcpHandlers,
  agentSkillHandlers,
  reportHandlers,
  auditHandlers,
  evidenceHandlers,
  lineageHandlers,
  readinessHandlers,
  updaterHandlers,
  appHandlers,
  dataHandlers,
  undoHandlers,
  workspaceHandlers,
];

/**
 * Build the dispatch table from the handler factories. Extracted from
 * {@link setupIpc} so it can be exercised without an Electron `IpcListener`,
 * and so the agent bridge consumes the identical, already-sanitized entries.
 */
export function buildDispatchMap(ctx: IpcContext): DispatchMap {
  const map = new Map<string, (...args: unknown[]) => unknown>();
  for (const factory of HANDLER_FACTORIES) {
    for (const [channel, handler] of Object.entries(factory(ctx))) {
      // sanitize wraps every handler so raw errors (SQL fragments, file paths)
      // never cross the IPC boundary; tagged user-actionable errors pass through.
      map.set(channel, sanitize(channel, handler as (...a: unknown[]) => unknown));
    }
  }
  return map;
}
