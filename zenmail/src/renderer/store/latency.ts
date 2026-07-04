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
  pushSample,
  snapshotOf,
  budgetFor,
} from '../lib/latency';

const buffers: Partial<Record<LatencyAction, LatencySample[]>> = {};

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
        buffers[action] = pushSample(buffers[action] ?? [], { total, setReturn });
        if (import.meta.env.DEV && total > budgetFor(action)) {
          console.warn(`[latency] ${action} ${Math.round(total)}ms > budget ${budgetFor(action)}ms`);
        }
      })
    );
  };
}

/** Builds a fresh LatencySnapshot from the live ring buffers. */
export function latencySnapshot() {
  return snapshotOf(buffers);
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
