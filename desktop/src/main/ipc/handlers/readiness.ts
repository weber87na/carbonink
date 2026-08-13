import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const runInput = z.object({ reporting_period_id: z.string().min(1) });
const keyInput = z.object({ key: z.string().min(1).max(300) });

/**
 * Readiness handlers (spec 2026-08-13-inventory-readiness-rules). Thin: the
 * sweep, the ordering and the dismissal bookkeeping all live in
 * ReadinessService, which is where the tests point too.
 *
 * Notably absent is any provider-config guard. This is the one analysis
 * surface that works with no AI configured at all, and gating it would defeat
 * the reason the rule layer was built separately from the agent layer.
 */
export function readinessHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'readiness:run': (input) => ctx.readinessService.run(runInput.parse(input).reporting_period_id),
    'readiness:review': async (input) => ({
      findings: await ctx.readinessAgentService.review(runInput.parse(input).reporting_period_id),
    }),
    'readiness:dismiss': (input) => ctx.readinessService.dismiss(keyInput.parse(input).key),
    'readiness:undismiss': (input) => ctx.readinessService.undismiss(keyInput.parse(input).key),
  };
}
