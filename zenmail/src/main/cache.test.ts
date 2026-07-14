import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountCache, mergeLabelIds } from './cache';

// DB-level cache tests used to be impossible here: cache.ts's openCache() was a module-level
// singleton that called electron's `app.getPath('userData')`, unavailable outside a running
// Electron main process (the 'electron' package resolves to a binary path string, not the app
// object, under vitest/node). AccountCache is now path-injected (`new AccountCache(dbFile)`),
// which resolves this — DB-level behavior is unit-tested below alongside pure mergeLabelIds.

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

describe('AccountCache — per-account isolation', () => {
  let dir: string;
  let a: AccountCache;
  let b: AccountCache;
  const t = (id: string, from = 'x@a.io'): import('../shared/types').ThreadSummary => ({
    id, subject: `s-${id}`, from: { name: from, email: from }, snippet: '',
    date: 1, unread: false, labelIds: ['INBOX'], messageCount: 1,
  });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zm-cache-'));
    a = new AccountCache(path.join(dir, 'a.db'));
    b = new AccountCache(path.join(dir, 'b.db'));
  });
  afterEach(() => {
    a.close(); b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('threads written to one cache are invisible to the other', () => {
    a.upsertThreads([t('t1')]);
    expect(a.getThreads('INBOX').map((x) => x.id)).toEqual(['t1']);
    expect(b.getThreads('INBOX')).toEqual([]);
  });

  it('contacts/search stay scoped per cache (TC-MA-C1 unit twin)', () => {
    a.upsertThreads([t('t1', 'only-in-a@a.io')]);
    expect(a.listContacts('only-in-a')).toHaveLength(1);
    expect(b.listContacts('only-in-a')).toEqual([]);
    expect(b.searchLocal('s-t1')).toEqual([]);
  });

  it('localDeltaSince is per-instance state', () => {
    a.upsertThreads([t('t1')]);
    b.upsertThreads([t('t1')]);
    a.applyLabelDelta('t1', [], ['INBOX']);
    expect(a.localDeltaSince('t1', 0)).toBe(true);
    expect(b.localDeltaSince('t1', 0)).toBe(false);
  });

  it('applyLabelDelta + settings round-trip on a real db file', () => {
    a.upsertThreads([t('t1')]);
    a.applyLabelDelta('t1', ['UNREAD'], []);
    expect(a.getThreadSummary('t1')!.unread).toBe(true);
    a.setSetting('k', 'v');
    expect(a.getSetting('k')).toBe('v');
  });
});
