/**
 * Channels an external agent may reach over the bridge, and at what level.
 *
 * Everything not listed here is refused before dispatch. That inversion is the
 * whole security posture: the bridge hands out access to the app's entire IPC
 * dispatch table, which includes `data:reset`, `workspace:switch` and
 * `settings:set-provider` (API keys). An allowlist fails closed when a new
 * channel is added; a denylist would silently expose it.
 *
 * Mirrors the shape of the preload channel allowlist, and is where the
 * `readOnly | write | destructive` classification from the AI-native research
 * first lands. v1 carries only the three writes the MCP tools need — reads
 * still go straight to SQLite in the MCP process, so they never arrive here.
 */
export type BridgeLevel = 'read' | 'write';

export const BRIDGE_ALLOWLIST: Readonly<Record<string, BridgeLevel>> = {
  'activity:create': 'write',
  'source:create': 'write',
  'answer:save': 'write',
};

export function bridgeLevelOf(channel: string): BridgeLevel | undefined {
  return Object.hasOwn(BRIDGE_ALLOWLIST, channel) ? BRIDGE_ALLOWLIST[channel] : undefined;
}
