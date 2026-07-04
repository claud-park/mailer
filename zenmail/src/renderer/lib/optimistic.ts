/**
 * Pure helpers for rolling back optimistic mutations on failure (F4 CP3, DECISIONS D4).
 * No React/store imports (mirrors coach.ts / latency.ts pattern) — exercised directly by
 * optimistic.test.ts and consumed by store/mail.ts's per-action catch blocks.
 *
 * Invariant: rollback only ever touches the single entity the failed action mutated —
 * never a full-store snapshot restore (see DECISIONS D4).
 */
import type { ThreadSummary } from '../../shared/types';

/** A removed thread plus the index it occupied, captured before an optimistic removal. */
export interface RemovalCapture {
  thread: ThreadSummary;
  index: number;
}

/** Captures the thread with `id` and its index in `threads`, or null if not present. */
export function captureRemoval(threads: ThreadSummary[], id: string): RemovalCapture | null {
  const index = threads.findIndex((t) => t.id === id);
  if (index < 0) return null;
  return { thread: threads[index], index };
}

/**
 * Re-inserts `capture.thread` at `capture.index` (pushed to the end if the index now
 * exceeds the array length). Guarded: if a thread with the same id is already present
 * (e.g. a refresh raced ahead, or reinsert was already called), `threads` is returned
 * unchanged.
 */
export function reinsert(threads: ThreadSummary[], capture: RemovalCapture): ThreadSummary[] {
  if (threads.some((t) => t.id === capture.thread.id)) return threads;
  const next = threads.slice();
  const index = Math.min(capture.index, next.length);
  next.splice(index, 0, capture.thread);
  return next;
}

/** Sets the `unread` field of thread `id` to `unread` (idempotent). Other threads untouched. */
export function toggleUnread(threads: ThreadSummary[], id: string, unread: boolean): ThreadSummary[] {
  return threads.map((t) =>
    t.id === id
      ? {
          ...t,
          unread,
          labelIds: unread
            ? t.labelIds.includes('UNREAD')
              ? t.labelIds
              : [...t.labelIds, 'UNREAD']
            : t.labelIds.filter((l) => l !== 'UNREAD'),
        }
      : t
  );
}

/** Removes one occurrence of `labelId` from thread `id`'s labelIds (no-op if absent). */
export function removeLabelId(threads: ThreadSummary[], id: string, labelId: string): ThreadSummary[] {
  return threads.map((t) =>
    t.id === id && t.labelIds.includes(labelId)
      ? { ...t, labelIds: t.labelIds.filter((l) => l !== labelId) }
      : t
  );
}
