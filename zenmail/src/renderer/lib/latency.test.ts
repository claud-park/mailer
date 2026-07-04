import { describe, expect, it } from 'vitest';
import {
  BUDGET_MS,
  CONTENT_BUDGET_MS,
  RING_CAP,
  budgetFor,
  classify,
  countOver,
  foldRollback,
  foldSample,
  p50,
  p95,
  percentile,
  pushSample,
  snapshotOf,
  withP95,
  type LatencyAction,
  type LatencySample,
} from './latency';

describe('pushSample (ring buffer)', () => {
  it('keeps the newest RING_CAP samples in FIFO order once over capacity', () => {
    let buf: LatencySample[] = [];
    for (let i = 0; i < 55; i++) {
      buf = pushSample(buf, { total: i, setReturn: i });
    }
    expect(buf.length).toBe(RING_CAP);
    expect(buf[0].total).toBe(5); // oldest 5 (0..4) evicted
    expect(buf[buf.length - 1].total).toBe(54);
  });

  it('does not mutate the input array', () => {
    const original: LatencySample[] = [{ total: 1, setReturn: 1 }];
    const next = pushSample(original, { total: 2, setReturn: 2 });
    expect(original.length).toBe(1);
    expect(next).not.toBe(original);
  });
});

describe('percentile', () => {
  it('is null below MIN_SAMPLE (n=19)', () => {
    const samples = Array.from({ length: 19 }, (_, i) => i + 1);
    expect(percentile(samples, 50)).toBeNull();
  });

  it('is null for a single sample', () => {
    expect(percentile([42], 50)).toBeNull();
  });

  it('computes p50 and p95 exactly at n=20', () => {
    // shuffled input to prove sorting happens internally
    const samples = [12, 3, 20, 7, 1, 15, 9, 2, 18, 4, 10, 6, 19, 8, 14, 5, 17, 11, 16, 13];
    expect(percentile(samples, 50)).toBe(10);
    expect(percentile(samples, 95)).toBe(19);
  });
});

describe('p50 / p95', () => {
  it('extracts total from samples and defers to percentile', () => {
    const buf: LatencySample[] = Array.from({ length: 20 }, (_, i) => ({ total: i + 1, setReturn: 0 }));
    expect(p50(buf)).toBe(10);
    expect(p95(buf)).toBe(19);
  });

  it('is null below MIN_SAMPLE', () => {
    const buf: LatencySample[] = Array.from({ length: 5 }, (_, i) => ({ total: i + 1, setReturn: 0 }));
    expect(p50(buf)).toBeNull();
    expect(p95(buf)).toBeNull();
  });
});

describe('countOver', () => {
  it('counts only samples strictly over the threshold', () => {
    const buf: LatencySample[] = [50, 100, 101, 400, 401, 150].map((total) => ({ total, setReturn: 0 }));
    expect(countOver(buf, 100)).toBe(4); // 101, 400, 401, 150
    expect(countOver(buf, 400)).toBe(1); // 401
  });
});

describe('classify / budgetFor', () => {
  const actions: LatencyAction[] = [
    'archive',
    'trash',
    'markRead',
    'applyLabel',
    'snooze',
    'send',
    'followup:add',
    'followup:cancel',
    'followup:dismiss',
    'openThread:select',
  ];

  it('is "informational" and CONTENT_BUDGET_MS only for openThread:content', () => {
    expect(classify('openThread:content')).toBe('informational');
    expect(budgetFor('openThread:content')).toBe(CONTENT_BUDGET_MS);
  });

  it('is "budgeted" and BUDGET_MS for every other action', () => {
    for (const action of actions) {
      expect(classify(action)).toBe('budgeted');
      expect(budgetFor(action)).toBe(BUDGET_MS);
    }
  });
});

describe('foldSample', () => {
  it('starts from zero when prev is undefined', () => {
    const agg = foldSample(undefined, { total: 50, setReturn: 10 }, 'archive', 1000);
    expect(agg).toEqual({
      count: 1,
      budgetViolations: 0,
      grossViolations: 0,
      lastP95: null,
      rollbacks: 0,
      updatedAt: 1000,
    });
  });

  it('accumulates count and budget/gross violations across commits', () => {
    let agg = foldSample(undefined, { total: 50, setReturn: 10 }, 'archive', 1000); // under budget
    agg = foldSample(agg, { total: 150, setReturn: 10 }, 'archive', 2000); // over budget, under gross
    agg = foldSample(agg, { total: 401, setReturn: 10 }, 'archive', 3000); // over both

    expect(agg.count).toBe(3);
    expect(agg.budgetViolations).toBe(2);
    expect(agg.grossViolations).toBe(1);
    expect(agg.updatedAt).toBe(3000);
  });

  it('uses the informational CONTENT_BUDGET_MS for openThread:content', () => {
    const agg = foldSample(undefined, { total: 350, setReturn: 10 }, 'openThread:content', 1000);
    expect(agg.budgetViolations).toBe(1); // 350 > 300
    expect(agg.grossViolations).toBe(0); // 350 < GROSS_MS
  });
});

describe('withP95', () => {
  it('sets lastP95 without touching other fields', () => {
    const agg = foldSample(undefined, { total: 50, setReturn: 10 }, 'archive', 1000);
    const withValue = withP95(agg, 42);
    expect(withValue).toEqual({ ...agg, lastP95: 42 });

    const withNull = withP95(withValue, null);
    expect(withNull.lastP95).toBeNull();
  });
});

describe('foldRollback', () => {
  it('starts from zero when prev is undefined', () => {
    const agg = foldRollback(undefined, 1000);
    expect(agg).toEqual({
      count: 0,
      budgetViolations: 0,
      grossViolations: 0,
      lastP95: null,
      rollbacks: 1,
      updatedAt: 1000,
    });
  });

  it('increments rollbacks without disturbing other counters', () => {
    let agg = foldSample(undefined, { total: 50, setReturn: 10 }, 'send', 1000);
    agg = foldRollback(agg, 2000);
    expect(agg.count).toBe(1);
    expect(agg.rollbacks).toBe(1);
    expect(agg.updatedAt).toBe(2000);
  });
});

describe('snapshotOf', () => {
  it('shapes one entry per action, gating percentiles by MIN_SAMPLE but not overBudget/overGross', () => {
    const archiveBuf: LatencySample[] = Array.from({ length: 20 }, () => ({ total: 50, setReturn: 0 }));
    const contentBuf: LatencySample[] = Array.from({ length: 5 }, () => ({ total: 350, setReturn: 0 }));

    const snapshot = snapshotOf({ archive: archiveBuf, 'openThread:content': contentBuf });

    expect(snapshot.archive).toEqual({ count: 20, p50: 50, p95: 50, overBudget: 0, overGross: 0 });
    expect(snapshot['openThread:content']).toEqual({
      count: 5,
      p50: null, // below MIN_SAMPLE
      p95: null,
      overBudget: 5, // all 5 exceed the 300ms informational budget
      overGross: 0,
    });
  });

  it('omits actions absent from the input map', () => {
    const snapshot = snapshotOf({ trash: [{ total: 10, setReturn: 0 }] });
    expect(Object.keys(snapshot)).toEqual(['trash']);
  });
});
