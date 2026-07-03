// Pure split-inbox matching engine. No React/store dependencies — see
// docs/features/split-inbox-plus/DECISIONS.md D6 (no cached derived state).

import { CATEGORY_LABELS, type SplitDefinition, type ThreadSummary } from '../../shared/types';

export const INBOX_TAB = 'inbox';
export const OTHER_TAB = 'other';

/** e.g. `noreply@`, `no-reply@`, `newsletter@`, `digest@`, `updates@`, plus dot/dash/underscore-prefixed variants */
const NEWSLETTER_SENDER_RE = /(?:^|[.\-_])(?:no-?reply|newsletter|digest|updates)@/i;

interface CompiledRule {
  id: string;
  /** email/domain are already lowercased by the caller */
  match: (email: string, domain: string, thread: ThreadSummary) => boolean;
}

function compileDefs(defs: SplitDefinition[]): CompiledRule[] {
  return defs
    .filter((d) => d.enabled)
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((d): CompiledRule => {
      const rule = d.rule;
      if (rule.kind === 'senders') {
        const emails = new Set(rule.emails.map((e) => e.toLowerCase()));
        return { id: d.id, match: (email) => emails.has(email) };
      }
      if (rule.kind === 'domains') {
        const domains = new Set(rule.domains.map((dm) => dm.toLowerCase()));
        return { id: d.id, match: (_email, domain) => domains.has(domain) };
      }
      if (rule.kind === 'labels') {
        const labelIds = new Set(rule.labelIds);
        return { id: d.id, match: (_email, _domain, thread) => thread.labelIds.some((l) => labelIds.has(l)) };
      }
      // newsletter: category label OR sender pattern
      return {
        id: d.id,
        match: (email, _domain, thread) =>
          CATEGORY_LABELS.some((c) => thread.labelIds.includes(c)) || NEWSLETTER_SENDER_RE.test(email),
      };
    });
}

export interface ComputedSplits {
  /** [INBOX_TAB, ...enabled defs by position, OTHER_TAB] */
  order: string[];
  /** threadId -> splitId | OTHER_TAB (INBOX_TAB never appears as a value) */
  assignment: Map<string, string>;
  /** per-tab counts over the loaded threads; INBOX_TAB reflects the full loaded set */
  counts: Map<string, { total: number; unread: number }>;
}

export function computeSplits(threads: ThreadSummary[], defs: SplitDefinition[]): ComputedSplits {
  const enabledDefs = defs.filter((d) => d.enabled).sort((a, b) => a.position - b.position);
  const rules = compileDefs(defs);
  const order = [INBOX_TAB, ...enabledDefs.map((d) => d.id), OTHER_TAB];

  const assignment = new Map<string, string>();
  const counts = new Map<string, { total: number; unread: number }>();
  for (const id of order) counts.set(id, { total: 0, unread: 0 });

  const bump = (id: string, unread: boolean) => {
    const c = counts.get(id)!;
    c.total += 1;
    if (unread) c.unread += 1;
  };

  for (const t of threads) {
    const email = t.from.email.toLowerCase();
    const domain = email.split('@')[1] ?? '';

    let matched: string = OTHER_TAB;
    for (const rule of rules) {
      if (rule.match(email, domain, t)) {
        matched = rule.id;
        break;
      }
    }

    assignment.set(t.id, matched);
    bump(matched, t.unread);
    // Inbox is the unfiltered view — every loaded thread counts toward it too.
    bump(INBOX_TAB, t.unread);
  }

  return { order, assignment, counts };
}

/** INBOX_TAB returns threads unfiltered; otherwise filters while preserving original order. */
export function selectVisibleThreads(
  threads: ThreadSummary[],
  defs: SplitDefinition[],
  activeTab: string
): ThreadSummary[] {
  if (activeTab === INBOX_TAB) return threads;
  const { assignment } = computeSplits(threads, defs);
  return threads.filter((t) => assignment.get(t.id) === activeTab);
}
