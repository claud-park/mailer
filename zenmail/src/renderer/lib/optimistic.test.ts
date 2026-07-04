import { describe, expect, it } from 'vitest';
import { captureRemoval, reinsert, removeLabelId, toggleUnread } from './optimistic';
import type { ThreadSummary } from '../../shared/types';

function thread(id: string, overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id,
    subject: `subject-${id}`,
    from: { name: 'A', email: 'a@example.com' },
    snippet: '',
    date: 0,
    unread: false,
    labelIds: [],
    messageCount: 1,
    ...overrides,
  };
}

describe('captureRemoval', () => {
  it('captures the thread and its index', () => {
    const threads = [thread('a'), thread('b'), thread('c')];
    expect(captureRemoval(threads, 'b')).toEqual({ thread: threads[1], index: 1 });
  });

  it('returns null when the id is absent', () => {
    expect(captureRemoval([thread('a')], 'missing')).toBeNull();
  });
});

describe('reinsert', () => {
  it('re-inserts at the captured index', () => {
    const threads = [thread('a'), thread('c')];
    const capture = { thread: thread('b'), index: 1 };
    const result = reinsert(threads, capture);
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('pushes to the end when the index exceeds the array length', () => {
    const threads = [thread('a')];
    const capture = { thread: thread('z'), index: 99 };
    const result = reinsert(threads, capture);
    expect(result.map((t) => t.id)).toEqual(['a', 'z']);
  });

  it('is a no-op guard when the id is already present', () => {
    const threads = [thread('a'), thread('b')];
    const capture = { thread: thread('b'), index: 0 };
    const result = reinsert(threads, capture);
    expect(result).toEqual(threads);
  });

  it('reinsert called twice is idempotent (second call is a guarded no-op)', () => {
    const threads = [thread('a'), thread('c')];
    const capture = { thread: thread('b'), index: 1 };
    const once = reinsert(threads, capture);
    const twice = reinsert(once, capture);
    expect(twice.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const threads = [thread('a'), thread('c')];
    const before = [...threads];
    reinsert(threads, { thread: thread('b'), index: 1 });
    expect(threads).toEqual(before);
  });

  it('overlap scenario: X capture -> Y remove -> X reinsert leaves Y absent (TC-C2)', () => {
    let threads = [thread('x'), thread('y'), thread('z')];
    const captureX = captureRemoval(threads, 'x')!;
    threads = threads.filter((t) => t.id !== 'x'); // X's optimistic removal committed
    // Y is now optimistically removed too (in-flight failure for a different action)
    threads = threads.filter((t) => t.id !== 'y');
    // X's mutation fails and rolls back
    threads = reinsert(threads, captureX);
    expect(threads.map((t) => t.id)).toEqual(['x', 'z']);
    expect(threads.some((t) => t.id === 'y')).toBe(false);
  });
});

describe('toggleUnread', () => {
  it('sets unread true and adds the UNREAD label', () => {
    const threads = [thread('a', { unread: false, labelIds: ['INBOX'] })];
    const result = toggleUnread(threads, 'a', true);
    expect(result[0].unread).toBe(true);
    expect(result[0].labelIds).toEqual(['INBOX', 'UNREAD']);
  });

  it('sets unread false and removes the UNREAD label', () => {
    const threads = [thread('a', { unread: true, labelIds: ['INBOX', 'UNREAD'] })];
    const result = toggleUnread(threads, 'a', false);
    expect(result[0].unread).toBe(false);
    expect(result[0].labelIds).toEqual(['INBOX']);
  });

  it('is idempotent when called twice with the same value', () => {
    const threads = [thread('a', { unread: true, labelIds: ['UNREAD'] })];
    const once = toggleUnread(threads, 'a', true);
    const twice = toggleUnread(once, 'a', true);
    expect(twice).toEqual(once);
  });

  it('leaves other threads untouched', () => {
    const threads = [thread('a', { unread: false }), thread('b', { unread: false })];
    const result = toggleUnread(threads, 'a', true);
    expect(result[1]).toEqual(threads[1]);
  });
});

describe('removeLabelId', () => {
  it('removes the labelId from the target thread', () => {
    const threads = [thread('a', { labelIds: ['INBOX', 'STARRED'] })];
    const result = removeLabelId(threads, 'a', 'STARRED');
    expect(result[0].labelIds).toEqual(['INBOX']);
  });

  it('is a no-op when the labelId is absent', () => {
    const threads = [thread('a', { labelIds: ['INBOX'] })];
    const result = removeLabelId(threads, 'a', 'STARRED');
    expect(result[0].labelIds).toEqual(['INBOX']);
  });

  it('leaves other threads untouched', () => {
    const threads = [thread('a', { labelIds: ['X'] }), thread('b', { labelIds: ['X'] })];
    const result = removeLabelId(threads, 'a', 'X');
    expect(result[1]).toEqual(threads[1]);
  });
});
