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
