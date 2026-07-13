/**
 * Pure latency-instrumentation helpers — no React/store imports (mirrors coach.ts, DECISIONS D10 pattern).
 * Consumed by store latency instrumentation and exercised directly by latency.test.ts.
 */

/** Every action whose perceived-latency is tracked (F4 CP1). */
export type LatencyAction =
  | 'archive'
  | 'trash'
  | 'markRead'
  | 'applyLabel'
  | 'snooze'
  | 'send'
  | 'followup:add'
  | 'followup:cancel'
  | 'followup:dismiss'
  | 'openThread:select'
  | 'openThread:content'
  | 'rsvp';

/** Budget for mutation actions and the thread-select paint (ms). */
export const BUDGET_MS = 100;
/** Budget for the informational thread-content paint (ms). */
export const CONTENT_BUDGET_MS = 300;
/** E2E hard-gate ceiling any single sample must never exceed (ms). */
export const GROSS_MS = 400;
/** Per-action ring buffer capacity. */
export const RING_CAP = 50;
/** Minimum sample size required before a percentile reading is trusted (coach.ts meetsMinSample pattern). */
export const MIN_SAMPLE = 20;

/** Only the thread-content paint is informational; everything else is a hard budget. */
export function classify(action: LatencyAction): 'budgeted' | 'informational' {
  return action === 'openThread:content' ? 'informational' : 'budgeted';
}

/** Budget (ms) that applies to `action`. */
export function budgetFor(action: LatencyAction): number {
  return classify(action) === 'informational' ? CONTENT_BUDGET_MS : BUDGET_MS;
}

/**
 * A single latency measurement.
 * `total` — double-rAF paint-commit latency (primary metric).
 * `setReturn` — optimistic store-set return latency (secondary diagnostic).
 */
export interface LatencySample {
  total: number;
  setReturn: number;
}

/** Pushes `s` onto `buf`, returning a new array capped at RING_CAP (oldest dropped, FIFO). */
export function pushSample(buf: LatencySample[], s: LatencySample): LatencySample[] {
  const next = [...buf, s];
  if (next.length <= RING_CAP) return next;
  return next.slice(next.length - RING_CAP);
}

/** p-th percentile of `samples`. null when the sample size is below MIN_SAMPLE (guards noisy reads). */
export function percentile(samples: number[], p: number): number | null {
  const n = samples.length;
  if (n < MIN_SAMPLE) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * n) - 1;
  return sorted[index];
}

/** p50 of `buf`'s total latencies. null below MIN_SAMPLE. */
export function p50(buf: LatencySample[]): number | null {
  return percentile(buf.map((s) => s.total), 50);
}

/** p95 of `buf`'s total latencies. null below MIN_SAMPLE. */
export function p95(buf: LatencySample[]): number | null {
  return percentile(buf.map((s) => s.total), 95);
}

/** Number of samples in `buf` whose total latency exceeds `thresholdMs`. */
export function countOver(buf: LatencySample[], thresholdMs: number): number {
  return buf.filter((s) => s.total > thresholdMs).length;
}

/** Cumulative persisted counters for one action (survives past the ring buffer's rolling window). */
export interface LatencyAggregate {
  count: number;
  budgetViolations: number;
  grossViolations: number;
  lastP95: number | null;
  rollbacks: number;
  updatedAt: number;
}

function zeroAggregate(now: number): LatencyAggregate {
  return { count: 0, budgetViolations: 0, grossViolations: 0, lastP95: null, rollbacks: 0, updatedAt: now };
}

/** Folds one freshly-committed `sample` into `prev`, incrementing count and violation counters. */
export function foldSample(
  prev: LatencyAggregate | undefined,
  sample: LatencySample,
  action: LatencyAction,
  now: number
): LatencyAggregate {
  const base = prev ?? zeroAggregate(now);
  return {
    ...base,
    count: base.count + 1,
    budgetViolations: base.budgetViolations + (sample.total > budgetFor(action) ? 1 : 0),
    grossViolations: base.grossViolations + (sample.total > GROSS_MS ? 1 : 0),
    updatedAt: now,
  };
}

/** Snapshots the current p95 reading onto `agg` (called separately from sample folding). */
export function withP95(agg: LatencyAggregate, p95value: number | null): LatencyAggregate {
  return { ...agg, lastP95: p95value };
}

/** Folds one optimistic-rollback event into `prev` (e.g. a mutation that failed and reverted). */
export function foldRollback(prev: LatencyAggregate | undefined, now: number): LatencyAggregate {
  const base = prev ?? zeroAggregate(now);
  return { ...base, rollbacks: base.rollbacks + 1, updatedAt: now };
}

/** Per-action summary shape shared by the E2E harness and the debug HUD. */
export interface LatencySnapshot {
  [action: string]: {
    count: number;
    p50: number | null;
    p95: number | null;
    overBudget: number;
    overGross: number;
  };
}

/** Builds a LatencySnapshot from live ring buffers, one entry per action present in `buffers`. */
export function snapshotOf(buffers: Partial<Record<LatencyAction, LatencySample[]>>): LatencySnapshot {
  const snapshot: LatencySnapshot = {};
  for (const [action, buf] of Object.entries(buffers) as [LatencyAction, LatencySample[] | undefined][]) {
    if (!buf) continue;
    snapshot[action] = {
      count: buf.length,
      p50: p50(buf),
      p95: p95(buf),
      overBudget: countOver(buf, budgetFor(action)),
      overGross: countOver(buf, GROSS_MS),
    };
  }
  return snapshot;
}
