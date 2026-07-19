import { describe, expect, it } from 'vitest';
import type { ThreadSummary } from '../shared/types';
import { diffNewUnread } from './notify';

function makeThread(id: string): ThreadSummary {
  return {
    id,
    subject: `subject ${id}`,
    from: { name: 'Sender', email: 'sender@example.com' },
    snippet: 'snippet',
    date: Date.now(),
    unread: true,
    labelIds: ['INBOX', 'UNREAD'],
    messageCount: 1,
  };
}

describe('diffNewUnread', () => {
  // new-mail-alerts D9/TC-ALT-C1: 계정의 첫 관측(lastKnownIds===undefined)은 baseline만 시딩하고
  // 알림 대상(newThreads)은 비워야 콜드스타트 알림 폭발이 없다.
  it('최초 관측(lastKnownIds===undefined)이면 newThreads는 비고 nextIds는 현재 전체 집합', () => {
    const current = [makeThread('t1'), makeThread('t2')];
    const { newThreads, nextIds } = diffNewUnread(current, undefined);
    expect(newThreads).toEqual([]);
    expect(nextIds).toEqual(new Set(['t1', 't2']));
  });

  // TC-ALT-B1/B2: 이후 관측에서 새로 추가된 id만 newThreads로 골라내고, nextIds는 다음 baseline으로
  // 현재 전체 집합을 반환한다.
  it('증분(일부 ID 추가)이면 추가분만 newThreads로 반환', () => {
    const current = [makeThread('t1'), makeThread('t2'), makeThread('t3')];
    const lastKnownIds = new Set(['t1']);
    const { newThreads, nextIds } = diffNewUnread(current, lastKnownIds);
    expect(newThreads.map((t) => t.id)).toEqual(['t2', 't3']);
    expect(nextIds).toEqual(new Set(['t1', 't2', 't3']));
  });

  // TC-ALT-B3/B4: 무변화 또는 감소(추가 ID 없음)면 newThreads는 빈 배열.
  it('무변화/감소(추가 ID 없음)면 newThreads는 빈 배열', () => {
    const current = [makeThread('t1')];
    const lastKnownIds = new Set(['t1', 't2']); // t2는 이번엔 사라짐(감소) — 신규 없음
    const { newThreads, nextIds } = diffNewUnread(current, lastKnownIds);
    expect(newThreads).toEqual([]);
    expect(nextIds).toEqual(new Set(['t1']));
  });
});
