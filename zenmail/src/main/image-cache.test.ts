import { describe, expect, it, beforeEach, afterEach , vi } from 'vitest';
import { isPrefetchableUrl, extractRemoteImageUrls , getCachedOrFetch, prefetch, pruneCache } from './image-cache';

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

  it('rejects IPv4-mapped IPv6 loopback/private/link-local addresses', () => {
    expect(isPrefetchableUrl('http://[::ffff:127.0.0.1]/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://[::ffff:169.254.169.254]/x.png')).toBe(false);
    expect(isPrefetchableUrl('http://[::ffff:10.0.0.1]/x.png')).toBe(false);
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

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { AccountCache } from './cache';

// vitest factory mocks don't get an automatic `default` export — both this test file and the
// implementation do `import dns from 'node:dns'` (matching real Node's CJS/ESM interop, where
// the default export is the whole module.exports incl. `promises`), so the mock must supply
// `default` itself pointing at the same object or the default import resolves to undefined.
vi.mock('node:dns', () => {
  const dnsMock = { promises: { lookup: vi.fn() } };
  return { ...dnsMock, default: dnsMock };
});
import dns from 'node:dns';

describe('getCachedOrFetch / prefetch / pruneCache', () => {
  let dir: string;
  let cacheDir: string;
  let cache: AccountCache;
  let server: http.Server;
  let baseUrl: string;
  let requestCount = 0;
  // Real isPrefetchableUrl rejects loopback (correctly — Task 3). The test HTTP server can only
  // ever bind to loopback/a private interface, so a guard that trusts *only this test server's
  // exact origin* (and defers to the real guard for every other URL, including redirect targets)
  // lets these tests exercise real fetch/redirect/cache-write mechanics without weakening the
  // guard the tests are supposed to be validating.
  const trustTestServer: (base: string) => (url: string) => boolean = (base) => (url) =>
    url.startsWith(base) || isPrefetchableUrl(url);

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
    const res = await getCachedOrFetch(cache, cacheDir, `${baseUrl}/ok.png`, {
      fetchLive: true,
      isAllowed: trustTestServer(baseUrl),
    });
    expect('dataUri' in res).toBe(true);
    if ('dataUri' in res) {
      expect(res.mimeType).toBe('image/png');
      expect(res.dataUri.startsWith('data:image/png;base64,')).toBe(true);
    }
    const urlHash = crypto.createHash('sha256').update(`${baseUrl}/ok.png`).digest('hex');
    expect(cache.getImageCache(urlHash)).not.toBeNull();
    expect(fs.existsSync(path.join(cacheDir, urlHash))).toBe(true);
  });

  it('cache hit reads from disk without a second network request', async () => {
    await getCachedOrFetch(cache, cacheDir, `${baseUrl}/ok.png`, { fetchLive: true, isAllowed: trustTestServer(baseUrl) });
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

  it('the real (default) guard blocks a loopback URL by default, without any override', async () => {
    // No isAllowed override — proves fetchImageBytes/getCachedOrFetch actually wire in the real
    // isPrefetchableUrl by default, not just when a test happens to pass one.
    const res = await getCachedOrFetch(cache, cacheDir, `${baseUrl}/ok.png`, { fetchLive: true });
    expect('error' in res).toBe(true);
    expect(requestCount).toBe(0); // blocked before any request was made
  });

  it('rejects a redirect that points to a private IP, even mid-chain, despite the origin being trusted', async () => {
    const res = await getCachedOrFetch(cache, cacheDir, `${baseUrl}/redirect-to-private`, {
      fetchLive: true,
      isAllowed: trustTestServer(baseUrl), // trusts baseUrl's origin only — NOT :1, the redirect target's port
    });
    expect('error' in res).toBe(true);
  });

  it('rejects a non-image content-type', async () => {
    const res = await getCachedOrFetch(cache, cacheDir, `${baseUrl}/not-an-image`, {
      fetchLive: true,
      isAllowed: trustTestServer(baseUrl),
    });
    expect('error' in res).toBe(true);
  });

  it('rejects a response over 5MB', async () => {
    const res = await getCachedOrFetch(cache, cacheDir, `${baseUrl}/too-big`, {
      fetchLive: true,
      isAllowed: trustTestServer(baseUrl),
    });
    expect('error' in res).toBe(true);
  });

  it('rejects a hostname that resolves to a private IP address (DNS-level SSRF)', async () => {
    (dns.promises.lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    // isAllowed override trusts this literal hostname string (it's not an IP literal, so Task 3's
    // isPrefetchableUrl alone would let it through) — the DNS-resolution check inside
    // fetchImageBytes is what must catch it.
    const res = await getCachedOrFetch(cache, cacheDir, 'http://private.example.test/x.png', {
      fetchLive: true,
      isAllowed: () => true,
    });
    expect('error' in res).toBe(true);
  });

  it('prefetch fetches multiple urls in parallel and swallows individual failures', async () => {
    await prefetch(cache, cacheDir, [`${baseUrl}/ok.png`, `${baseUrl}/does-not-exist`], trustTestServer(baseUrl));
    const urlHash = crypto.createHash('sha256').update(`${baseUrl}/ok.png`).digest('hex');
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
