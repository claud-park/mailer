// Connectivity + queue-depth state for the sync engine (F6 CP2).
//
// Attempt-based authority (D9): a transient write failure flips online=false; a success flips
// it back. `navigator.onLine` in the renderer is only a *drain accelerator* (mail:renderer-online),
// never the sole authority. The single sidebar line (D10) is driven by mail:sync-state events
// carrying {online, pending}. No side effects beyond the electron send.

import type { BrowserWindow } from 'electron';
import type { ThreadSummary } from '../shared/types';

let online = true;
let reconnectHook: (() => void) | null = null;

let pendingCounter: () => number = () => 0;
/** ipc.ts가 컨텍스트 합산 집계를 등록한다 — sync-state는 cache를 직접 알지 않는다. */
export function registerPendingCounter(fn: () => number): void {
  pendingCounter = fn;
}

export function isOnline(): boolean {
  return online;
}

/**
 * Registers the offline→online drain trigger. CP3's daemon registers here; until then it stays
 * unset and the flip/accelerator paths are no-ops beyond state updates + sync-state emission.
 */
export function onReconnect(hook: (() => void) | null): void {
  reconnectHook = hook;
}

/** Forces the reconnect drain trigger (D9 renderer accelerator), independent of a state flip. */
export function triggerReconnect(): void {
  reconnectHook?.();
}

/**
 * Sets connectivity. `notify` fires only on an actual value flip (not on a redundant set), so the
 * online happy path stays silent. An offline→online flip additionally fires the reconnect drain
 * trigger (D9).
 */
export function setOnline(v: boolean, notify?: () => void): void {
  if (online === v) return;
  online = v;
  notify?.();
  if (v) reconnectHook?.();
}

/** Emits the sidebar sync line's data (D10): {online, pending queue depth}. */
export function emitSyncState(getWindow: () => BrowserWindow | null): void {
  getWindow()?.webContents.send('mail:sync-state', {
    online,
    pending: pendingCounter(),
  });
}

export interface ThreadsChangedPayload {
  accountId: string;
  upserts: ThreadSummary[];
  removals: string[];
  /** daemon-origin ticks (D1 compromise): renderer does a full refresh() instead of a pure diff merge. */
  needsRefetch?: boolean;
}

/**
 * The single change-propagation channel (F6 CP5, D1): replaces the old data-less `mail:threads-updated`
 * poke. Mutation-origin sends carry a pure diff (renderer merges, zero refetch); daemon-origin sends set
 * needsRefetch so the renderer refreshes (bounded to ≤1/min — churn is harmless, D1 compromise).
 */
export function notifyThreadsChanged(
  getWindow: () => BrowserWindow | null,
  payload: ThreadsChangedPayload
): void {
  getWindow()?.webContents.send('mail:threads-changed', payload);
}
