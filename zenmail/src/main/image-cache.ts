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

// RFC 4291 §2.5.5.2 IPv4-mapped IPv6 (::ffff:a.b.c.d) 언랩. Node의 new URL()은 이를
// 16진 그룹 형태(::ffff:7f00:1)로 정규화하므로 두 표기 모두 처리한다.
function ipv4FromMappedIPv6(host: string): string | null {
  const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    if (Number.isNaN(hi) || Number.isNaN(lo)) return null;
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === '::1') return true; // loopback
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 unique-local
  if (h.startsWith('fe80')) return true; // fe80::/10 link-local
  const mapped = ipv4FromMappedIPv6(h);
  if (mapped) return isPrivateIPv4(mapped);
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

/**
 * E2E 전용: run-tc.mjs가 `ZENMAIL_DEMO_REMOTE_IMG`로 지정한 하네스 로컬 이미지 서버 origin만
 * 예외적으로 허용한다(FR18 — demo_img_1이 그 서버를 실제 프리페치 대상으로 재사용한다는 전제).
 * `ZENMAIL_E2E_PORT`가 설정된 프로세스(E2E 하네스가 구동한 Electron)에서만 활성화되며, 패키징된
 * 앱은 이 env가 절대 설정되지 않으므로 프로덕션에서는 `isPrefetchableUrl`과 동작이 동일하다.
 * 이 origin 하나만 예외이고, 다른 모든 사설/루프백 URL(SSRF 차단 검증용 fixture 포함)은 여전히
 * 차단된다 — 호출부(ipc.ts/snooze.ts)에서 `ZENMAIL_E2E_PORT`가 설정된 경우에만 이 함수를
 * `isAllowed`로 넘긴다.
 */
export function isPrefetchableUrlE2E(url: string): boolean {
  if (isPrefetchableUrl(url)) return true;
  const allowedOrigin = process.env.ZENMAIL_DEMO_REMOTE_IMG;
  if (!allowedOrigin) return false;
  try {
    return new URL(url).origin === new URL(allowedOrigin).origin;
  } catch {
    return false;
  }
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

import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import type { AccountCache } from './cache';

type UrlGuard = (url: string) => boolean;

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
 * hostname이 IP 리터럴이면 isPrefetchableUrl이 이미 검증했으므로 스킵. 도메인 이름이면 실제로
 * 어떤 IP로 풀리는지 조회해 사설/루프백/링크-로컬이면 차단한다(D9 — "도메인이 사설 IP로 풀리는"
 * 케이스는 IP 리터럴 필터만으로는 못 막음). 조회 실패는 fail-closed(차단).
 * ⚠️ 잔여 한계(문서화): 여기서 조회한 결과와 fetch()가 실제 연결 시 다시 수행하는 DNS 조회가
 * 다를 수 있다(DNS rebinding) — 커스텀 저수준 connect 훅 없이는 완전히 막을 수 없어 v1 범위 밖.
 */
async function resolvesToPrivateAddress(hostname: string): Promise<boolean> {
  if (IPV4_RE.test(hostname) || hostname.includes(':')) return false; // literal, already checked
  try {
    const addrs = await dns.promises.lookup(hostname, { all: true });
    return addrs.some((a) => (a.family === 4 ? isPrivateIPv4(a.address) : isPrivateIPv6(a.address)));
  } catch {
    return true; // lookup failure — fail closed
  }
}

/**
 * 리다이렉트를 수동으로 따라가며 매 hop마다 guard(기본 isPrefetchableUrl)를 재적용한다(D9) —
 * fetch의 redirect:'follow'는 최종 URL만 알 수 있어 중간 hop의 사설망 우회를 막을 수 없다.
 */
async function fetchImageBytes(
  url: string,
  isAllowed: UrlGuard = isPrefetchableUrl
): Promise<{ buf: Buffer; mimeType: string } | { error: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowed(current)) return { error: 'blocked: not a prefetchable url' };
    const hostname = new URL(current).hostname;
    if (await resolvesToPrivateAddress(hostname)) return { error: 'blocked: resolves to a private address' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(current, { redirect: 'manual', signal: controller.signal });
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
      if (!res.body) return { error: 'empty response body' };
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => {});
          return { error: 'response too large' };
        }
        chunks.push(value);
      }
      return { buf: Buffer.concat(chunks), mimeType };
    } catch (err) {
      return { error: `fetch failed: ${String(err)}` };
    } finally {
      clearTimeout(timer);
    }
  }
  return { error: 'too many redirects' };
}

export async function getCachedOrFetch(
  cache: AccountCache,
  cacheDir: string,
  url: string,
  opts: { fetchLive: boolean; isAllowed?: UrlGuard }
): Promise<{ dataUri: string; mimeType: string } | { error: string }> {
  const urlHash = urlHashOf(url);
  const meta = cache.getImageCache(urlHash);
  if (meta) {
    const buf = readCachedFile(cacheDir, urlHash);
    if (buf) return { dataUri: `data:${meta.mimeType};base64,${buf.toString('base64')}`, mimeType: meta.mimeType };
    cache.deleteImageCache(urlHash); // metadata orphaned (file missing) — fall through to re-fetch
  }
  if (!opts.fetchLive) return { error: 'not cached' };

  const result = await fetchImageBytes(url, opts.isAllowed);
  if ('error' in result) return result;
  writeCachedFile(cacheDir, urlHash, result.buf);
  cache.setImageCache({ urlHash, mimeType: result.mimeType, byteSize: result.buf.byteLength, fetchedAt: Date.now() });
  return { dataUri: `data:${result.mimeType};base64,${result.buf.toString('base64')}`, mimeType: result.mimeType };
}

/** 여러 URL을 병렬 프리페치. 개별 실패는 조용히 스킵(throw 없음) — 콘솔 로그만. */
export async function prefetch(
  cache: AccountCache,
  cacheDir: string,
  urls: string[],
  isAllowed?: UrlGuard
): Promise<void> {
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await getCachedOrFetch(cache, cacheDir, url, { fetchLive: true, isAllowed });
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
