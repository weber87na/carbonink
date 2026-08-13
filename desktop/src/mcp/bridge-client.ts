import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { agentBridgeAddress } from '@shared/agent-bridge/socket-path.js';
import { userDataDir } from './db.js';

/**
 * Client half of the agent bridge (spec 2026-08-13-mcp-write-path-integrity).
 *
 * Read tools in this process still open SQLite directly — a read can be stale
 * but never corrupting, and answering questions with the app closed is worth
 * keeping. Writes go through here instead, so an agent's change lands via the
 * same `ActivityDataService.create` the GUI uses and inherits its EF pinning,
 * unit conversion, CO2e computation, audit event and undo entry.
 *
 * Deliberately connect-per-request: tool calls are infrequent and a short-lived
 * socket removes any reconnect/liveness state machine. The address is derived
 * from userData, the same way the database path is.
 */

/** The app is not running (or has not opened its socket yet). */
export class AppNotRunningError extends Error {
  constructor() {
    super(
      'CarbonInk is not running. Start the CarbonInk desktop app and retry — ' +
        'changes are written through the app so they get the same emission-factor ' +
        'pinning, unit conversion and audit trail as edits made in the UI. ' +
        '(Read-only tools work without the app.)',
    );
    this.name = 'AppNotRunningError';
  }
}

/** The bridge answered, but the request failed. */
export class BridgeRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeRequestError';
  }
}

const CONNECT_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 60_000;

export function callBridge(channel: string, input: unknown): Promise<unknown> {
  const id = randomUUID();
  const address = agentBridgeAddress(userDataDir());

  return new Promise<unknown>((resolve, reject) => {
    const socket = connect(address);
    let buffer = '';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new BridgeRequestError('timeout', 'CarbonInk did not respond.'))),
      REQUEST_TIMEOUT_MS,
    );

    socket.setTimeout(CONNECT_TIMEOUT_MS, () => {
      if (!socket.writableEnded) finish(() => reject(new AppNotRunningError()));
    });

    socket.on('connect', () => {
      socket.setTimeout(0);
      socket.write(`${JSON.stringify({ id, channel, args: [input] })}\n`);
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      // ENOENT: no socket file. ECONNREFUSED: stale file, nothing listening.
      const notRunning = err.code === 'ENOENT' || err.code === 'ECONNREFUSED';
      finish(() => reject(notRunning ? new AppNotRunningError() : err));
    });

    socket.setEncoding('utf-8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      let parsed: {
        id?: string;
        ok?: boolean;
        value?: unknown;
        error?: { code?: string; message?: string };
      };
      try {
        parsed = JSON.parse(line);
      } catch {
        finish(() =>
          reject(new BridgeRequestError('bad_response', 'Unreadable response from CarbonInk.')),
        );
        return;
      }
      if (parsed.id !== id) return; // not ours; keep waiting
      if (parsed.ok) {
        finish(() => resolve(parsed.value));
      } else {
        finish(() =>
          reject(
            new BridgeRequestError(
              parsed.error?.code ?? 'handler_error',
              parsed.error?.message ?? 'Request failed.',
            ),
          ),
        );
      }
    });

    socket.on('close', () => {
      finish(() =>
        reject(new BridgeRequestError('closed', 'CarbonInk closed the connection early.')),
      );
    });
  });
}
