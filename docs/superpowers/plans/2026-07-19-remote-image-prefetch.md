# Remote Image Prefetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remote `https:`/`http:` inline email images load instantly when a thread is opened, without the user clicking "Load remote images" — via a local, SSRF-guarded background prefetch cache, with a Command Palette toggle to fall back to the existing click-gate.

**Architecture:** A new `src/main/image-cache.ts` module fetches and caches images (disk file + sqlite metadata) behind an SSRF allowlist guard. `snooze.ts`'s existing 60s daemon tick, at the point where it already detects newly-arrived unread mail (`diffNewUnread`), additionally fetches full thread detail (`getThread`) for those new threads and prefetches their remote images. `ThreadView.tsx` substitutes remote `<img src>` with cached `data:` URIs the same way it already does for `cid:` images, and the iframe CSP is tightened to `img-src data:` only — remote schemes never reach the iframe. A new `autoLoadRemoteImages` global boolean setting (Command Palette toggle, same pattern as `theme`) controls whether cache misses live-fetch automatically or fall back to the existing click-gate button.

**Tech Stack:** Electron 33 main process (Node 20 global `fetch`, `node:crypto`/`node:fs`/`node:dns`), better-sqlite3 (existing `AccountCache` per-account DB), React 19 renderer (existing `useMailStore` zustand pattern), vitest.

## Global Constraints

- No new npm dependencies (NFR1) — use Node/Electron built-ins only (`fetch`, `node:crypto`, `node:dns`, `node:fs`).
- No AI (NFR2) — every rule here is deterministic (URL allowlist, regex extraction, LRU eviction).
- SSRF guard is non-negotiable (NFR3) — every task touching network fetch must include the private/loopback/link-local IP block and per-redirect-hop re-validation.
- Toggle-off must be byte-for-byte equivalent to today's click-gate behavior (NFR4) — no regression to existing `TC-IMG-A1~A3`.
- Per-account disk cache capped at 200MB, LRU eviction (NFR5).
- Existing E2E canon (`run-tc.mjs` `CANON_SKIPS`: `TC-A4, TC-D5, TC-D8, TC-SY-C3, TC-SA-B4, TC-SY-B2, TC-UNDO-B1, TC-LBL-A5`) must stay 0 FAIL, SKIP set unchanged or a documented subset (NFR7).
- Every task: `npx tsc --noEmit` clean + `npm test` (vitest) green before commit.
- Breaking-change protocol (touching shared IPC/type contracts or renderer components): `/react-best-practices` + `/code-review low` before commit, then push.

---

### Task 1: `AccountCache` — `image_cache` table + CRUD/prune methods

**Files:**
- Modify: `zenmail/src/main/cache.ts` (add table to constructor's `CREATE TABLE` block, add methods to `AccountCache` class)
- Test: `zenmail/src/main/cache.test.ts` (add new `describe` block)

**Interfaces:**
- Produces (used by Task 3 `image-cache.ts`):
  ```ts
  interface ImageCacheRow { urlHash: string; mimeType: string; byteSize: number; fetchedAt: number }
  class AccountCache {
    getImageCache(urlHash: string): ImageCacheRow | null;
    setImageCache(row: ImageCacheRow): void;
    listImageCacheByAge(): ImageCacheRow[]; // ascending fetchedAt (oldest first)
    deleteImageCache(urlHash: string): void;
    imageCacheTotalBytes(): number;
  }
  ```

- [ ] **Step 1: Write the failing tests**

Add to `zenmail/src/main/cache.test.ts` (after the existing `AccountCache — per-account isolation` describe block, reusing its `beforeEach`/`afterEach` `dir`/`a`/`b` setup):

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd zenmail && npx vitest run src/main/cache.test.ts`
Expected: FAIL — `TypeError: a.getImageCache is not a function` (or similar, method doesn't exist yet).

- [ ] **Step 3: Add the table and methods**

In `zenmail/src/main/cache.ts`, inside the constructor's `this.db.exec(...)` template string (after the `mutations` table, before the closing `` ` ``), add:

```sql
      CREATE TABLE IF NOT EXISTS image_cache (
        url_hash TEXT PRIMARY KEY,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        fetched_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_image_cache_fetched_at ON image_cache(fetched_at);
```

Then add these methods to the `AccountCache` class (near `getSetting`/`setSetting`, ~line 521):

```ts
  getImageCache(urlHash: string): { urlHash: string; mimeType: string; byteSize: number; fetchedAt: number } | null {
    const row = this.db
      .prepare('SELECT url_hash, mime_type, byte_size, fetched_at FROM image_cache WHERE url_hash = ?')
      .get(urlHash) as { url_hash: string; mime_type: string; byte_size: number; fetched_at: number } | undefined;
    if (!row) return null;
    return { urlHash: row.url_hash, mimeType: row.mime_type, byteSize: row.byte_size, fetchedAt: row.fetched_at };
  }

  setImageCache(row: { urlHash: string; mimeType: string; byteSize: number; fetchedAt: number }): void {
    this.db
      .prepare(
        `INSERT INTO image_cache (url_hash, mime_type, byte_size, fetched_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(url_hash) DO UPDATE SET mime_type = excluded.mime_type, byte_size = excluded.byte_size, fetched_at = excluded.fetched_at`
      )
      .run(row.urlHash, row.mimeType, row.byteSize, row.fetchedAt);
  }

  listImageCacheByAge(): Array<{ urlHash: string; mimeType: string; byteSize: number; fetchedAt: number }> {
    const rows = this.db
      .prepare('SELECT url_hash, mime_type, byte_size, fetched_at FROM image_cache ORDER BY fetched_at ASC')
      .all() as Array<{ url_hash: string; mime_type: string; byte_size: number; fetched_at: number }>;
    return rows.map((r) => ({ urlHash: r.url_hash, mimeType: r.mime_type, byteSize: r.byte_size, fetchedAt: r.fetched_at }));
  }

  deleteImageCache(urlHash: string): void {
    this.db.prepare('DELETE FROM image_cache WHERE url_hash = ?').run(urlHash);
  }

  imageCacheTotalBytes(): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(byte_size), 0) AS total FROM image_cache').get() as { total: number };
    return row.total;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd zenmail && npx vitest run src/main/cache.test.ts`
Expected: PASS, all `image_cache` tests + pre-existing tests green.

- [ ] **Step 5: Typecheck and commit**

Run: `cd zenmail && npx tsc --noEmit`
Expected: clean.

```bash
cd /Users/claud_01/Documents/flo/AX/mailer
git add zenmail/src/main/cache.ts zenmail/src/main/cache.test.ts
git commit -m "feat(remote-image-prefetch): image_cache table + AccountCache CRUD/prune methods (CP1a)"
```

---

### Task 2: `accounts.ts` — `imageCacheDir(email)` path helper

**Files:**
- Modify: `zenmail/src/main/accounts.ts`
- Test: `zenmail/src/main/accounts.test.ts` (check if this file exists; if not, create it — grep first)

**Interfaces:**
- Produces (used by Task 3):
  ```ts
  export function imageCacheDir(email: string): string; // userData/image-cache/<emailSlug>
  ```

- [ ] **Step 1: Check for an existing accounts.ts test file**

Run: `cd zenmail && ls src/main/accounts.test.ts 2>&1`

If it exists, read it first to match its existing `__setUserDataDirForTests` usage pattern before writing Step 2. If it doesn't exist, Step 2 creates a new minimal file.

- [ ] **Step 2: Write the failing test**

Add to `zenmail/src/main/accounts.test.ts` (create the file with this content if it doesn't exist, otherwise append the `describe` block):

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { imageCacheDir, emailSlug, __setUserDataDirForTests } from './accounts';

describe('imageCacheDir', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zm-accounts-'));
    __setUserDataDirForTests(dir);
  });
  afterEach(() => {
    __setUserDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('returns userData/image-cache/<emailSlug>', () => {
    expect(imageCacheDir('a@b.com')).toBe(path.join(dir, 'image-cache', emailSlug('a@b.com')));
  });

  it('slugifies unsafe characters the same way emailSlug does', () => {
    expect(imageCacheDir('a+tag@b.com')).toBe(path.join(dir, 'image-cache', 'a_tag@b.com'));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd zenmail && npx vitest run src/main/accounts.test.ts`
Expected: FAIL — `imageCacheDir is not exported` / `is not a function`.

- [ ] **Step 4: Implement `imageCacheDir`**

In `zenmail/src/main/accounts.ts`, after `accountDbPath` (line 33), add:

```ts
export function imageCacheDir(email: string): string {
  return path.join(userDataDir(), 'image-cache', emailSlug(email));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd zenmail && npx vitest run src/main/accounts.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
cd /Users/claud_01/Documents/flo/AX/mailer
git add zenmail/src/main/accounts.ts zenmail/src/main/accounts.test.ts
git commit -m "feat(remote-image-prefetch): imageCacheDir path helper (CP1b)"
```

---

### Task 3: `image-cache.ts` — SSRF guard (pure logic, no network)

**Files:**
- Create: `zenmail/src/main/image-cache.ts`
- Test: `zenmail/src/main/image-cache.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure function, no I/O).
- Produces (used by Task 4):
  ```ts
  export function isPrefetchableUrl(url: string): boolean;
  export function extractRemoteImageUrls(html: string): string[];
  ```

This task is pure logic only — no network fetch, no disk I/O, no sqlite. Network fetch is Task 4.

- [ ] **Step 1: Write the failing tests**

Create `zenmail/src/main/image-cache.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isPrefetchableUrl, extractRemoteImageUrls } from './image-cache';

describe('isPrefetchableUrl', () => {
  it('allows a public https URL', () => {
    expect(isPrefetchableUrl('https://example.com/logo.png')).toBe(true);
  });

  it('allows a public http URL', () => {
    expect(isPrefetchableUrl('http://example.com/logo.png')).toBe(true);
  });

  it('rejects non-http(s) schemes', () => {
    expect(isPrefetchableUrl('ftp://example.com/x.png')).toBe(false);
    expect(isPrefetchableUrl('file:///etc/passwd')).toBe(false);
    expect(isPrefetchableUrl('cid:logo@zenmail')).toBe(false);
  });

  it('rejects loopback IP literals', () => {
    expect(isPrefetchableUrl('http://127.0.0.1/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://127.5.5.5/x.png')).toBe(false);
  });

  it('rejects RFC1918 private ranges', () => {
    expect(isPrefetchableUrl('http://10.0.0.5/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://172.16.0.1/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://172.31.255.255/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://192.168.1.1/x.png')).toBe(false);
  });

  it('allows 172.x outside the 16-31 private range', () => {
    expect(isPrefetchableUrl('http://172.32.0.1/x.png')).toBe(true);
    expect(isPrefetchableUrl('http://172.15.255.255/x.png')).toBe(true);
  });

  it('rejects link-local (169.254.0.0/16, incl. cloud metadata 169.254.169.254)', () => {
    expect(isPrefetchableUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isPrefetchableUrl('http://169.254.1.1/x.png')).toBe(false);
  });

  it('rejects IPv6 loopback and unique-local', () => {
    expect(isPrefetchableUrl('http://[::1]/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://[fc00::1]/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://[fe80::1]/x.png')).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(isPrefetchableUrl('not a url')).toBe(false);
  });
});

describe('extractRemoteImageUrls', () => {
  it('extracts a single https img src', () => {
    expect(extractRemoteImageUrls('<img src="https://example.com/a.png">')).toEqual([
      'https://example.com/a.png',
    ]);
  });

  it('extracts multiple img srcs, ignoring cid: and data:', () => {
    const html = `
      <img src="https://example.com/a.png">
      <img src="cid:logo@zenmail">
      <img src='http://example.com/b.jpg'>
      <img src="data:image/png;base64,abc">
    `;
    expect(extractRemoteImageUrls(html)).toEqual([
      'https://example.com/a.png',
      'http://example.com/b.jpg',
    ]);
  });

  it('returns an empty array when there are no remote images', () => {
    expect(extractRemoteImageUrls('<p>no images here</p>')).toEqual([]);
  });

  it('dedupes repeated URLs', () => {
    const html = '<img src="https://example.com/a.png"><img src="https://example.com/a.png">';
    expect(extractRemoteImageUrls(html)).toEqual(['https://example.com/a.png']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd zenmail && npx vitest run src/main/image-cache.test.ts`
Expected: FAIL — `Cannot find module './image-cache'`.

- [ ] **Step 3: Implement the SSRF guard and URL extraction**

Create `zenmail/src/main/image-cache.ts`:

```ts
// SSRF 가드 + 원격 이미지 URL 추출 — 순수 로직(네트워크/디스크는 Task 4 이후).
// 자동 프리페치는 사용자 클릭 없이 도착하는 모든 메일에 대해 발화되므로, 스킴/사설망 차단이
// 이 feature의 필수 방어선이다(DECISIONS.md D9).

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isPrivateIPv4(host: string): boolean {
  const m = host.match(IPV4_RE);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local, cloud metadata)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1') return true; // loopback
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 unique-local
  if (h.startsWith('fe80')) return true; // fe80::/10 link-local
  return false;
}

/** http(s) 스킴 + 사설/루프백/링크-로컬 IP 차단. 리다이렉트 매 hop마다 재호출해야 한다(D9). */
export function isPrefetchableUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  let host = parsed.hostname;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1); // IPv6 literal in brackets
  if (host.includes(':')) return !isPrivateIPv6(host); // IPv6 literal
  if (IPV4_RE.test(host)) return !isPrivateIPv4(host); // IPv4 literal
  if (host === 'localhost') return false;
  return true; // DNS hostname — resolved + re-checked at fetch time (Task 4)
}

const IMG_SRC_RE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;

/** bodyHtml에서 원격(https?:) img src만 추출, 순서 보존 + 중복 제거. main엔 DOMParser가 없어 정규식 사용. */
export function extractRemoteImageUrls(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  let match: RegExpExecArray | null;
  IMG_SRC_RE.lastIndex = 0;
  while ((match = IMG_SRC_RE.exec(html))) {
    const src = match[1];
    if (!/^https?:/i.test(src)) continue;
    if (seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd zenmail && npx vitest run src/main/image-cache.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Typecheck and commit**

```bash
cd /Users/claud_01/Documents/flo/AX/mailer
git add zenmail/src/main/image-cache.ts zenmail/src/main/image-cache.test.ts
git commit -m "feat(remote-image-prefetch): SSRF guard + remote img URL extraction (CP1c, pure logic)"
```

---

### Task 4: `image-cache.ts` — live fetch + disk cache + `getCachedOrFetch`/`prefetch`/`pruneCache`

**Files:**
- Modify: `zenmail/src/main/image-cache.ts`
- Modify: `zenmail/src/main/image-cache.test.ts`

**Interfaces:**
- Consumes: `AccountCache` (Task 1: `getImageCache`/`setImageCache`/`listImageCacheByAge`/`deleteImageCache`/`imageCacheTotalBytes`), `imageCacheDir` (Task 2), `isPrefetchableUrl`/`extractRemoteImageUrls` (Task 3).
- Produces (used by Task 5 IPC handler and Task 6 snooze.ts hook):
  ```ts
  export async function getCachedOrFetch(
    cache: AccountCache,
    cacheDir: string,
    url: string,
    opts: { fetchLive: boolean }
  ): Promise<{ dataUri: string; mimeType: string } | { error: string }>;

  export async function prefetch(cache: AccountCache, cacheDir: string, urls: string[]): Promise<void>;

  export function pruneCache(cache: AccountCache, cacheDir: string, maxBytes: number): void;
  ```

This task uses real `fetch()` against a local test HTTP server (`node:http`) spun up in the test file — no mocking of `fetch` itself, so the SSRF guard and redirect-revalidation are exercised for real.

- [ ] **Step 1: Write the failing tests**

Append to `zenmail/src/main/image-cache.test.ts`:

```ts
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountCache } from './cache';
import { getCachedOrFetch, prefetch, pruneCache } from './image-cache';

describe('getCachedOrFetch / prefetch / pruneCache', () => {
  let dir: string;
  let cacheDir: string;
  let cache: AccountCache;
  let server: http.Server;
  let baseUrl: string;
  let requestCount = 0;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zm-imgfetch-'));
    cacheDir = path.join(dir, 'cache');
    cache = new AccountCache(path.join(dir, 'a.db'));
    requestCount = 0;
    server = http.createServer((req, res) => {
      requestCount++;
      if (req.url === '/ok.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(Buffer.from('fake-png-bytes'));
      } else if (req.url === '/redirect-to-private') {
        res.writeHead(302, { Location: 'http://127.0.0.1:1/evil.png' });
        res.end();
      } else if (req.url === '/not-an-image') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html></html>');
      } else if (req.url === '/too-big') {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(6 * 1024 * 1024) });
        res.end(Buffer.alloc(6 * 1024 * 1024));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('cache miss + fetchLive:true fetches live, writes disk file + sqlite row, returns data URI', async () => {
    // NOTE: baseUrl is 127.0.0.1 (loopback) — isPrefetchableUrl would normally reject this.
    // This test targets getCachedOrFetch directly to exercise the fetch/cache-write path in
    // isolation; SSRF rejection of loopback is already covered by Task 3's isPrefetchableUrl
    // tests and by the /redirect-to-private case below (which must be blocked even though the
    // *initial* request in that case is not to loopback).
    const res = await getCachedOrFetch(cache, cacheDir, `${baseUrl}/ok.png`, { fetchLive: true });
    expect('dataUri' in res).toBe(true);
    if ('dataUri' in res) {
      expect(res.mimeType).toBe('image/png');
      expect(res.dataUri.startsWith('data:image/png;base64,')).toBe(true);
    }
    const urlHash = require('node:crypto').createHash('sha256').update(`${baseUrl}/ok.png`).digest('hex');
    expect(cache.getImageCache(urlHash)).not.toBeNull();
    expect(fs.existsSync(path.join(cacheDir, urlHash))).toBe(true);
  });

  it('cache hit reads from disk without a second network request', async () => {
    await getCachedOrFetch(cache, cacheDir, `${baseUrl}/ok.png`, { fetchLive: true });
    const countAfterFirst = requestCount;
    const res = await getCachedOrFetch(cache, cacheDir, `${baseUrl}/ok.png`, { fetchLive: false });
    expect('dataUri' in res).toBe(true);
    expect(requestCount).toBe(countAfterFirst); // no new request
  });

  it('cache miss + fetchLive:false returns an error without fetching', async () => {
    const res = await getCachedOrFetch(cache, cacheDir, `${baseUrl}/ok.png`, { fetchLive: false });
    expect('error' in res).toBe(true);
    expect(requestCount).toBe(0);
  });

  it('rejects a redirect that points to a private IP, even mid-chain', async () => {
    const res = await getCachedOrFetch(cache, cacheDir, `${baseUrl}/redirect-to-private`, { fetchLive: true });
    expect('error' in res).toBe(true);
  });

  it('rejects a non-image content-type', async () => {
    const res = await getCachedOrFetch(cache, cacheDir, `${baseUrl}/not-an-image`, { fetchLive: true });
    expect('error' in res).toBe(true);
  });

  it('rejects a response over 5MB', async () => {
    const res = await getCachedOrFetch(cache, cacheDir, `${baseUrl}/too-big`, { fetchLive: true });
    expect('error' in res).toBe(true);
  });

  it('prefetch fetches multiple urls in parallel and swallows individual failures', async () => {
    await prefetch(cache, cacheDir, [`${baseUrl}/ok.png`, `${baseUrl}/does-not-exist`]);
    const urlHash = require('node:crypto').createHash('sha256').update(`${baseUrl}/ok.png`).digest('hex');
    expect(cache.getImageCache(urlHash)).not.toBeNull();
    // no throw for the 404 — swallowed
  });

  it('pruneCache deletes oldest entries until under maxBytes', () => {
    cache.setImageCache({ urlHash: 'old', mimeType: 'image/png', byteSize: 100, fetchedAt: 100 });
    cache.setImageCache({ urlHash: 'mid', mimeType: 'image/png', byteSize: 100, fetchedAt: 200 });
    cache.setImageCache({ urlHash: 'new', mimeType: 'image/png', byteSize: 100, fetchedAt: 300 });
    fs.mkdirSync(cacheDir, { recursive: true });
    for (const h of ['old', 'mid', 'new']) fs.writeFileSync(path.join(cacheDir, h), 'x');

    pruneCache(cache, cacheDir, 150); // only room for ~1.5 entries worth

    expect(cache.getImageCache('old')).toBeNull();
    expect(fs.existsSync(path.join(cacheDir, 'old'))).toBe(false);
    expect(cache.getImageCache('new')).not.toBeNull(); // newest survives
  });

  it('pruneCache is a no-op when total is already under maxBytes', () => {
    cache.setImageCache({ urlHash: 'a', mimeType: 'image/png', byteSize: 10, fetchedAt: 100 });
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'a'), 'x');
    pruneCache(cache, cacheDir, 1000);
    expect(cache.getImageCache('a')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd zenmail && npx vitest run src/main/image-cache.test.ts`
Expected: FAIL — `getCachedOrFetch`/`prefetch`/`pruneCache` not exported.

- [ ] **Step 3: Implement fetch + cache + prune**

Append to `zenmail/src/main/image-cache.ts`:

```ts
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AccountCache } from './cache';

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

function urlHashOf(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex');
}

function readCachedFile(cacheDir: string, urlHash: string): Buffer | null {
  try {
    return fs.readFileSync(path.join(cacheDir, urlHash));
  } catch {
    return null;
  }
}

function writeCachedFile(cacheDir: string, urlHash: string, data: Buffer): void {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, urlHash), data);
}

/**
 * 리다이렉트를 수동으로 따라가며 매 hop마다 isPrefetchableUrl을 재적용한다(D9) — fetch의
 * redirect:'follow'는 최종 URL만 알 수 있어 중간 hop의 사설망 우회를 막을 수 없다.
 */
async function fetchImageBytes(url: string): Promise<{ buf: Buffer; mimeType: string } | { error: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isPrefetchableUrl(current)) return { error: 'blocked: not a prefetchable url' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(current, { redirect: 'manual', signal: controller.signal });
    } catch (err) {
      return { error: `fetch failed: ${String(err)}` };
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { error: 'redirect without location' };
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) return { error: `http ${res.status}` };
    const mimeType = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!mimeType.startsWith('image/')) return { error: `non-image content-type: ${mimeType}` };
    const contentLength = res.headers.get('content-length');
    if (contentLength && Number(contentLength) > MAX_BYTES) return { error: 'response too large' };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return { error: 'response too large' };
    return { buf, mimeType };
  }
  return { error: 'too many redirects' };
}

export async function getCachedOrFetch(
  cache: AccountCache,
  cacheDir: string,
  url: string,
  opts: { fetchLive: boolean }
): Promise<{ dataUri: string; mimeType: string } | { error: string }> {
  const urlHash = urlHashOf(url);
  const meta = cache.getImageCache(urlHash);
  if (meta) {
    const buf = readCachedFile(cacheDir, urlHash);
    if (buf) return { dataUri: `data:${meta.mimeType};base64,${buf.toString('base64')}`, mimeType: meta.mimeType };
    cache.deleteImageCache(urlHash); // metadata orphaned (file missing) — fall through to re-fetch
  }
  if (!opts.fetchLive) return { error: 'not cached' };

  const result = await fetchImageBytes(url);
  if ('error' in result) return result;
  writeCachedFile(cacheDir, urlHash, result.buf);
  cache.setImageCache({ urlHash, mimeType: result.mimeType, byteSize: result.buf.byteLength, fetchedAt: Date.now() });
  return { dataUri: `data:${result.mimeType};base64,${result.buf.toString('base64')}`, mimeType: result.mimeType };
}

/** 여러 URL을 병렬 프리페치. 개별 실패는 조용히 스킵(throw 없음) — 콘솔 로그만. */
export async function prefetch(cache: AccountCache, cacheDir: string, urls: string[]): Promise<void> {
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await getCachedOrFetch(cache, cacheDir, url, { fetchLive: true });
        if ('error' in res) console.warn('[image-cache] prefetch skipped', url, res.error);
      } catch (err) {
        console.warn('[image-cache] prefetch failed', url, err);
      }
    })
  );
}

/** 총 용량이 maxBytes를 넘으면 fetched_at 오름차순(가장 오래된 것부터)으로 삭제한다. */
export function pruneCache(cache: AccountCache, cacheDir: string, maxBytes: number): void {
  let total = cache.imageCacheTotalBytes();
  if (total <= maxBytes) return;
  for (const row of cache.listImageCacheByAge()) {
    if (total <= maxBytes) break;
    cache.deleteImageCache(row.urlHash);
    try {
      fs.unlinkSync(path.join(cacheDir, row.urlHash));
    } catch {
      /* file already gone — metadata cleanup still counts */
    }
    total -= row.byteSize;
  }
}
```

Add `AccountCache` to the existing type-only import at the top of `image-cache.ts` if not already present from Step 3 of Task 3 (it wasn't needed there — add the `import type { AccountCache } from './cache';` line shown above alongside the `crypto`/`fs`/`path` imports).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd zenmail && npx vitest run src/main/image-cache.test.ts`
Expected: PASS, all cases including redirect-to-private rejection, size/type limits, and LRU prune.

- [ ] **Step 5: Typecheck and commit**

```bash
cd /Users/claud_01/Documents/flo/AX/mailer
git add zenmail/src/main/image-cache.ts zenmail/src/main/image-cache.test.ts
git commit -m "feat(remote-image-prefetch): live fetch + disk cache + LRU prune (CP1d)"
```

This completes CP1 (TODO.md). Update `docs/features/remote-image-prefetch/TODO.md` CP1 checkboxes to `[x]` as part of this commit (`git add` the TODO file too).

---

### Task 5: IPC contract — `mail:get-remote-image` + `autoLoadRemoteImages` global setting plumbing

**Files:**
- Modify: `zenmail/src/shared/types.ts` (`ZenmailApi.getRemoteImage`)
- Modify: `zenmail/src/main/ipc.ts` (handler + E2E debug hook)
- Modify: `zenmail/src/main/preload.ts` (expose method)
- Test: `zenmail/src/main/ipc.test.ts` (check if it exists; if not, this task's IPC wiring is exercised indirectly by the CP2 E2E TC — skip a dedicated ipc.test.ts and rely on `tsc`/existing IPC test conventions; grep first to confirm)

**Interfaces:**
- Consumes: `getCachedOrFetch` (Task 4), `AccountContext` (existing, has `.cache: AccountCache`, `.email: string`), `imageCacheDir` (Task 2).
- Produces (used by Task 7 renderer store):
  ```ts
  // ZenmailApi addition
  getRemoteImage(accountId: string, url: string): Promise<{ dataUri: string; mimeType: string } | { error: string }>;
  ```

`autoLoadRemoteImages` itself needs **no new IPC channel** — it reuses the existing `settings:get-global`/`settings:set-global` channels (same as `theme`), wired entirely in Task 7 (renderer store). This task only adds `getRemoteImage`.

- [ ] **Step 1: Check for an ipc.test.ts convention**

Run: `cd zenmail && ls src/main/ipc.test.ts 2>&1`

If present, read its structure to match. If absent (likely — IPC wiring is typically exercised via E2E, not vitest, in this codebase per the attachments precedent), skip straight to Step 2 (no new vitest file for this task; typecheck + E2E in Task 10 cover it).

- [ ] **Step 2: Add the type**

In `zenmail/src/shared/types.ts`, inside the `ZenmailApi` interface, near `getAttachmentImage` (~line 246), add:

```ts
  getRemoteImage(accountId: string, url: string): Promise<{ dataUri: string; mimeType: string } | { error: string }>;
```

- [ ] **Step 3: Add the IPC handler**

In `zenmail/src/main/ipc.ts`, near the `// --- attachments ---` block (~line 745), add a new section:

```ts
  // --- remote image prefetch cache ---

  ipcMain.handle(
    'mail:get-remote-image',
    async (_e, accountId: string, url: string): Promise<{ dataUri: string; mimeType: string } | { error: string }> => {
      try {
        const fetchLive = (accounts.getGlobalSetting('autoLoadRemoteImages') ?? 'true') !== 'false';
        const ctx = requireContext(accountId);
        return await getCachedOrFetch(ctx.cache, imageCacheDirOverride ?? imageCacheDir(accountId), url, { fetchLive });
      } catch (err) {
        console.error('[image-cache] get-remote-image failed', err);
        return { error: String(err) };
      }
    }
  );
```

Add the needed imports at the top of `ipc.ts`:

```ts
import { getCachedOrFetch } from './image-cache';
import { imageCacheDir } from './accounts';
```

(`accounts` is very likely already imported as a namespace in `ipc.ts` for `getGlobalSetting`/`setGlobalSetting` — grep `from './accounts'` in `ipc.ts` first and reuse the existing import statement rather than adding a duplicate.)

Add the E2E-only override (mirrors `downloadDirOverride` at line ~76-78) near the top of `ipc.ts`:

```ts
let imageCacheDirOverride: string | null = null;
```

And inside the existing `if (process.env.ZENMAIL_E2E_PORT) { ... }` debug block (~line 790), add:

```ts
    ipcMain.handle('mail:debug-set-image-cache-dir', async (_e, dir: string) => {
      imageCacheDirOverride = dir;
    });
```

- [ ] **Step 4: Expose in preload**

In `zenmail/src/main/preload.ts`, near `getAttachmentImage` (~line 46), add:

```ts
  getRemoteImage: (accountId: string, url: string) => ipcRenderer.invoke('mail:get-remote-image', accountId, url),
```

- [ ] **Step 5: Typecheck**

Run: `cd zenmail && npx tsc --noEmit`
Expected: clean. If `requireContext(accountId).cache` doesn't expose the right type for `getCachedOrFetch`'s first param, adjust the import/type — `AccountContext.cache` is already typed as `AccountCache` elsewhere in `ipc.ts` (used throughout `snooze.ts`/other handlers), so this should just work.

- [ ] **Step 6: Run full vitest suite (regression check)**

Run: `cd zenmail && npm test`
Expected: all existing tests still pass (this task only adds code paths, doesn't modify existing behavior).

- [ ] **Step 7: Commit**

```bash
cd /Users/claud_01/Documents/flo/AX/mailer
git add zenmail/src/shared/types.ts zenmail/src/main/ipc.ts zenmail/src/main/preload.ts
git commit -m "feat(remote-image-prefetch): mail:get-remote-image IPC contract + E2E cache-dir override (CP2a)"
```

---

### Task 6: `snooze.ts` — prefetch hook on new-unread detection

**Files:**
- Modify: `zenmail/src/main/snooze.ts`
- Test: `zenmail/src/main/snooze.test.ts` (check if it exists — grep first; if it does, follow its mocking pattern for `AccountContext`/provider)

**Interfaces:**
- Consumes: `prefetch` (Task 4), `extractRemoteImageUrls` (Task 3), `imageCacheDir` (Task 2), `ctx.provider.getThread(threadId): Promise<ThreadDetail>` (existing, `ThreadDetail.messages[].bodyHtml: string`).
- Produces: no new exports — behavioral change only (existing `tickAccount`/daemon tick now also prefetches).

- [ ] **Step 1: Check for an existing snooze.test.ts**

Run: `cd zenmail && ls src/main/snooze.test.ts 2>&1`

Read it if present to match the existing mock-provider/mock-context pattern used for `tickAccount`/daemon tests before writing Step 2's test.

- [ ] **Step 2: Write the failing test**

Add a test (matching whatever mock-provider scaffolding `snooze.test.ts` already uses — if the file doesn't exist yet, this step instead becomes: add a minimal new `snooze.test.ts` that constructs a mock `AccountContext` with a stub `provider.getThread` and `provider.listThreads`/`inboxUnreadCount`, following the exact same shape `MockGmailProvider` uses elsewhere in the codebase). The behavior under test:

```ts
it('prefetches remote images from newly-detected unread threads', async () => {
  // Arrange: a provider whose inboxUnreadCount rises from 0 to 1, listThreads returns one new
  // ThreadSummary, and getThread(that id) returns a ThreadDetail with a message whose bodyHtml
  // contains a remote <img src="https://example.com/logo.png">.
  // Act: run one daemon tick (via runDaemonTickNow() after startSnoozeDaemon, or by calling the
  // tick function directly if snooze.test.ts already exports/imports it for testing).
  // Assert: image-cache's prefetch was called with ['https://example.com/logo.png'] for that
  // account (spy on the `prefetch` export via vi.mock('./image-cache', ...) or, if snooze.test.ts's
  // existing convention avoids mocking, assert the resulting sqlite image_cache row exists after
  // the tick using a local http test server the same way Task 4 did).
});
```

Because this test's exact shape depends on `snooze.test.ts`'s pre-existing mocking conventions (which must be read in Step 1 before writing real code here — this plan cannot show fabricated mock scaffolding that might not match), the implementer must adapt the Arrange/Act/Assert above to the file's actual patterns. Prefer `vi.mock('./image-cache')` with a spy on `prefetch` if the existing file already mocks sibling modules that way; otherwise use a real local `http` server (Task 4's pattern) and assert against real `AccountCache.getImageCache`.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd zenmail && npx vitest run src/main/snooze.test.ts`
Expected: FAIL (prefetch never called / no image_cache row).

- [ ] **Step 4: Implement the hook**

In `zenmail/src/main/snooze.ts`, inside the `tick` function's badge loop, right after the `newThreads.length` check (~line 65, after `if (newThreads.length) perAccountNew.push(...)`), add:

```ts
                if (newThreads.length) {
                  void prefetchNewThreadImages(ctx, newThreads).catch((err) =>
                    console.error('[daemon] image prefetch failed', ctx.email, err)
                  );
                }
```

Add the import at the top of `snooze.ts`:

```ts
import { prefetch, extractRemoteImageUrls } from './image-cache';
import { imageCacheDir } from './accounts';
```

Add the helper function near the bottom of `snooze.ts` (before `stopSnoozeDaemon`):

```ts
/**
 * new-mail-alerts D8 훅 재사용 + D6 정정: listThreads(ThreadSummary[])엔 bodyHtml이 없으므로
 * 신규 스레드마다 getThread를 추가 호출해 bodyHtml을 확보하고, 그 안의 원격 이미지를 프리페치한다.
 * getThread 실패는 개별 스레드 단위로 격리 — 한 스레드 실패가 나머지 프리페치를 막지 않는다.
 */
async function prefetchNewThreadImages(
  ctx: AccountContext & { provider: GmailProvider },
  newThreads: ThreadSummary[]
): Promise<void> {
  const urls: string[] = [];
  for (const t of newThreads) {
    try {
      const detail = await ctx.provider.getThread(t.id);
      for (const msg of detail.messages) urls.push(...extractRemoteImageUrls(msg.bodyHtml));
    } catch (err) {
      console.error('[daemon] getThread for image prefetch failed', t.id, err);
    }
  }
  if (urls.length) await prefetch(ctx.cache, imageCacheDir(ctx.email), urls);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd zenmail && npx vitest run src/main/snooze.test.ts`
Expected: PASS.

- [ ] **Step 6: Run full vitest suite (regression check)**

Run: `cd zenmail && npm test`
Expected: all tests pass, including pre-existing `new-mail-alerts`/daemon tests (the new prefetch call is fire-and-forget/`void`-wrapped so it must not change the tick's existing return timing or `badgeChanged`/`perAccountNew` behavior — verify no existing snooze/notify test regresses).

- [ ] **Step 7: Typecheck and commit**

```bash
cd /Users/claud_01/Documents/flo/AX/mailer
git add zenmail/src/main/snooze.ts zenmail/src/main/snooze.test.ts
git commit -m "feat(remote-image-prefetch): prefetch remote images on new-unread daemon detection (CP2b)"
```

This completes CP2 (TODO.md). Update TODO.md CP2 checkboxes.

---

### Task 7: Renderer store — `autoLoadRemoteImages` setting + toggle action

**Files:**
- Modify: `zenmail/src/renderer/store/mail.ts`

**Interfaces:**
- Consumes: `api().getGlobalSetting`/`setGlobalSetting` (existing), `api().getRemoteImage` (Task 5).
- Produces (used by Task 8 ThreadView, Task 9 CommandPalette):
  ```ts
  interface MailStore {
    autoLoadRemoteImages: boolean; // default true until boot-read completes
    toggleAutoLoadRemoteImages(): void;
    fetchRemoteImage(url: string): Promise<{ dataUri: string; mimeType: string } | { error: string }>;
  }
  ```

This is a store-only change with no new IPC — no new vitest coverage needed beyond `tsc` (the store has no existing dedicated unit test file per the codebase's convention of testing store logic via E2E; verify by checking for `mail.test.ts` — if it exists and covers `setTheme`/`toggleTheme`, add a parallel test for `toggleAutoLoadRemoteImages` following the same pattern).

- [ ] **Step 1: Check for an existing mail.ts store test file**

Run: `cd zenmail && ls src/renderer/store/mail.test.ts 2>&1`

If it exists and tests `setTheme`/`toggleTheme`, add matching tests for the new field/action in this step before implementing (TDD). If it doesn't exist, this is store logic that's conventionally verified via E2E (Task 10) — proceed directly to Step 2 implementation, and rely on `tsc` + E2E TC-IMG-B5/B6 for coverage.

- [ ] **Step 2: Add the interface fields**

In `zenmail/src/renderer/store/mail.ts`, near `setTheme`/`toggleTheme` in the `MailStore` interface (~line 194-195), add:

```ts
  autoLoadRemoteImages: boolean;
  toggleAutoLoadRemoteImages(): void;
  fetchRemoteImage(url: string): Promise<{ dataUri: string; mimeType: string } | { error: string }>;
```

- [ ] **Step 3: Add the initial state**

Near `theme: 'light',` in the store's initial state object (~line 402), add:

```ts
    autoLoadRemoteImages: true,
```

- [ ] **Step 4: Boot-read from global settings**

In `init()`, right after the existing theme boot-read block (~line 414-417), add:

```ts
      try {
        const v = await api().getGlobalSetting('autoLoadRemoteImages');
        if (v === 'false') set({ autoLoadRemoteImages: false });
      } catch {
        /* default true */
      }
```

- [ ] **Step 5: Implement the actions**

Near `toggleTheme()` (~line 1622-1624), add:

```ts
    toggleAutoLoadRemoteImages() {
      const next = !get().autoLoadRemoteImages;
      set({ autoLoadRemoteImages: next });
      void api().setGlobalSetting('autoLoadRemoteImages', String(next));
    },

    async fetchRemoteImage(url) {
      const a = aid(get());
      if (!a) return { error: 'no account' };
      try {
        return await api().getRemoteImage(a, url);
      } catch (err) {
        console.error('getRemoteImage failed', err);
        return { error: String(err) };
      }
    },
```

- [ ] **Step 6: Typecheck**

Run: `cd zenmail && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Run full vitest suite**

Run: `cd zenmail && npm test`
Expected: all pass (no existing behavior changed, only additive).

- [ ] **Step 8: Commit**

```bash
cd /Users/claud_01/Documents/flo/AX/mailer
git add zenmail/src/renderer/store/mail.ts
git commit -m "feat(remote-image-prefetch): autoLoadRemoteImages store field + toggle + fetchRemoteImage action (CP3a)"
```

---

### Task 8: `ThreadView.tsx` — remove click-gate, substitute remote images via cache

**Files:**
- Modify: `zenmail/src/renderer/components/ThreadView.tsx`

**Interfaces:**
- Consumes: `useMailStore((s) => s.autoLoadRemoteImages)`, `useMailStore((s) => s.fetchRemoteImage)` (Task 7).
- Produces: no new exports — `MessageCard`/`prepareHtml` behavior change only.

This is a breaking UI change (removes the `allowImages` gate button for the `autoLoadRemoteImages: true` default) — `/react-best-practices` + `/code-review low` required before this task's commit merges to the working tree beyond a local checkpoint (enforced in Task 9, but flagged here since this is the task that triggers it).

- [ ] **Step 1: Read current `ThreadView.tsx` state**

Before editing, re-read `zenmail/src/renderer/components/ThreadView.tsx` in full (it was last modified by the `email-body-images` bugfix and the earlier `remote-image-prefetch` groundwork isn't applied yet) — confirm the current line numbers of `REMOTE_IMG_RE`, `prepareHtml`, `hasRemoteImages`, `allowImages` state, and the "Load remote images" button before making the edits below, since exact line numbers may have drifted.

- [ ] **Step 2: Replace `prepareHtml`'s CSP and add remote-image substitution**

Change the `prepareHtml` function signature to accept a `remoteImages: Map<string, string>` parameter (fourth arg, alongside the existing `inlineImages` map) and the CSP line:

```ts
function prepareHtml(
  message: MessageDetail,
  opts: { showQuoted: boolean; theme: 'light' | 'dark' },
  inlineImages: Map<string, string>,
  remoteImages: Map<string, string>
): { srcDoc: string; hasQuoted: boolean } {
  const raw = message.bodyHtml || `<pre style="white-space:pre-wrap">${message.bodyText}</pre>`;
  const doc = new DOMParser().parseFromString(raw, 'text/html');

  doc.querySelectorAll('script, iframe, object, embed, form').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    }
  });

  doc.querySelectorAll('img[src^="cid:"]').forEach((img) => {
    const cid = (img.getAttribute('src') ?? '').slice(4).replace(/^<|>$/g, '');
    const dataUri = inlineImages.get(cid);
    if (dataUri) img.setAttribute('src', dataUri);
  });

  // remote-image-prefetch: https(s): 이미지는 캐시에 있으면 data URI로 치환. 캐시에 없으면 원본
  // src를 그대로 두되, CSP img-src가 data:만 허용하므로 실제로는 그냥 안 보인다(네트워크 시도 없음).
  doc.querySelectorAll('img[src^="http:"], img[src^="https:"]').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    const dataUri = remoteImages.get(src);
    if (dataUri) img.setAttribute('src', dataUri);
  });

  const quoted = doc.querySelectorAll('.gmail_quote, blockquote');
  const hasQuoted = quoted.length > 0;
  if (!opts.showQuoted) quoted.forEach((el) => el.remove());

  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;`;
  const srcDoc = `<!doctype html><html><head>
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <base target="_blank">
    <style>
      body { margin: 0; padding: 4px 0; background: transparent; color: ${
        opts.theme === 'dark' ? '#ececec' : '#18181b'
      };
             font: 13px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
             word-wrap: break-word; }
      a { color: #6366f1; }
      img { max-width: 100%; height: auto; }
      pre { white-space: pre-wrap; }
    </style>
  </head><body>${doc.body.innerHTML}</body></html>`;
  return { srcDoc, hasQuoted };
}
```

Note: `opts.allowImages` is removed from `prepareHtml`'s options (it no longer varies the CSP — CSP is now always `img-src data:`, per DECISIONS.md D7). Remove the `REMOTE_IMG_RE` constant and its `hasRemoteImages` usage entirely — replace with a new extraction helper (Step 3).

- [ ] **Step 3: Add a renderer-side remote URL extractor + update `MessageCard`**

Add near the top of the file, replacing the old `REMOTE_IMG_RE` constant:

```ts
/** 본문에서 원격(https?:) img src만 추출 — main의 extractRemoteImageUrls(정규식)와 별도 구현,
 * renderer는 이미 DOMParser로 doc을 갖고 있으므로 DOM 기반이 더 정확하다. */
function extractRemoteImageUrls(doc: Document): string[] {
  const seen = new Set<string>();
  doc.querySelectorAll('img[src^="http:"], img[src^="https:"]').forEach((img) => {
    const src = img.getAttribute('src');
    if (src) seen.add(src);
  });
  return [...seen];
}
```

In `MessageCard`, replace the `allowImages`/`hasRemoteImages` state and the inline-images effect block with:

```ts
function MessageCard({ message, isLast }: { message: MessageDetail; isLast: boolean }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [height, setHeight] = useState(120);
  const [inlineImages, setInlineImages] = useState<Map<string, string>>(new Map());
  const [remoteImages, setRemoteImages] = useState<Map<string, string>>(new Map());
  const frameRef = useRef<HTMLIFrameElement>(null);

  const theme = useMailStore((s) => s.theme);
  const fetchAttachmentImage = useMailStore((s) => s.fetchAttachmentImage);
  const autoLoadRemoteImages = useMailStore((s) => s.autoLoadRemoteImages);
  const fetchRemoteImage = useMailStore((s) => s.fetchRemoteImage);

  useEffect(() => {
    const inline = (message.attachments ?? []).filter(
      (a) => a.inline && a.contentId && a.mimeType.startsWith('image/')
    );
    if (inline.length === 0) return;
    let cancelled = false;
    void Promise.all(
      inline.map(async (a) => {
        const res = await fetchAttachmentImage(message.id, a.attachmentId, a.mimeType);
        if (!cancelled && 'dataUri' in res && a.contentId) {
          setInlineImages((prev) => new Map(prev).set(a.contentId!, res.dataUri));
        }
      })
    );
    return () => {
      cancelled = true;
    };
  }, [message.id, fetchAttachmentImage]);

  // remote-image-prefetch: autoLoadRemoteImages가 true면 mount 시 본문의 원격 이미지를 병렬 요청
  // (거의 항상 캐시 hit — snooze.ts 데몬이 이미 프리페치해둠). false면 아무것도 하지 않고
  // ManualLoadButton(아래)이 사용자가 눌렀을 때만 동일 로직을 1회 수행한다.
  const loadRemoteImages = useCallback(() => {
    const raw = message.bodyHtml || '';
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const urls = extractRemoteImageUrls(doc);
    if (urls.length === 0) return;
    let cancelled = false;
    void Promise.all(
      urls.map(async (url) => {
        const res = await fetchRemoteImage(url);
        if (!cancelled && 'dataUri' in res) {
          setRemoteImages((prev) => new Map(prev).set(url, res.dataUri));
        }
      })
    );
    return () => {
      cancelled = true;
    };
  }, [message.bodyHtml, fetchRemoteImage]);

  useEffect(() => {
    if (!autoLoadRemoteImages) return;
    return loadRemoteImages();
  }, [message.id, autoLoadRemoteImages, loadRemoteImages]);

  const { srcDoc, hasQuoted } = useMemo(
    () => prepareHtml(message, { showQuoted, theme }, inlineImages, remoteImages),
    [message, showQuoted, theme, inlineImages, remoteImages]
  );

  const hasRemoteImages = useMemo(() => {
    const doc = new DOMParser().parseFromString(message.bodyHtml || '', 'text/html');
    return extractRemoteImageUrls(doc).length > 0;
  }, [message.bodyHtml]);
```

Replace the old gate button JSX:

```tsx
      {hasRemoteImages && !allowImages && (
        <button
          onClick={() => setAllowImages(true)}
          className="mb-2 rounded border border-bg-border px-2 py-0.5 text-[11px] text-text-secondary hover:text-text-primary"
        >
          Load remote images
        </button>
      )}
```

with:

```tsx
      {hasRemoteImages && !autoLoadRemoteImages && remoteImages.size === 0 && (
        <button
          onClick={loadRemoteImages}
          className="mb-2 rounded border border-bg-border px-2 py-0.5 text-[11px] text-text-secondary hover:text-text-primary"
        >
          Load remote images
        </button>
      )}
```

(`remoteImages.size === 0` hides the button once the user has clicked it once and images resolved — matching the old `allowImages` gate's post-click behavior without needing a separate boolean.)

- [ ] **Step 2: Typecheck**

Run: `cd zenmail && npx tsc --noEmit`
Expected: clean — this will surface any other reference to the removed `allowImages`/`REMOTE_IMG_RE` names (search-fix them).

- [ ] **Step 3: Run full vitest suite**

Run: `cd zenmail && npm test`
Expected: all pass.

- [ ] **Step 4: Commit (checkpoint, pre-review)**

```bash
cd /Users/claud_01/Documents/flo/AX/mailer
git add zenmail/src/renderer/components/ThreadView.tsx
git commit -m "feat(remote-image-prefetch): ThreadView remote image cache substitution, CSP locked to data: (CP3b)"
```

---

### Task 9: `CommandPalette.tsx` — toggle action + review gate

**Files:**
- Modify: `zenmail/src/renderer/components/CommandPalette.tsx`

**Interfaces:**
- Consumes: `useMailStore.getState().toggleAutoLoadRemoteImages()` (Task 7), `useMailStore((s) => s.autoLoadRemoteImages)` (Task 7, for the label).

- [ ] **Step 1: Add the action**

In `zenmail/src/renderer/components/CommandPalette.tsx`, near the `toggleTheme` action (~line 172-176), add:

```tsx
      {
        id: 'toggleAutoLoadRemoteImages',
        name: useMailStore.getState().autoLoadRemoteImages
          ? 'Turn off automatic remote image loading'
          : 'Turn on automatic remote image loading',
        section: 'View',
        perform: () => useMailStore.getState().toggleAutoLoadRemoteImages(),
      },
```

(If the actions array is a `useMemo`/static list computed once rather than re-evaluated per palette open, verify the label updates live — check how `toggleTheme`'s neighboring "Toggle light/dark theme" entry handles this; if kbar re-registers actions on every render via a dependency array that includes store state, mirror that dependency. If it's a static list with no live label requirement precedent in this codebase, use a fixed label "Toggle automatic remote image loading" instead of the dynamic on/off phrasing to match the existing `toggleTheme` pattern exactly — simplicity over cleverness here.)

- [ ] **Step 2: Typecheck**

Run: `cd zenmail && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Run full vitest suite**

Run: `cd zenmail && npm test`
Expected: all pass.

- [ ] **Step 4: `/react-best-practices` review**

Invoke the `vercel:react-best-practices` skill against `ThreadView.tsx` and `CommandPalette.tsx` (the two renderer files touched in Tasks 8-9). Fix any findings inline, re-run `tsc`/`npm test` after fixes.

- [ ] **Step 5: `/code-review low` review**

Run the project's code-review process at `low` level against the diff since the last push (or since Task 5's commit, whichever is the actual breaking-change boundary) — per `CLAUDE.md`'s "모든 breaking change마다" rule. Fix any findings inline.

- [ ] **Step 6: Commit + push**

```bash
cd /Users/claud_01/Documents/flo/AX/mailer
git add zenmail/src/renderer/components/CommandPalette.tsx
git commit -m "feat(remote-image-prefetch): Command Palette auto-load-images toggle (CP3c)"
git push origin main
```

This completes CP3 (TODO.md). Update TODO.md CP3 checkboxes.

---

### Task 10: E2E — TC-IMG-B1~B9 + demo fixtures + regression

**Files:**
- Modify: `zenmail/src/main/gmail.ts` (`buildDemoData`/`MockGmailProvider` — add a private-IP fixture thread + a 5MB-fixture endpoint hook for the prune test, gated the same way `demo_img_1` already is)
- Modify: `zenmail/e2e/run-tc.mjs` (new `runImgSession`-style additions or extend the existing image-gate session — read the file's existing `TC-IMG-A*` implementation first to match its harness conventions exactly)
- Modify: `docs/features/remote-image-prefetch/TC.md` (flip `[ ]` to `[x]` as each passes)

This task's exact E2E code cannot be fully pre-written here without first reading `zenmail/e2e/run-tc.mjs`'s current `TC-IMG-A*` implementation and demo-seed gating (`ZENMAIL_DEMO_REMOTE_IMG`) in detail — the harness has grown to 250+ assertions with specific conventions (fresh user-data-dir sessions, `__debug` hook naming, `SA_RESERVED_SUBJECTS`/`SY_RESERVED` registration for any new demo subject) that must be matched exactly rather than guessed. Follow this procedure:

- [ ] **Step 1: Read the existing TC-IMG-A* harness code**

Read `zenmail/e2e/run-tc.mjs`'s `TC-IMG-A1`/`A2`/`A3` implementation in full, and read `zenmail/src/main/gmail.ts`'s `demo_img_1` seed + `ZENMAIL_DEMO_REMOTE_IMG` gate. Read `docs/DEV_WORKFLOW.md`'s "E2E 실행·토큰 규약" section (already in context) for the standalone-probe-first, full-suite-once-at-the-end policy.

- [ ] **Step 2: Add demo fixtures**

Following the existing `ZENMAIL_DEMO_REMOTE_IMG`-gated pattern, add to `buildDemoData()`/`MockGmailProvider`:
- A thread whose `bodyHtml` contains `<img src="http://127.0.0.1:1/probe.png">` (or a fixed unroutable-but-syntactically-private address) for the SSRF-block test (TC-IMG-B3/B4).
- Ensure the existing `demo_img_1` thread's remote image URL points at the E2E harness's local image server (should already be true — verify, don't re-implement).
- Register any new demo subject in `SA_RESERVED_SUBJECTS`/`SY_RESERVED` in `run-tc.mjs` per the DEV_WORKFLOW E2E regulation item 5 (mandatory — a missed registration flips unrelated canon SKIPs to FAILs).

- [ ] **Step 3: Write a standalone probe script (per E2E token policy)**

Extract the relevant session function into a temporary throwaway script (per DEV_WORKFLOW's documented procedure: copy helper functions + the session function into a script inside `zenmail/`, hardcode `PROJECT_DIR`, drive with `launchApp→connectPage→demoLogin→runXxxSession`). Use this for the red/green TDD loop on each TC-IMG-B* case — do NOT run the full 250+ suite repeatedly.

- [ ] **Step 4: Implement each TC-IMG-B* assertion, red→green, one at a time**

For each of TC-IMG-B1 through B9 (TC.md): write the assertion in the probe script, run it, confirm it fails for the right reason (feature not yet wired in that specific way — most of the underlying implementation from Tasks 1-9 should already make these pass; this step's "red" may simply be "harness assertion doesn't exist yet" rather than "feature broken" — verify implementation correctness, not TDD in the strict sense at this integration layer), then move it into `run-tc.mjs` proper.

- [ ] **Step 5: Delete the throwaway probe script**

```bash
rm <path-to-throwaway-script>  # never commit this
```

- [ ] **Step 6: Run the full E2E suite in the background, check the VERDICT block**

```bash
cd /Users/claud_01/Documents/flo/AX/mailer/zenmail
nohup node e2e/run-tc.mjs > /tmp/zenmail-e2e-remote-image-prefetch.log 2>&1 &
```

Wait for completion, then:

```bash
tail -10 /tmp/zenmail-e2e-remote-image-prefetch.log
```

Expected: `NO-REGRESSION: CLEAN` (0 FAIL + SKIP set ⊆ canon `CANON_SKIPS`).

If FAIL: grep the log for that specific TC id's detail (do not read the full log into context per DEV_WORKFLOW policy).

- [ ] **Step 7: Update TC.md and TODO.md**

Flip all `[ ]` to `[x]` in `docs/features/remote-image-prefetch/TC.md` and `TODO.md` CP4, with the actual PASS/FAIL/total counts substituted for the placeholder language.

- [ ] **Step 8: Final whole-branch review**

Dispatch a `deep-reasoner`-model review (per this project's CLAUDE.md subagent-model override — Sonnet floor, `deep-reasoner`/Opus for this specific gate) of the full diff since this feature branch started, focused specifically on SSRF-guard correctness (per DECISIONS.md D9) and the CSP change in Task 8 (per D7). Fix any Critical/Important findings, re-run the targeted probe (not full suite) to confirm the fix, then re-run the full suite once more if the fix touched shared code paths.

- [ ] **Step 9: Commit + push**

```bash
cd /Users/claud_01/Documents/flo/AX/mailer
git add zenmail/src/main/gmail.ts zenmail/e2e/run-tc.mjs docs/features/remote-image-prefetch/TC.md docs/features/remote-image-prefetch/TODO.md
git commit -m "test(remote-image-prefetch): TC-IMG-B1~B9 E2E + demo fixtures, full suite clean (CP4)"
git push origin main
```

- [ ] **Step 10: Package a DMG smoke build (per user's established pattern for this feature area)**

```bash
cd /Users/claud_01/Documents/flo/AX/mailer/zenmail
npm run make
```

Confirm `out/make/*.dmg` produced without error (mirrors the verification already done for the `email-body-images` fix earlier this session).

- [ ] **Step 11: Update DEV_WORKFLOW.md snapshot + Obsidian**

Append a snapshot entry to `docs/DEV_WORKFLOW.md`'s "현재 상태 스냅샷" section (same format as the `email-body-images`/`new-mail-alerts` entries already there) and add a checkpoint to `/Users/claud_01/Documents/flo/_obsidian/Projects/ZenMail.md` (bump the vault `index.md` Active Projects date too), per `CLAUDE.md`'s "Obsidian 체크포인트" rule.

```bash
cd /Users/claud_01/Documents/flo/AX/mailer
git add docs/DEV_WORKFLOW.md
git commit -m "docs(remote-image-prefetch): DEV_WORKFLOW snapshot (Goal 8)"
git push origin main
```

---

## Plan Self-Review Notes

- **Spec coverage**: FR1-FR6 → Tasks 1-4. FR7-FR13 → Tasks 5-6 (IPC/settings), plus D6's correction (extra `getThread` call) is reflected in Task 6 exactly. FR14-FR17 → Tasks 7-9. FR18-FR19 → Task 10. NFR1 (no deps) verified — only `node:crypto`/`node:fs`/`node:path`/`node:http`(test-only)/global `fetch` used throughout. NFR3 (SSRF) → Task 3's guard + Task 4's per-redirect-hop re-check, both with dedicated tests. NFR5 (200MB cap) → Task 4's `pruneCache`, wired at call sites is **not yet shown** — see gap below. NFR7 (E2E regression) → Task 10 Steps 6/8.
- **Gap found and left as an explicit follow-up, not silently dropped**: `pruneCache` (Task 4) is implemented and unit-tested but no task actually *calls* it in a running-app code path (only tests call it directly). Task 6's `prefetchNewThreadImages` should call `pruneCache(ctx.cache, imageCacheDir(ctx.email), 200 * 1024 * 1024)` after prefetching. **Fix applied inline below** — see the amended Task 6 Step 4 code block, which now needs this line added at the end of `prefetchNewThreadImages`:
  ```ts
  pruneCache(ctx.cache, imageCacheDir(ctx.email), 200 * 1024 * 1024);
  ```
  (add `pruneCache` to the `import { prefetch, extractRemoteImageUrls } from './image-cache';` line in Task 6 → `import { prefetch, extractRemoteImageUrls, pruneCache } from './image-cache';`). Implementer: apply this when executing Task 6 Step 4, not as a separate task — it's the same file/same function.
- **Type consistency check**: `getCachedOrFetch`/`prefetch`/`pruneCache` signatures match between Task 4's implementation and Task 5/6/10's call sites (`cache: AccountCache, cacheDir: string, ...`). `ZenmailApi.getRemoteImage` (Task 5) matches the store's `fetchRemoteImage` call (Task 7) and the preload exposure (Task 5). `autoLoadRemoteImages`/`toggleAutoLoadRemoteImages` names are consistent across Tasks 7, 8, 9.
- **Placeholder scan**: Task 10 intentionally defers exact E2E code to an in-task "read first" step rather than fabricating harness code that's likely to not match `run-tc.mjs`'s actual current conventions — this is flagged explicitly in the task rather than silently glossed over, per this plan's own standard (see Task 10's framing paragraph). All other tasks contain complete, runnable code.
