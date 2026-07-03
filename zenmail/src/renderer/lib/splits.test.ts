import { describe, expect, it } from 'vitest';
import type { SplitDefinition, ThreadSummary } from '../../shared/types';
import { computeSplits, INBOX_TAB, OTHER_TAB, selectVisibleThreads } from './splits';

function thread(overrides: Partial<ThreadSummary> & Pick<ThreadSummary, 'id'>): ThreadSummary {
  return {
    subject: 'subject',
    from: { name: 'Sender', email: 'sender@example.com' },
    snippet: 'snippet',
    date: Date.now(),
    unread: false,
    labelIds: ['INBOX'],
    messageCount: 1,
    ...overrides,
  };
}

const vip: SplitDefinition = {
  id: 'vip',
  name: 'VIP',
  position: 0,
  enabled: true,
  rule: { kind: 'senders', emails: ['boss@acme.com'] },
};

const team: SplitDefinition = {
  id: 'team',
  name: 'Team',
  position: 1,
  enabled: true,
  rule: { kind: 'domains', domains: ['acme.com'] },
};

const newsletter: SplitDefinition = {
  id: 'newsletter',
  name: 'Newsletter',
  position: 2,
  enabled: true,
  rule: { kind: 'newsletter' },
};

const custom: SplitDefinition = {
  id: 'custom',
  name: 'Custom',
  position: 3,
  enabled: true,
  rule: { kind: 'labels', labelIds: ['Label_work'] },
};

describe('computeSplits', () => {
  it('orders tabs as [inbox, ...enabled defs by position, other]', () => {
    const { order } = computeSplits([], [team, vip]); // defs passed out of position order
    expect(order).toEqual([INBOX_TAB, 'vip', 'team', OTHER_TAB]);
  });

  it('first-match: a thread matching multiple rules is assigned only to the earliest position', () => {
    // boss@acme.com matches both VIP (senders) and Team (domain), VIP has lower position
    const t = thread({ id: 't1', from: { name: 'Boss', email: 'boss@acme.com' } });
    const { assignment } = computeSplits([t], [vip, team]);
    expect(assignment.get('t1')).toBe('vip');
  });

  it('excludes disabled splits from order and matching', () => {
    const disabledVip: SplitDefinition = { ...vip, enabled: false };
    const t = thread({ id: 't1', from: { name: 'Boss', email: 'boss@acme.com' } });
    const { order, assignment } = computeSplits([t], [disabledVip, team]);
    expect(order).toEqual([INBOX_TAB, 'team', OTHER_TAB]);
    // falls through to the next matching rule (Team, same domain) since VIP is disabled
    expect(assignment.get('t1')).toBe('team');
  });

  it('assigns unmatched threads to the Other catch-all', () => {
    const t = thread({ id: 't1', from: { name: 'Nobody', email: 'nobody@nowhere.com' } });
    const { assignment } = computeSplits([t], [vip, team]);
    expect(assignment.get('t1')).toBe(OTHER_TAB);
  });

  it('INBOX_TAB is unfiltered (selectVisibleThreads returns all threads regardless of match)', () => {
    const threads = [
      thread({ id: 't1', from: { name: 'Boss', email: 'boss@acme.com' } }),
      thread({ id: 't2', from: { name: 'Nobody', email: 'nobody@nowhere.com' } }),
    ];
    const visible = selectVisibleThreads(threads, [vip, team], INBOX_TAB);
    expect(visible).toEqual(threads);
  });

  it('counts: sum of all non-inbox tab totals equals the full thread count (no loss/duplication)', () => {
    const threads = [
      thread({ id: 't1', from: { name: 'Boss', email: 'boss@acme.com' } }),
      thread({ id: 't2', from: { name: 'Teammate', email: 'dev@acme.com' } }),
      thread({ id: 't3', from: { name: 'Nobody', email: 'nobody@nowhere.com' } }),
    ];
    const { order, counts } = computeSplits(threads, [vip, team]);
    const sum = order
      .filter((id) => id !== INBOX_TAB)
      .reduce((acc, id) => acc + counts.get(id)!.total, 0);
    expect(sum).toBe(threads.length);
    expect(counts.get(INBOX_TAB)!.total).toBe(threads.length);
  });

  it('counts unread threads per tab', () => {
    const threads = [
      thread({ id: 't1', from: { name: 'Boss', email: 'boss@acme.com' }, unread: true }),
      thread({ id: 't2', from: { name: 'Boss', email: 'boss@acme.com' }, unread: false }),
    ];
    const { counts } = computeSplits(threads, [vip]);
    expect(counts.get('vip')).toEqual({ total: 2, unread: 1 });
  });

  it('newsletter heuristic matches by CATEGORY_* label', () => {
    const t = thread({
      id: 't1',
      from: { name: 'Random', email: 'random@somewhere.com' },
      labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
    });
    const { assignment } = computeSplits([t], [newsletter]);
    expect(assignment.get('t1')).toBe('newsletter');
  });

  it('newsletter heuristic matches by sender pattern', () => {
    const t = thread({ id: 't1', from: { name: 'Acme', email: 'no-reply@acme.com' } });
    const { assignment } = computeSplits([t], [newsletter]);
    expect(assignment.get('t1')).toBe('newsletter');
  });

  it('domain matching is case-insensitive', () => {
    const upperDomainRule: SplitDefinition = {
      ...team,
      rule: { kind: 'domains', domains: ['ACME.COM'] },
    };
    const t = thread({ id: 't1', from: { name: 'Dev', email: 'dev@ACME.com' } });
    const { assignment } = computeSplits([t], [upperDomainRule]);
    expect(assignment.get('t1')).toBe('team');
  });

  it('sender matching is case-insensitive', () => {
    const upperSenderRule: SplitDefinition = {
      ...vip,
      rule: { kind: 'senders', emails: ['Boss@Acme.com'] },
    };
    const t = thread({ id: 't1', from: { name: 'Boss', email: 'BOSS@ACME.COM' } });
    const { assignment } = computeSplits([t], [upperSenderRule]);
    expect(assignment.get('t1')).toBe('vip');
  });

  it('labels rule matches on label id intersection', () => {
    const t = thread({ id: 't1', labelIds: ['INBOX', 'Label_work'] });
    const { assignment } = computeSplits([t], [custom]);
    expect(assignment.get('t1')).toBe('custom');
  });

  it('selectVisibleThreads for a non-inbox tab preserves original thread order', () => {
    // t2 is a non-VIP acme sender, so it lands in Team (not VIP); order in the
    // source array is t3, t1, t2 to verify the filter doesn't reorder.
    const threads = [
      thread({ id: 't3', from: { name: 'Dev2', email: 'dev2@acme.com' } }),
      thread({ id: 't1', from: { name: 'Boss', email: 'boss@acme.com' } }),
      thread({ id: 't2', from: { name: 'Dev', email: 'dev@acme.com' } }),
    ];
    const visible = selectVisibleThreads(threads, [vip, team], 'team');
    expect(visible.map((t) => t.id)).toEqual(['t3', 't2']);
  });
});
