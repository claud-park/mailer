import type { FetchThreadsResponse, ThreadSummary } from '../shared/types';

/**
 * inbox-zero-starred D3/D4: SWR revalidate의 순수 diff 계산기.
 * ipc.ts의 mail:fetch-threads warm-cache 경로가 fresh 페이지를 받은 뒤 이 함수로
 * upsert(변경/신규)·removal(외부에서 뷰를 떠난 행)·캐시에 기록할 fresh 행을 산출한다.
 * DB·프로바이더 의존성 없이 규칙만 담아 단위 테스트가 가능하도록 분리했다.
 */

export interface RevalidateOpts {
  /** 로컬 낙관 뮤테이션/pending으로 보호된 id — upsert·removal·캐시기록 3곳 모두에서 제외(D3). */
  guarded: (id: string) => boolean;
  /** snoozed id — 캐시 기록/upsert에서 제외하되 present로는 카운트(D6). */
  isSnoozed: (id: string) => boolean;
}

export interface RevalidateDiff {
  upserts: ThreadSummary[];
  removals: string[];
  freshRowsToCache: ThreadSummary[];
}

export function computeRevalidateDiff(
  cached: ThreadSummary[],
  fresh: FetchThreadsResponse,
  viewRows: { id: string; date: number }[],
  opts: RevalidateOpts
): RevalidateDiff {
  const { guarded, isSnoozed } = opts;

  // 캐시에 기록할 fresh 행: 가드된(로컬 낙관/pending) id와 snoozed id는 제외한다 —
  // 가드는 스테일 fresh가 낙관 상태를 덮는 것을, snooze 제외는 인박스 재유입을 막는다.
  const freshRowsToCache = fresh.threads.filter((t) => !guarded(t.id) && !isSnoozed(t.id));

  // 부재 판정 기준 id 집합은 fresh 전체(snoozed 포함) — snoozed 스레드의 캐시 행이 removal
  // 후보가 되지 않도록 "여전히 존재"로 센다(캐시엔 안 쓰지만 present로는 카운트).
  const freshIds = new Set(fresh.threads.map((t) => t.id));

  // nextPageToken 없음 = 그 뷰의 전수(complete) → 부재 행은 모두 제거 후보.
  // 있음 = 부분 창 → date ≥ min(fresh date)인 부재 행만 제거, 더 오래된 행은 판단 보류(D4).
  const complete = !fresh.nextPageToken;
  const oldest = fresh.threads.reduce((m, t) => Math.min(m, t.date), Infinity);

  const removals = viewRows
    .filter((r) => !freshIds.has(r.id) && !guarded(r.id) && (complete || r.date >= oldest))
    .map((r) => r.id);

  // upsert: 캐시에 기록할 fresh 행 중, 반환했던 cached 페이지의 동일 id JSON과 다른 것
  // (캐시에 없던 신규도 변경으로 간주) — ipc.ts의 기존 인라인 diff와 동일한 규칙.
  const prev = new Map(cached.map((t) => [t.id, JSON.stringify(t)]));
  const upserts = freshRowsToCache.filter((t) => prev.get(t.id) !== JSON.stringify(t));

  return { upserts, removals, freshRowsToCache };
}
