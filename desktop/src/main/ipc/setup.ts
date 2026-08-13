import { IpcListener } from '@electron-toolkit/typed-ipc/main';
import { getAppDb } from '@main/db/connection.js';
import { defaultNow } from '@main/services/base.js';
import { getMainWindow } from '@main/window.js';
import { createIpcContext } from './context.js';
import { buildDispatchMap, type DispatchMap } from './dispatch.js';
import { createProgressEmitter } from './progress.js';
import type { IpcTypeMap } from './types.js';

let listener: IpcListener<IpcTypeMap> | null = null;
let dispatchMap: DispatchMap | null = null;

export function setupIpc(): void {
  if (listener) return;

  // Derive printRenderUrl from ELECTRON_RENDERER_URL or use the built renderer path
  const printRenderUrl = process.env.ELECTRON_RENDERER_URL
    ? `${process.env.ELECTRON_RENDERER_URL}/print-render`
    : 'about:blank/print-render';

  const ctx = createIpcContext(
    { db: getAppDb(), now: defaultNow },
    { progressEmitter: createProgressEmitter(getMainWindow), printRenderUrl },
  );
  const l = new IpcListener<IpcTypeMap>();
  const map = buildDispatchMap(ctx);

  for (const [channel, wrapped] of map) {
    // biome-ignore lint/suspicious/noExplicitAny: heterogeneous handler dispatch
    (l.handle as (c: string, h: (...a: any[]) => unknown) => void)(
      channel,
      (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => wrapped(...args),
    );
  }

  listener = l;
  dispatchMap = map;
}

/**
 * The live dispatch table, or `null` before {@link setupIpc} / after
 * {@link cleanupIpc}. The agent bridge holds a reference to THIS function
 * rather than to a map, so a workspace switch (cleanupIpc → reopen db →
 * setupIpc) is picked up on the next request instead of pinning the bridge to
 * the previous workspace's services — mirroring how `mcp/db.ts` re-resolves the
 * active workspace per call.
 */
export function getDispatchMap(): DispatchMap | null {
  return dispatchMap;
}

export function cleanupIpc(): void {
  if (!listener) return;
  listener.dispose();
  listener = null;
  dispatchMap = null;
}
