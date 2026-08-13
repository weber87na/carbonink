import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import type { DispatchMap } from '@main/ipc/dispatch.js';
import { addressIsFile } from '@shared/agent-bridge/socket-path.js';
import { bridgeLevelOf } from './allowlist.js';
import { type BridgeErrorCode, type BridgeResponse, encodeFrame } from './protocol.js';

export interface AgentBridgeDeps {
  address: string;
  /**
   * Resolved per request, never captured. A workspace switch tears the dispatch
   * table down and rebuilds it against the new database
   * (cleanupIpc -> closeAppDb -> openAppDb -> setupIpc); holding the map itself
   * would pin the bridge to the previous client's data — exactly the bug
   * `mcp/db.ts` had before it started re-reading the registry per call.
   */
  getDispatch: () => DispatchMap | null;
}

/**
 * Local socket that lets the MCP server perform writes through the app's own
 * IPC handlers instead of writing SQLite directly (spec
 * 2026-08-13-mcp-write-path-integrity).
 *
 * Not an authentication boundary. Any process that can open this socket can
 * already open the SQLite file, which is strictly more powerful — the socket
 * only offers the subset in the allowlist, and offers it with the audit trail,
 * unit conversion and undo entry the raw file would not have given it.
 */
export function startAgentBridge(deps: AgentBridgeDeps): Server {
  // A crash leaves the socket file behind and bind would fail with EADDRINUSE.
  // Safe to remove: a live listener on the old path is impossible here,
  // single-instance is enforced upstream by Electron.
  if (addressIsFile(deps.address) && existsSync(deps.address)) {
    unlinkSync(deps.address);
  }

  const server = createServer((socket) => handleConnection(socket, deps));
  server.listen(deps.address, () => {
    if (addressIsFile(deps.address)) {
      // Owner-only. The parent userData directory is already user-scoped; this
      // is defense in depth for shared-home setups.
      chmodSync(deps.address, 0o600);
    }
  });
  return server;
}

export function stopAgentBridge(server: Server, address: string): void {
  server.close();
  if (addressIsFile(address) && existsSync(address)) {
    unlinkSync(address);
  }
}

function handleConnection(socket: Socket, deps: AgentBridgeDeps): void {
  socket.setEncoding('utf-8');
  let buffer = '';

  socket.on('data', (chunk: string) => {
    buffer += chunk;
    // Frames are newline-delimited; a partial trailing frame stays buffered.
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim() !== '') {
        void dispatchLine(line, deps).then((response) => {
          if (!socket.destroyed) socket.write(encodeFrame(response));
        });
      }
      newline = buffer.indexOf('\n');
    }
  });

  // A dropped client is routine (the MCP process opens one connection per
  // tool call); nothing to recover, and an unhandled 'error' would throw.
  socket.on('error', () => socket.destroy());
}

async function dispatchLine(line: string, deps: AgentBridgeDeps): Promise<BridgeResponse> {
  let id = '';
  try {
    const parsed = JSON.parse(line) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as { id?: unknown }).id !== 'string' ||
      typeof (parsed as { channel?: unknown }).channel !== 'string' ||
      !Array.isArray((parsed as { args?: unknown }).args)
    ) {
      return fail(id, 'bad_request', 'Expected {id, channel, args}.');
    }
    const request = parsed as { id: string; channel: string; args: unknown[] };
    id = request.id;

    if (bridgeLevelOf(request.channel) === undefined) {
      return fail(id, 'channel_not_allowed', `Channel not exposed to agents: ${request.channel}`);
    }

    const dispatch = deps.getDispatch();
    if (!dispatch) {
      return fail(id, 'not_ready', 'CarbonInk is not ready to accept requests yet.');
    }
    const handler = dispatch.get(request.channel);
    if (!handler) {
      // Allowlisted but absent from the table — a typo in the allowlist, or a
      // channel that was renamed. Worth distinguishing from a refusal.
      return fail(id, 'not_ready', `Channel is unavailable: ${request.channel}`);
    }

    const value = await handler(...request.args);
    return { id, ok: true, value };
  } catch (err) {
    // Handlers are already wrapped by `sanitize()`, so a message reaching here
    // is safe to forward; anything else degrades to a generic string.
    const message = err instanceof Error ? err.message : 'Request failed.';
    return fail(id, id === '' ? 'bad_request' : 'handler_error', message);
  }
}

function fail(id: string, code: BridgeErrorCode, message: string): BridgeResponse {
  return { id, ok: false, error: { code, message } };
}
