/**
 * Prompt builders + structured-output schema for the answer-generation
 * service. Extracted from `./index.ts` so the legacy single-shot path
 * (still wired up in `index.ts`) and the new agent path (`./agent-loop.ts`)
 * share one source of truth for question/inventory shape and per-kind
 * tail text.
 *
 * `buildAnswerPrompt` is the legacy single-shot user prompt — it dumps
 * inventory totals + the activities summary verbatim. `buildAgentUserPrompt`
 * is the trimmed agent variant: it strips the activity dump because the
 * agent fetches what it needs through `list_activities` / `sum_co2e`
 * (see `./tools.ts`). The system prompt
 * (`AGENT_SYSTEM_PROMPT`) carries the cite-from-tool-results discipline
 * that keeps the model from fabricating numbers.
 */
import { type ZodSchema, z } from 'zod';

/**
 * Per-question-kind tail of the system prompt. Kept inline (rather than in a
 * data file) because the wording is tightly coupled to the schema validators
 * below — e.g. the narrative `valueMax = 2000` mirrors the "≤300 字" guidance.
 */
export const KIND_INSTRUCTIONS: Record<'numerical' | 'categorical' | 'narrative', string> = {
  numerical: '請返回數字字串 + 單位。優先從 inventory 總排放 / 活動資料中推算。',
  categorical: '請返回一個短詞答案（≤10 字），如"是"/"否"/"部分"/"不適用"或產業代碼／類型名稱。',
  narrative: '請返回 1-3 句繁體中文（台灣用語）敘述（≤300 字），結合 inventory 給出可稽核的回答。',
};

export interface InventoryContext {
  year: number;
  activity_count: number;
  activities_summary: string;
  totals: {
    total_co2e_kg: number;
    scope1_kg?: number;
    scope2_kg?: number;
    scope3_kg?: number;
  } | null;
}

export interface QuestionContext {
  raw_text: string;
  expected_unit?: string | null;
  question_kind: 'numerical' | 'categorical' | 'narrative';
}

/**
 * Shape of the structured answer the LLM (single-shot or agent) returns.
 * Surfaced as a type alias so callers can name the result without rebuilding
 * the schema.
 */
export interface AnswerOutput {
  value: string;
  unit: string | null;
  source_summary: string;
}

/**
 * Build the schema for the LLM's structured response. `valueMax` depends on
 * the question kind so narrative answers get headroom while numerical/
 * categorical answers are kept terse.
 */
export function buildAnswerSchema(
  question_kind: 'numerical' | 'categorical' | 'narrative',
): ZodSchema<AnswerOutput> {
  const valueMax = question_kind === 'narrative' ? 2000 : 50;
  return z.object({
    value: z.string().max(valueMax),
    unit: z.string().nullable(),
    source_summary: z.string().max(500),
  });
}

/**
 * Render the answer-generation prompt for the legacy single-shot path.
 * Lives in the service (not the AiClient) so the AiClient stays a dumb
 * conduit — services own their prompts, the client only sends bytes.
 * Matches the broader pi-ai migration pattern.
 */
export function buildAnswerPrompt(question: QuestionContext, inventory: InventoryContext): string {
  return `你是一名碳核算助理。下面是一道供應商問卷的題目，以及目前組織 ${inventory.year} 年度的 inventory 資料。請根據 inventory 給出答案。

題目類型：${question.question_kind}
${KIND_INSTRUCTIONS[question.question_kind]}

<question>
${question.raw_text}
${question.expected_unit ? `期望單位：${question.expected_unit}` : ''}
</question>

<inventory>
活動資料行數：${inventory.activity_count}
活動資料摘要：${inventory.activities_summary}
${inventory.totals ? `總排放：${JSON.stringify(inventory.totals)}` : '無總排放快照。'}
</inventory>

返回 JSON: { value: <答案字串，可以是數字字串或文本>, unit: <單位字串，若題面有要求；否則 null>, source_summary: <1-2 句繁體中文（台灣用語），說明答案是從 inventory 哪部分推出來的> }

中文敘述請使用台灣繁體中文；保留原始組織名稱、人名、單位、編碼，以及問卷要求逐字填寫的選項。

如果 inventory 裡沒有相關資料，value 用空字串 ""，source_summary 解釋為何無法回答。`;
}

/**
 * System prompt for the tool-using agent loop. Encodes the
 * cite-from-tool-results discipline: every number must come from a tool
 * call, source_summary must reference activity IDs or EF factor codes,
 * and the agent must finalize via `submit_response` exactly once.
 *
 * Kept bilingual on purpose — questions are bilingual (zh-TW + EN), and
 * the existing single-shot prompt is mostly Chinese; this prompt mirrors
 * that voice while keeping critical rules in English for emphasis.
 */
export const AGENT_SYSTEM_PROMPT = `You are a carbon-accounting analyst answering questionnaire questions about a Chinese company's GHG inventory.

You have read-only tools to query the user's inventory:
- list_activities — filtered by year/scope/source
- sum_co2e — aggregate totals
- list_emission_sources — list sources
- get_emission_factor — look up the EF pinned to an activity
- read_questionnaire_context — questionnaire metadata

CRITICAL RULES:
1. Never fabricate numbers. Every number in your answer must come from a tool result.
2. Cite specific activity IDs or EF factor codes in source_summary so the user can audit your reasoning.
3. If the inventory genuinely lacks the data, return value="" and explain in source_summary.
4. Don't over-call tools. Plan: think about which one query gets you the answer; call it; submit.
5. Use submit_response to deliver your final answer — only call it once.
6. Answers should be terse (numerical/categorical ≤ 50 chars; narrative ≤ 2000 chars).
7. Use Taiwan Traditional Chinese for Chinese prose and source_summary. Preserve original organization names, personal names, units, codes, and any response options that the questionnaire requires verbatim.`;

/**
 * Render the trimmed user prompt for the agent path. Deliberately omits the
 * activity dump that lives in `buildAnswerPrompt` — the agent fetches what
 * it needs via `list_activities` / `sum_co2e`. Inventory headline (year +
 * count + totals) is kept so the agent knows whether the inventory is
 * empty before issuing a query.
 */
export function buildAgentUserPrompt(
  question: QuestionContext,
  inventory: InventoryContext,
): string {
  return `題目類型：${question.question_kind}
${KIND_INSTRUCTIONS[question.question_kind]}

<question>
${question.raw_text}
${question.expected_unit ? `期望單位：${question.expected_unit}` : ''}
</question>

<inventory_headline>
年度：${inventory.year}
活動資料行數：${inventory.activity_count}
${inventory.totals ? `總排放（kg co2e）：${JSON.stringify(inventory.totals)}` : '無總排放快照。'}
</inventory_headline>

使用工具查詢具體活動資料（list_activities、sum_co2e 等），然後用 submit_response 給出最終答案。`;
}
