/// <reference types="vite/client" />
/**
 * Latency-instrumentation runtime (F4 CP2) — plain module, not a zustand store.
 * Samples are pushed into module-level mutable ring buffers so that recording a
 * measurement never triggers a React re-render; the debug HUD (CP5) polls
 * `latencySnapshot()` instead of subscribing.
 */
import {
  type LatencyAction,
  type LatencySample,
  type LatencyAggregate,
  pushSample,
  snapshotOf,
  budgetFor,
  foldSample,
  foldRollback,
  withP95,
  p95,
} from '../lib/latency';

const buffers: Partial<Record<LatencyAction, LatencySample[]>> = {};
const rollbacks: Partial<Record<LatencyAction, number>> = {};

// --- CP5: persisted violation aggregates (DECISIONS D3) ---------------------
// Raw samples never leave memory; only cumulative counters are persisted.
const STORAGE_KEY = 'zenmail-latency';
const STORAGE_VERSION = 1;

interface PersistedLatency {
  version: number;
  aggregates: Partial<Record<LatencyAction, LatencyAggregate>>;
}

function loadAggregates(): Partial<Record<LatencyAction, LatencyAggregate>> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedLatency;
    if (parsed?.version !== STORAGE_VERSION || !parsed.aggregates) return {};
    return parsed.aggregates;
  } catch {
    return {};
  }
}

const aggregates: Partial<Record<LatencyAction, LatencyAggregate>> = loadAggregates();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(): void {
  if (typeof localStorage === 'undefined') return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const payload: PersistedLatency = { version: STORAGE_VERSION, aggregates };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // storage full/unavailable — diagnostics only, never fatal
    }
  }, 1000);
}

/** Records one optimistic-mutation rollback for `action` (F4 CP3 — failure recovery). */
export function recordRollback(action: LatencyAction): void {
  rollbacks[action] = (rollbacks[action] ?? 0) + 1;
  aggregates[action] = foldRollback(aggregates[action], Date.now());
  scheduleSave();
}

/**
 * Stamps t0 and returns a completion mark to call right after the optimistic
 * `set(...)` for `action`. The mark records the setReturn delta immediately,
 * then waits two animation frames (paint commit) before folding the sample
 * into `action`'s ring buffer with the confirmed total latency.
 */
export function instrument(action: LatencyAction): () => void {
  const t0 = performance.now();
  let committed = false;
  return () => {
    if (committed) return; // idempotent — guards accidental double-invocation
    committed = true;
    const setReturn = performance.now() - t0;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const total = performance.now() - t0;
        const sample: LatencySample = { total, setReturn };
        buffers[action] = pushSample(buffers[action] ?? [], sample);
        const now = Date.now();
        const folded = foldSample(aggregates[action], sample, action, now);
        aggregates[action] = withP95(folded, p95(buffers[action] ?? []));
        scheduleSave();
        if (import.meta.env.DEV && total > budgetFor(action)) {
          console.warn(`[latency] ${action} ${Math.round(total)}ms > budget ${budgetFor(action)}ms`);
        }
      })
    );
  };
}

/** Builds a fresh LatencySnapshot from the live ring buffers, plus per-action rollback counts and persisted aggregates. */
export function latencySnapshot() {
  return { actions: snapshotOf(buffers), rollbacks: { ...rollbacks }, aggregates: { ...aggregates } };
}

// --- CP5: hidden diagnostic HUD toggle (⌘⌥⇧L) --------------------------------
// Not a zustand store — mirrors this file's plain-module pattern so toggling
// never forces a re-render outside the HUD itself.
let hudOpen = false;
const hudListeners = new Set<() => void>();

export function isHudOpen(): boolean {
  return hudOpen;
}

export function subscribeHud(listener: () => void): () => void {
  hudListeners.add(listener);
  return () => hudListeners.delete(listener);
}

export function toggleHud(): void {
  hudOpen = !hudOpen;
  for (const listener of hudListeners) listener();
}

// E2E / diagnostics read-only exposure (D9 — always exposed, no env gate).
declare global {
  interface Window {
    __zenmailLatency?: { snapshot: typeof latencySnapshot };
  }
}
if (typeof window !== 'undefined') {
  window.__zenmailLatency = { snapshot: latencySnapshot };
}
