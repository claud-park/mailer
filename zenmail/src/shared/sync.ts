// Pure sync-engine helpers shared by main (mutation queue drain) and renderer
// (future online/offline UI). No side effects, no imports from electron/better-sqlite3.
//
// See docs/features/sync-engine/DECISIONS.md — D5 (failure classification),
// D6/D7/D9 (backoff scheduling).

/** node error codes that Gmail API client (gaxios) surfaces for network-level failures. */
const TRANSIENT_CODES = new Set([
  'ENOTFOUND',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EPIPE',
]);

/**
 * D5: transient = coded network errors (gaxios/node `code` string) ∪ HTTP 5xx/429/408.
 * permanent = everything else, including 4xx/404 **and generic errors with no code/status**.
 *
 * fail-safe by design: an unclassified `new Error(...)` (e.g. the F4/F5 debug-injected
 * failure, which carries neither `code` nor `status`) is treated as permanent so it falls
 * back to the existing renderer rollback path instead of being retried forever as a
 * poison message. See DECISIONS.md D5.
 */
export function classifyError(err: unknown): 'transient' | 'permanent' {
  const e = err as { code?: unknown; status?: unknown } | null | undefined;
  const code = e && typeof e === 'object' ? e.code : undefined;
  const status = e && typeof e === 'object' ? e.status : undefined;

  if (typeof code === 'string' && TRANSIENT_CODES.has(code)) return 'transient';
  if (typeof status === 'number' && (status === 429 || status === 408 || (status >= 500 && status < 600))) {
    return 'transient';
  }
  return 'permanent';
}

/** attempts=1 → base delay, doubling per attempt, capped at CAP_MS. */
const BASE_DELAY_MS = 10_000;
const CAP_DELAY_MS = 900_000;

export const MAX_ATTEMPTS = 8;

/**
 * Exponential backoff, deterministic by default (jitterFactor=0) so TC-A3 can assert exact
 * values. ±20% jitter is intentionally left to the caller: a real scheduler (CP2 daemon)
 * injects a random factor in [-0.2, 0.2] here rather than this module calling Math.random()
 * itself, keeping this function pure/testable.
 */
export function backoffDelayMs(attempts: number, jitterFactor = 0): number {
  const raw = BASE_DELAY_MS * 2 ** (attempts - 1);
  const capped = Math.min(raw, CAP_DELAY_MS);
  return Math.max(0, Math.round(capped * (1 + jitterFactor)));
}

export function isExhausted(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}
