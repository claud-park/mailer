// Pure split-inbox matching engine. No React/store dependencies — see
// docs/features/split-inbox-plus/DECISIONS.md D6 (no cached derived state).

import { CATEGORY_LABELS, type SplitDefinition, type ThreadSummary } from '../../shared/types';

export const INBOX_TAB = 'inbox';

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
  /** [INBOX_TAB, ...enabled defs by position] */
  order: string[];
  /** threadId -> splitId | INBOX_TAB (INBOX_TAB is the catch-all for unmatched threads) */
  assignment: Map<string, string>;
  /** per-tab counts over the loaded threads; mutually exclusive — sum equals threads.length */
  counts: Map<string, { total: number; unread: number }>;
}

export function computeSplits(threads: ThreadSummary[], defs: SplitDefinition[]): ComputedSplits {
  const enabledDefs = defs.filter((d) => d.enabled).sort((a, b) => a.position - b.position);
  const rules = compileDefs(defs);
  const order = [INBOX_TAB, ...enabledDefs.map((d) => d.id)];

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

    let matched: string = INBOX_TAB;
    for (const rule of rules) {
      if (rule.match(email, domain, t)) {
        matched = rule.id;
        break;
      }
    }

    assignment.set(t.id, matched);
    bump(matched, t.unread);
  }

  return { order, assignment, counts };
}

/**
 * Filters threads to `activeTab` while preserving original order. INBOX_TAB is the catch-all for
 * threads that don't match any enabled split rule — see docs/features/split-inbox-plus/DECISIONS.md
 * D15 (a thread matched to a split tab no longer also appears in Inbox).
 *
 * `pinnedIds` (fired follow-up thread ids — see docs/features/follow-up-reminders/DECISIONS.md D8)
 * moves matching threads from the *filtered* result to the front, preserving each group's own
 * relative order (pins keep their order among themselves, the rest keep theirs). Filtering always
 * happens first, so a pinned id that doesn't belong to `activeTab` never appears in the result.
 * Omitting `pinnedIds` (or passing an empty set) leaves ordering untouched — callers should only
 * pass it while an INBOX view (any split tab) is on screen, never during search or a non-INBOX
 * label view.
 */
export function selectVisibleThreads(
  threads: ThreadSummary[],
  defs: SplitDefinition[],
  activeTab: string,
  pinnedIds?: ReadonlySet<string>
): ThreadSummary[] {
  const { assignment } = computeSplits(threads, defs);
  const filtered = threads.filter((t) => assignment.get(t.id) === activeTab);

  if (!pinnedIds || pinnedIds.size === 0) return filtered;

  const pinned: ThreadSummary[] = [];
  const rest: ThreadSummary[] = [];
  for (const t of filtered) {
    (pinnedIds.has(t.id) ? pinned : rest).push(t);
  }
  return [...pinned, ...rest];
}
