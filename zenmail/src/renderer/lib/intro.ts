/**
 * Pure Instant Intro detection — no React/store imports (mirrors coach.ts/snippets.ts, DECISIONS
 * D10 pattern). Consumed by store/mail.ts's openReply and exercised directly by intro.test.ts.
 */
import type { ThreadDetail } from '../../shared/types';

/** a thread with more messages than this is assumed to already be a live conversation, not an intro */
export const INTRO_MAX_MESSAGES = 2;

/** matches "intro", "introduce"/"introducing"/"introduction", "connect"/"connecting", or 한글 '소개' */
export const INTRO_SUBJECT_RE = /\b(intro|introduc\w*|connect\w*)\b|소개/i;

export interface IntroSuggestion {
  introducer: { name?: string; email: string };
  others: string[];
}

/**
 * Detects whether a thread looks like a double opt-in introduction (DECISIONS D8): the last
 * message was sent by a third party (not me) who cc'd/to'd at least one other third party, on a
 * short (<= INTRO_MAX_MESSAGES) thread whose subject reads like an intro.
 */
export function detectIntro(detail: ThreadDetail, myEmail: string): IntroSuggestion | null {
  const last = detail.messages[detail.messages.length - 1];
  if (!last) return null;
  if (last.from.email === myEmail) return null;
  if (detail.messages.length > INTRO_MAX_MESSAGES) return null;
  if (!INTRO_SUBJECT_RE.test(detail.subject)) return null;

  const seen = new Set<string>();
  const others: string[] = [];
  for (const c of [...last.to, ...last.cc]) {
    if (c.email === myEmail || c.email === last.from.email) continue;
    if (seen.has(c.email)) continue;
    seen.add(c.email);
    others.push(c.email);
  }
  if (others.length === 0) return null;

  return {
    introducer: { name: last.from.name || undefined, email: last.from.email },
    others,
  };
}
