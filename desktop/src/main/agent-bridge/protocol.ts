/**
 * Wire format shared by the bridge server (main process) and the bridge client
 * (MCP process). Newline-delimited JSON, one request per line, one response per
 * line, correlated by `id`.
 *
 * Deliberately not reusing Electron's IPC serialization: the MCP process is
 * plain Node with no Electron module available (see `mcp/db.ts`), so the two
 * ends can only agree on something both runtimes have — JSON over a socket.
 *
 * This module must stay dependency-free for the same reason; it is imported
 * from both sides of the process boundary.
 */

export interface BridgeRequest {
  id: string;
  channel: string;
  /** Positional handler arguments. IPC handlers take a single input object. */
  args: unknown[];
}

export type BridgeErrorCode =
  /** Channel absent from the allowlist. Never reaches a handler. */
  | 'channel_not_allowed'
  /** Allowlisted, but no dispatch table right now (app starting or switching). */
  | 'not_ready'
  /** The handler itself threw; `message` is already sanitized by `sanitize()`. */
  | 'handler_error'
  /** The frame was not a well-formed request. */
  | 'bad_request';

export type BridgeResponse =
  | { id: string; ok: true; value: unknown }
  | { id: string; ok: false; error: { code: BridgeErrorCode; message: string } };

export function encodeFrame(value: BridgeRequest | BridgeResponse): string {
  return `${JSON.stringify(value)}\n`;
}
