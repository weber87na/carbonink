import { createHash } from 'node:crypto';
import { join } from 'node:path';

/**
 * Where the agent bridge listens.
 *
 * The MCP server runs as a separate process spawned by the agent host (Claude
 * Desktop / Code / Cursor / Pi), not by us, so it cannot be handed a file
 * descriptor — it has to find the running app by convention. Both sides derive
 * the address from the same userData directory: the app knows it from
 * `app.getPath('userData')`, the MCP process reconstructs it in `mcp/db.ts`.
 *
 * Unix gets a socket file inside userData, which piggybacks on the directory's
 * own permissions. Windows has no unix sockets and named pipes live in a flat
 * global namespace, so the userData path is hashed into the pipe name — two
 * installs (or an E2E run with `CARBONINK_TEST_USER_DATA_DIR`) must not collide
 * on one pipe and cross-talk.
 */
export function agentBridgeAddress(userDataDir: string): string {
  if (process.platform === 'win32') {
    const tag = createHash('sha256').update(userDataDir).digest('hex').slice(0, 16);
    return `\\\\.\\pipe\\carbonink-agent-bridge-${tag}`;
  }
  return join(userDataDir, 'agent-bridge.sock');
}

/** Windows named pipes are not filesystem entries — never unlink them. */
export function addressIsFile(address: string): boolean {
  return !address.startsWith('\\\\.\\pipe\\');
}
