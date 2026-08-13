import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startAgentBridge, stopAgentBridge } from '@main/agent-bridge/server';
import type { DispatchMap } from '@main/ipc/dispatch';
import { agentBridgeAddress } from '@shared/agent-bridge/socket-path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * These drive a REAL unix socket rather than calling `dispatchLine` directly:
 * the framing (partial reads, one response per line) is exactly the part most
 * likely to break, and it is invisible to a function-level test.
 */

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function bootBridge(getDispatch: () => DispatchMap | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'carbonink-bridge-'));
  const address = agentBridgeAddress(dir);
  const server = startAgentBridge({ address, getDispatch });
  cleanups.push(() => {
    stopAgentBridge(server, address);
    rmSync(dir, { recursive: true, force: true });
  });
  return address;
}

/** Send one framed request, resolve the first response line. */
function request(address: string, payload: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect(address, () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.setEncoding('utf-8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      socket.destroy();
      try {
        resolve(JSON.parse(line));
      } catch (err) {
        reject(err);
      }
    });
    socket.on('error', reject);
  });
}

/** Send a raw (possibly malformed) string with no framing help. */
function requestRaw(address: string, raw: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = connect(address, () => socket.write(raw));
    socket.setEncoding('utf-8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      socket.destroy();
      try {
        resolve(JSON.parse(buffer.slice(0, newline)));
      } catch (err) {
        reject(err);
      }
    });
    socket.on('error', reject);
  });
}

function mapOf(entries: Record<string, (...args: unknown[]) => unknown>): DispatchMap {
  return new Map(Object.entries(entries));
}

describe('agent bridge server', () => {
  it('dispatches an allowlisted channel and returns the handler value', async () => {
    const address = bootBridge(() => mapOf({ 'activity:create': (input) => ({ echoed: input }) }));

    const res = await request(address, {
      id: 'r1',
      channel: 'activity:create',
      args: [{ amount: 5 }],
    });

    expect(res).toEqual({ id: 'r1', ok: true, value: { echoed: { amount: 5 } } });
  });

  it('awaits async handlers', async () => {
    const address = bootBridge(() => mapOf({ 'source:create': async () => ({ id: 'es-async' }) }));

    const res = await request(address, { id: 'r2', channel: 'source:create', args: [{}] });

    expect(res).toEqual({ id: 'r2', ok: true, value: { id: 'es-async' } });
  });

  it('refuses a channel that is not on the allowlist, without reaching the handler', async () => {
    let reached = false;
    // data:reset is present in the dispatch table but must never be exposed --
    // this is the whole reason the gate is an allowlist rather than a denylist.
    const address = bootBridge(() =>
      mapOf({
        'data:reset': () => {
          reached = true;
          return 'wiped';
        },
      }),
    );

    const res = await request(address, { id: 'r3', channel: 'data:reset', args: [] });

    expect(res.ok).toBe(false);
    expect((res.error as { code: string }).code).toBe('channel_not_allowed');
    expect(reached).toBe(false);
  });

  it('reports not_ready when there is no dispatch table (mid workspace switch)', async () => {
    const address = bootBridge(() => null);

    const res = await request(address, { id: 'r4', channel: 'activity:create', args: [{}] });

    expect(res.ok).toBe(false);
    expect((res.error as { code: string }).code).toBe('not_ready');
  });

  it('re-reads the dispatch table per request so a workspace switch takes effect', async () => {
    let current = mapOf({ 'activity:create': () => 'workspace-a' });
    const address = bootBridge(() => current);

    const first = await request(address, { id: 'r5', channel: 'activity:create', args: [{}] });
    current = mapOf({ 'activity:create': () => 'workspace-b' });
    const second = await request(address, { id: 'r6', channel: 'activity:create', args: [{}] });

    expect(first.value).toBe('workspace-a');
    expect(second.value).toBe('workspace-b');
  });

  it('surfaces a handler throw as handler_error rather than dropping the connection', async () => {
    const address = bootBridge(() =>
      mapOf({
        'activity:create': () => {
          throw new Error('Emission factor is not pinned.');
        },
      }),
    );

    const res = await request(address, { id: 'r7', channel: 'activity:create', args: [{}] });

    expect(res.ok).toBe(false);
    expect((res.error as { code: string }).code).toBe('handler_error');
    expect((res.error as { message: string }).message).toBe('Emission factor is not pinned.');
  });

  it('answers bad_request for a malformed frame', async () => {
    const address = bootBridge(() => mapOf({}));

    const res = await requestRaw(address, 'not json at all\n');

    expect(res.ok).toBe(false);
    expect((res.error as { code: string }).code).toBe('bad_request');
  });

  it('answers bad_request when the frame is JSON but not a request', async () => {
    const address = bootBridge(() => mapOf({}));

    const res = await request(address, { id: 'r8', channel: 'activity:create' });

    expect(res.ok).toBe(false);
    expect((res.error as { code: string }).code).toBe('bad_request');
  });

  it('handles two frames arriving in one chunk', async () => {
    const address = bootBridge(() => mapOf({ 'activity:create': (i) => i }));

    const responses = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const socket = connect(address, () => {
        socket.write(
          `${JSON.stringify({ id: 'a', channel: 'activity:create', args: ['first'] })}\n` +
            `${JSON.stringify({ id: 'b', channel: 'activity:create', args: ['second'] })}\n`,
        );
      });
      socket.setEncoding('utf-8');
      let buffer = '';
      const out: Record<string, unknown>[] = [];
      socket.on('data', (chunk: string) => {
        buffer += chunk;
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
          out.push(JSON.parse(buffer.slice(0, newline)));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
        }
        if (out.length === 2) {
          socket.destroy();
          resolve(out);
        }
      });
      socket.on('error', reject);
    });

    expect(responses.map((r) => r.value).sort()).toEqual(['first', 'second']);
  });
});
