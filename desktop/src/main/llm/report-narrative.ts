import { runAiObject } from '@main/llm/run-ai.js';
import type { CredentialService } from '@main/services/credential-service.js';
import type { InventoryReportData } from '@main/services/report-data-service';
import type { ProviderConfigV2 } from '@shared/types.js';
import { z } from 'zod';

export const ReportNarrativeSchema = z.object({
  boundary_description: z.string().max(800),
  reporting_boundary_description: z.string().max(800),
  methodology_description: z.string().max(1200),
  emissions_summary: z.string().max(1500),
  significant_changes: z.string().max(800),
  notable_observations: z.string().max(800),
});

export type ReportNarrative = z.infer<typeof ReportNarrativeSchema>;

export type ReportNarrativeField = keyof ReportNarrative;

export interface ReportNarrativeLengthWarning {
  field: ReportNarrativeField;
  actual_length: number;
  minimum_length: number;
}

const REPORT_NARRATIVE_MIN_LENGTHS = [
  { field: 'boundary_description', minimum_length: 50 },
  { field: 'reporting_boundary_description', minimum_length: 50 },
  { field: 'methodology_description', minimum_length: 100 },
  { field: 'emissions_summary', minimum_length: 100 },
  { field: 'significant_changes', minimum_length: 20 },
  { field: 'notable_observations', minimum_length: 50 },
] as const satisfies ReadonlyArray<{
  field: ReportNarrativeField;
  minimum_length: number;
}>;

/**
 * Return advisory warnings for sections below the recommended lengths.
 *
 * These checks intentionally happen after schema validation: short text is
 * usable report content and must not prevent a report from being generated.
 */
export function getReportNarrativeLengthWarnings(
  narrative: ReportNarrative,
): ReportNarrativeLengthWarning[] {
  return REPORT_NARRATIVE_MIN_LENGTHS.flatMap(({ field, minimum_length }) => {
    const actual_length = narrative[field].length;
    return actual_length < minimum_length ? [{ field, actual_length, minimum_length }] : [];
  });
}

export type ReportNarrativeSubPhase =
  | 'boundary'
  | 'reporting-boundary'
  | 'methodology'
  | 'emissions'
  | 'changes'
  | 'observations';

export interface ReportNarrativeProgressEvent {
  sub_phase: ReportNarrativeSubPhase | null;
}

export class LlmNarrativeCanceled extends Error {
  readonly _tag = 'LlmNarrativeCanceled' as const;
  constructor() {
    super('Report narrative generation canceled');
  }
}

export class LlmNarrativeRefused extends Error {
  readonly _tag = 'LlmNarrativeRefused' as const;
}

function buildSystemPrompt(lang: 'zh-CN' | 'en'): string {
  if (lang === 'zh-CN') {
    return `你是 ISO 14064-1:2018 GHG 盘查报告撰稿人。严格遵循以下规则:

1. 你只能使用 <inventory> 块中提供的数字与名称。任何 <inventory> 中不存在的事实, 一律写 "本期未评估"。严禁推测、补充或虚构。
2. 不要在文本中改动 <inventory> 给出的数字 (允许换算单位时另当别论)。
3. 语气专业、克制、不夸张。各字段应尽可能完整；当 inventory 信息不足时，可以简洁说明“本期未评估”，不得为了凑长度编造事实。各字段最多可包含以下字符数（含标点）：boundary_description 800；reporting_boundary_description 800；methodology_description 1200；emissions_summary 1500；significant_changes 800；notable_observations 800。
4. 边界方法措辞: equity_share → "股权法"; financial_control → "财务控制法"; operational_control → "运营控制法"。
5. 排放因子来源信息若 <inventory> 提供, 在 methodology_description 中必须披露 GWP 基准 (AR5 / AR6)。
6. 输出必须是 JSON, 完全符合给定 schema, 不要添加 schema 外的字段。`;
  }
  return `You are an ISO 14064-1:2018 GHG inventory report writer. Strict rules:

1. You may only use numbers and names from the <inventory> block. For any fact not present in <inventory>, write "Not assessed in this inventory". No speculation, no extrapolation, no fabrication.
2. Do not alter numbers from <inventory> (unit conversion is allowed when explicit).
3. Tone: professional, restrained, never promotional. Keep each field as complete as the inventory supports; when information is insufficient, state "Not assessed in this inventory" rather than padding or inventing facts. Each field has the following maximum character count, including punctuation: boundary_description 800; reporting_boundary_description 800; methodology_description 1200; emissions_summary 1500; significant_changes 800; notable_observations 800.
4. Boundary phrasing: equity_share → "equity share"; financial_control → "financial control"; operational_control → "operational control".
5. If <inventory> includes EF source provenance, the methodology_description must disclose the GWP basis (AR5 / AR6).
6. Output must be JSON matching the schema exactly, no extra fields.`;
}

function buildUserMessage(data: InventoryReportData): string {
  return `<inventory>\n${JSON.stringify(data, null, 2)}\n</inventory>`;
}

interface SchemaMismatchLike {
  _tag?: string;
  cause?: unknown;
  message?: string;
  raw?: string;
}

function schemaIssuesFrom(error: SchemaMismatchLike): Array<{ path?: unknown; message?: unknown }> {
  const causeIssues = (error.cause as { issues?: unknown } | undefined)?.issues;
  if (Array.isArray(causeIssues)) {
    return causeIssues as Array<{ path?: unknown; message?: unknown }>;
  }

  if (error.raw) {
    try {
      const parsed = ReportNarrativeSchema.safeParse(JSON.parse(error.raw));
      if (!parsed.success) return parsed.error.issues;
    } catch {
      // A malformed raw payload has no safe field-level detail to recover.
    }
  }
  return [];
}

function summarizeSchemaMismatch(error: SchemaMismatchLike): string {
  const issues = schemaIssuesFrom(error);
  if (issues.length > 0) {
    const summary = issues.slice(0, 3).map((issue) => {
      const path =
        Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : 'response';
      const message = typeof issue.message === 'string' ? issue.message : 'invalid value';
      return `${path}: ${message}`;
    });
    if (issues.length > summary.length) summary.push(`and ${issues.length - summary.length} more`);
    return summary.join('; ');
  }
  return error.message?.trim() || 'response did not match the six required report fields';
}

function buildRepairUserMessage(data: InventoryReportData, validationSummary: string): string {
  const correction =
    data.language === 'zh-CN'
      ? `前次输出未通过格式验证：${validationSummary}。请重新生成完整的六个字段，严格满足字段结构与最大字符数限制。只能使用 inventory 中的事实，不得沿用或新增 inventory 以外的内容。`
      : `The previous output failed validation: ${validationSummary}. Regenerate all six fields and strictly observe the required field structure and maximum character counts. Use only facts from the inventory; do not carry over or add content that is not present there.`;
  return `${buildUserMessage(data)}\n\n<validation_feedback>\n${correction}\n</validation_feedback>`;
}

/**
 * Generate the 6-section ISO 14064-1 narrative for a report.
 *
 * Phase 1 of the pi-ai migration (Task 8): swapped from the old
 * `streamObject`-based provider shim onto `runAiObject` — the same
 * Promise-boundary helper used by extraction / ef-matcher /
 * questionnaire services.
 *
 * Trade-offs vs the old streaming path:
 *
 * - **No mid-call partial events.** AiClient's `generateObject` is a
 *   single round-trip — there's no `partialObjectStream` to walk for
 *   per-section progress. The renderer's progress label stays on
 *   "assembling" / "narrative" until the full payload returns and
 *   then jumps to "finalizing". The renderer already tolerates
 *   `sub_phase: null` (see `reports.$id.tsx` switch fallthrough);
 *   we still call `onProgress` to honour the public shape but only
 *   emit a single `{ sub_phase: null }` "we're working" tick.
 *   Streaming UX is future work — see AiClient JSDoc.
 *
 * - **AbortSignal is only honoured pre-call.** `runAiObject` doesn't
 *   thread an external abort into pi-ai's HTTP layer, so once the
 *   model round-trip starts, clicking Cancel marks the controller as
 *   aborted but the in-flight request runs to completion. The handler
 *   still discards the result via the `controller.signal.aborted`
 *   check after `generateReportNarrative` returns. We check
 *   `abortSignal.aborted` at the top so a cancel that lands *before*
 *   the LLM call still raises `LlmNarrativeCanceled` synchronously
 *   (the test that pre-aborts the controller depends on this).
 *
 * - **Schema validation moves to AiClient.** Old code re-ran
 *   `ReportNarrativeSchema.safeParse` after the stream completed
 *   because `streamObject`'s `object` Promise was permissive. The new
 *   path's `runAiObject({ schema })` enforces the schema via pi-ai's
 *   tool-call envelope (see `ai-client.ts`); a mismatch surfaces as
 *   `AiSchemaMismatch`. One report-level repair attempt supplies concise
 *   field feedback to the model; a second mismatch is translated to
 *   `LlmNarrativeRefused` to preserve the handler's existing branching.
 */
export async function generateReportNarrative(args: {
  data: InventoryReportData;
  config: ProviderConfigV2;
  credentials: CredentialService;
  onProgress: (ev: ReportNarrativeProgressEvent) => void;
  abortSignal: AbortSignal;
}): Promise<ReportNarrative> {
  const { data, config, credentials, onProgress, abortSignal } = args;

  // Pre-call abort short-circuit. Once the LLM round-trip begins,
  // cancellation no longer interrupts it (see JSDoc); checking here
  // preserves the "abort before generate" path the existing tests
  // exercise and matches the old streamObject behaviour for the
  // already-aborted case.
  if (abortSignal.aborted) {
    throw new LlmNarrativeCanceled();
  }

  // The old streaming path emitted six sub-phase markers as the model
  // filled each field. Without `partialObjectStream` we can't observe
  // intermediate state — emit a single null-phase tick so callers that
  // count progress events still see the "we have started" signal.
  // The renderer treats null as "keep current label", which is fine
  // because the handler emits `phase: 'narrative'` immediately before
  // calling us.
  onProgress({ sub_phase: null });

  let prompt = buildUserMessage(data);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await runAiObject(config, credentials, {
        schema: ReportNarrativeSchema,
        system: buildSystemPrompt(data.language),
        prompt,
      });
      // Post-call abort check. If the user clicked Cancel while the
      // LLM round-trip was in flight, the abort didn't interrupt the
      // request (see JSDoc) but we still honour the user's intent by
      // discarding the result and surfacing the canonical cancel error.
      if (abortSignal.aborted) {
        throw new LlmNarrativeCanceled();
      }
      return result;
    } catch (err) {
      if (err instanceof LlmNarrativeCanceled) throw err;
      if (abortSignal.aborted) throw new LlmNarrativeCanceled();
      if ((err as Error)?.name === 'AbortError') throw new LlmNarrativeCanceled();

      const mismatch = err as SchemaMismatchLike;
      if (mismatch?._tag === 'AiSchemaMismatch') {
        const summary = summarizeSchemaMismatch(mismatch);
        if (attempt === 0) {
          prompt = buildRepairUserMessage(data, summary);
          continue;
        }
        throw new LlmNarrativeRefused(`LLM returned schema-invalid narrative: ${summary}`);
      }
      throw err;
    }
  }

  throw new LlmNarrativeRefused('LLM returned schema-invalid narrative after repair');
}
