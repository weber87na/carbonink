import type { AiErr } from '@main/llm/errors.js';
import { Data } from 'effect';

export class QuestionNotFound extends Data.TaggedError('QuestionNotFound')<{ id: string }> {}
export class QuestionAlreadyAnswered extends Data.TaggedError('QuestionAlreadyAnswered')<{
  id: string;
}> {}
export class QuestionnaireNotFound extends Data.TaggedError('QuestionnaireNotFound')<{
  id: string;
}> {}
export class InventoryEmpty extends Data.TaggedError('InventoryEmpty')<{ year: number }> {}
export class AnswerNotFound extends Data.TaggedError('AnswerNotFound')<{ question_id: string }> {}
/**
 * The LLM responded successfully but said it couldn't infer a value from the
 * inventory data. The prompt explicitly instructs the model to return
 * `value=""` in that case. We surface it as a distinct error rather than
 * persisting an empty-value answer that would later look indistinguishable
 * from an "answered" row.
 *
 * Distinct from `AiNoData` (which means the model returned no parsable
 * content at all — a transport/format failure). `LLMNoData` is a domain-level
 * "the inventory is insufficient" signal that we want the UI to render with
 * its own copy.
 */
export class LLMNoData extends Data.TaggedError('LLMNoData')<{ reason: string }> {}

export type GenErr =
  | QuestionNotFound
  | QuestionAlreadyAnswered
  | QuestionnaireNotFound
  | InventoryEmpty
  | LLMNoData
  | AiErr;

export type SaveErr = AnswerNotFound | QuestionNotFound;

export interface SaveInput {
  question_id: string;
  value: string;
  unit: string | null;
  finalize: boolean;
  /**
   * Who produced this value. Defaults to `'manual'` — the renderer's save path
   * is a human typing into AnswerReviewCard and must keep claiming so.
   *
   * The agent bridge passes `'ai_suggested'`: an answer written by an external
   * agent over MCP is not a human keystroke, and the audit trail is the whole
   * point of this product (spec 2026-08-13-mcp-write-path-integrity, A4).
   * Both values are already permitted by migration 014's CHECK, which also
   * allows zero source refs for the non-`mapped_inventory` kinds.
   */
  source_kind?: 'manual' | 'ai_suggested' | undefined;
}
