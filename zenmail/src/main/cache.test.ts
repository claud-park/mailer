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

  // starred-view D3: getThreads('INBOX')는 이제 순수 INBOX라 STARRED-only 행을 배제해야 한다
  // (inbox-zero-starred 시절엔 이 케이스가 "포함"이었다 — 뒤집힌 회귀 케이스로 명시).
  it('getThreads(INBOX) excludes STARRED-only threads (no more INBOX∪STARRED union)', () => {
    a.upsertThreads([
      { ...t('t1'), labelIds: ['INBOX'] },
      { ...t('t2'), labelIds: ['STARRED'] },
    ]);
    expect(a.getThreads('INBOX').map((x) => x.id)).toEqual(['t1']);
  });

  it('getThreads(STARRED) returns STARRED threads regardless of INBOX membership', () => {
    a.upsertThreads([
      { ...t('t1'), labelIds: ['INBOX', 'STARRED'] }, // still in inbox, starred
      { ...t('t2'), labelIds: ['STARRED'] }, // archived-only, starred
      { ...t('t3'), labelIds: ['INBOX'] }, // not starred — must not appear
    ]);
    expect(new Set(a.getThreads('STARRED').map((x) => x.id))).toEqual(new Set(['t1', 't2']));
  });

  it('getThreads(STARRED) excludes TRASH/SPAM', () => {
    a.upsertThreads([
      { ...t('t1'), labelIds: ['STARRED', 'TRASH'] },
      { ...t('t2'), labelIds: ['STARRED', 'SPAM'] },
      { ...t('t3'), labelIds: ['STARRED'] },
    ]);
    expect(a.getThreads('STARRED').map((x) => x.id)).toEqual(['t3']);
  });

  it('getViewRows(STARRED) matches getThreads(STARRED) membership (SQL prefilter vs JS filter consistency)', () => {
    a.upsertThreads([
      { ...t('t1'), labelIds: ['INBOX', 'STARRED'] },
      { ...t('t2'), labelIds: ['STARRED'] },
      { ...t('t3'), labelIds: ['STARRED', 'TRASH'] },
    ]);
    expect(new Set(a.getViewRows('STARRED').map((r) => r.id))).toEqual(
      new Set(a.getThreads('STARRED').map((x) => x.id))
    );
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

describe('AccountCache — image_cache metadata', () => {
  let dir: string;
  let a: AccountCache;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zm-imgcache-'));
    a = new AccountCache(path.join(dir, 'a.db'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns null for a url hash that was never cached', () => {
    expect(a.getImageCache('deadbeef')).toBeNull();
  });

  it('round-trips a cached row', () => {
    a.setImageCache({ urlHash: 'h1', mimeType: 'image/png', byteSize: 1234, fetchedAt: 100 });
    expect(a.getImageCache('h1')).toEqual({ urlHash: 'h1', mimeType: 'image/png', byteSize: 1234, fetchedAt: 100 });
  });

  it('setImageCache upserts (re-fetching the same url updates fetchedAt)', () => {
    a.setImageCache({ urlHash: 'h1', mimeType: 'image/png', byteSize: 1234, fetchedAt: 100 });
    a.setImageCache({ urlHash: 'h1', mimeType: 'image/png', byteSize: 1234, fetchedAt: 200 });
    expect(a.getImageCache('h1')?.fetchedAt).toBe(200);
  });

  it('listImageCacheByAge returns oldest first', () => {
    a.setImageCache({ urlHash: 'newer', mimeType: 'image/png', byteSize: 10, fetchedAt: 300 });
    a.setImageCache({ urlHash: 'older', mimeType: 'image/png', byteSize: 10, fetchedAt: 100 });
    a.setImageCache({ urlHash: 'mid', mimeType: 'image/png', byteSize: 10, fetchedAt: 200 });
    expect(a.listImageCacheByAge().map((r) => r.urlHash)).toEqual(['older', 'mid', 'newer']);
  });

  it('deleteImageCache removes the row', () => {
    a.setImageCache({ urlHash: 'h1', mimeType: 'image/png', byteSize: 10, fetchedAt: 100 });
    a.deleteImageCache('h1');
    expect(a.getImageCache('h1')).toBeNull();
  });

  it('imageCacheTotalBytes sums byteSize across all rows', () => {
    a.setImageCache({ urlHash: 'h1', mimeType: 'image/png', byteSize: 1000, fetchedAt: 100 });
    a.setImageCache({ urlHash: 'h2', mimeType: 'image/jpeg', byteSize: 2000, fetchedAt: 200 });
    expect(a.imageCacheTotalBytes()).toBe(3000);
  });

  it('imageCacheTotalBytes is 0 for an empty cache', () => {
    expect(a.imageCacheTotalBytes()).toBe(0);
  });
});
