import { describe, expect, it } from 'vitest';
import type { FetchThreadsResponse, ThreadSummary } from '../shared/types';
import { computeRevalidateDiff } from './revalidate';

function summary(id: string, date: number, labelIds: string[] = ['INBOX']): ThreadSummary {
  return {
    id,
    subject: `subject ${id}`,
    from: { name: id, email: `${id}@example.com` },
    snippet: `snippet ${id}`,
    date,
    unread: false,
    labelIds,
    messageCount: 1,
  };
}

const NONE = { guarded: () => false, isSnoozed: () => false };

describe('computeRevalidateDiff — SWR revalidate diff (D3/D4)', () => {
  it('empty complete fresh + 84 viewRows → all 84 removed', () => {
    const viewRows = Array.from({ length: 84 }, (_, i) => ({ id: `t${i}`, date: 1000 + i }));
    const fresh: FetchThreadsResponse = { threads: [] }; // no nextPageToken → complete
    const diff = computeRevalidateDiff([], fresh, viewRows, NONE);
    expect(diff.removals).toHaveLength(84);
    expect(new Set(diff.removals)).toEqual(new Set(viewRows.map((r) => r.id)));
    expect(diff.upserts).toEqual([]);
    expect(diff.freshRowsToCache).toEqual([]);
  });

  it('partial page (nextPageToken): absent rows older than oldest are kept, >= oldest are removed', () => {
    // fresh window covers dates 500..600 (oldest = 500), and is a partial page.
    const fresh: FetchThreadsResponse = {
      threads: [summary('a', 600), summary('b', 500)],
      nextPageToken: 'more',
    };
    const viewRows = [
      { id: 'a', date: 600 }, // present in fresh
      { id: 'b', date: 500 }, // present in fresh
      { id: 'gone-in-window', date: 550 }, // absent, within window (>= oldest) → removed
      { id: 'gone-at-edge', date: 500 }, // absent, exactly oldest → removed
      { id: 'gone-below-window', date: 400 }, // absent, older than window → kept (boundary held)
    ];
    const diff = computeRevalidateDiff([], fresh, viewRows, NONE);
    expect(new Set(diff.removals)).toEqual(new Set(['gone-in-window', 'gone-at-edge']));
    expect(diff.removals).not.toContain('gone-below-window');
  });

  it('guarded ids are excluded from upserts, removals, and freshRowsToCache', () => {
    const fresh: FetchThreadsResponse = {
      threads: [summary('guarded', 900), summary('normal', 800)],
    }; // complete
    const viewRows = [
      { id: 'guarded', date: 900 },
      { id: 'normal', date: 800 },
      { id: 'guarded-absent', date: 700 }, // absent from fresh but guarded → not removed
      { id: 'plain-absent', date: 600 }, // absent, unguarded → removed
    ];
    const guardedIds = new Set(['guarded', 'guarded-absent']);
    const diff = computeRevalidateDiff([], fresh, viewRows, {
      guarded: (id) => guardedIds.has(id),
      isSnoozed: () => false,
    });
    expect(diff.freshRowsToCache.map((t) => t.id)).toEqual(['normal']);
    expect(diff.upserts.map((t) => t.id)).toEqual(['normal']);
    expect(diff.removals).toEqual(['plain-absent']);
  });

  it('snoozed fresh ids are excluded from upserts/cache but still count as present', () => {
    const fresh: FetchThreadsResponse = {
      threads: [summary('snoozed', 900), summary('normal', 800)],
    }; // complete
    const viewRows = [
      { id: 'snoozed', date: 900 }, // in fresh AND has a stale cache row — must NOT be removed
      { id: 'normal', date: 800 },
    ];
    const diff = computeRevalidateDiff([], fresh, viewRows, {
      guarded: () => false,
      isSnoozed: (id) => id === 'snoozed',
    });
    // excluded from cache write + upserts...
    expect(diff.freshRowsToCache.map((t) => t.id)).toEqual(['normal']);
    expect(diff.upserts.map((t) => t.id)).toEqual(['normal']);
    // ...but still present → not a removal candidate.
    expect(diff.removals).not.toContain('snoozed');
    expect(diff.removals).toEqual([]);
  });

  it('unchanged page → zero upserts', () => {
    const rows = [summary('a', 900), summary('b', 800)];
    const fresh: FetchThreadsResponse = { threads: rows.map((r) => ({ ...r })) };
    const cached = rows.map((r) => ({ ...r }));
    const viewRows = rows.map((r) => ({ id: r.id, date: r.date }));
    const diff = computeRevalidateDiff(cached, fresh, viewRows, NONE);
    expect(diff.upserts).toEqual([]);
    expect(diff.removals).toEqual([]);
  });
});
