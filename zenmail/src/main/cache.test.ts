import { describe, expect, it } from 'vitest';
import { mergeLabelIds } from './cache';

// DB-level cache tests (getThreads/getCachedThreadDetail/applyLabelDelta/mutations CRUD) are
// intentionally NOT unit-tested here: cache.ts's openCache() is a module-level singleton that
// calls electron's `app.getPath('userData')`, which is unavailable outside a running Electron
// main process (the 'electron' package resolves to a binary path string, not the app object,
// under vitest/node). Refactoring openCache to accept an injectable db path/handle would be a
// non-trivial change beyond CP1 scope, so only the pure label_ids merge logic is unit-tested
// here; DB-level behavior is left to E2E per the CP1 instructions.

describe('mergeLabelIds — idempotent add/remove of the threads.label_ids cache column', () => {
  it('adds a new label without duplicating existing ones', () => {
    expect(mergeLabelIds(['INBOX'], ['UNREAD'], [])).toEqual(['INBOX', 'UNREAD']);
  });

  it('is idempotent when adding a label already present', () => {
    expect(mergeLabelIds(['INBOX', 'UNREAD'], ['UNREAD'], [])).toEqual(['INBOX', 'UNREAD']);
  });

  it('removes a label that is present', () => {
    expect(mergeLabelIds(['INBOX', 'UNREAD'], [], ['UNREAD'])).toEqual(['INBOX']);
  });

  it('is a no-op when removing a label that is not present', () => {
    expect(mergeLabelIds(['INBOX'], [], ['UNREAD'])).toEqual(['INBOX']);
  });

  it('applies add and remove together (e.g. archive: -INBOX +ARCHIVE-ish label)', () => {
    expect(mergeLabelIds(['INBOX', 'UNREAD'], ['Label_done'], ['INBOX'])).toEqual([
      'UNREAD',
      'Label_done',
    ]);
  });

  it('when the same label id is in both add and remove, remove wins (label ends up absent)', () => {
    expect(mergeLabelIds(['INBOX'], ['UNREAD'], ['UNREAD'])).toEqual(['INBOX']);
  });

  it('handles empty current/add/remove without throwing', () => {
    expect(mergeLabelIds([], [], [])).toEqual([]);
    expect(mergeLabelIds([], ['INBOX'], [])).toEqual(['INBOX']);
  });
});
