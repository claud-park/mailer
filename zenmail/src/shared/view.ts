/**
 * starred-view D3: 인박스 뷰 멤버십의 단일 소스 술어 — 순수 INBOX 라벨(STARRED 유니온은
 * inbox-zero-starred D1에서 도입했다가 이번에 제거, 사용자가 "Inbox는 항상 0으로 수렴해야
 * 한다"고 재확정). main(Mock provider·cache 리더)과 renderer(applyThreadsDiff·낙관 제거
 * 판정)가 공유한다 — 계층별 하드코딩이 어긋나는 것이 inbox-zero-starred 버그의 축소판이었으므로
 * 정의는 여기 한 곳에만 둔다. Real provider는 이 술어를 Gmail q 문자열로 번역한다(gmail.ts).
 *
 * 인박스 뷰 = INBOX ∧ ¬TRASH ∧ ¬SPAM ∧ ¬snoozed
 * snoozeLabelId는 동적(계정별 라벨 id)이라 인자로 받는다; 모르는 컨텍스트(null)에서는 snooze
 * 배제를 생략한다 — main 캐시 리더는 라벨 id 대신 로컬 truth인 snoozes 테이블로 배제한다.
 */
export function isInInboxView(labelIds: string[], snoozeLabelId?: string | null): boolean {
  if (labelIds.includes('TRASH') || labelIds.includes('SPAM')) return false;
  if (snoozeLabelId && labelIds.includes(snoozeLabelId)) return false;
  return labelIds.includes('INBOX');
}

/**
 * starred-view D1/D2: Starred 전용 뷰 술어(사이드바 시스템 항목). archive 여부(INBOX 라벨
 * 유무)와 무관하게 STARRED 라벨만 보되, Inbox 뷰와 동일한 exclusion 3종(TRASH/SPAM/snoozed)을
 * 그대로 적용한다 — Gmail의 `is:starred`에서 휴지통·스팸·스누즈만 뺀 것과 동치.
 *
 * Starred 뷰 = STARRED ∧ ¬TRASH ∧ ¬SPAM ∧ ¬snoozed
 */
export function isInStarredView(labelIds: string[], snoozeLabelId?: string | null): boolean {
  if (labelIds.includes('TRASH') || labelIds.includes('SPAM')) return false;
  if (snoozeLabelId && labelIds.includes(snoozeLabelId)) return false;
  return labelIds.includes('STARRED');
}

/** 뷰 라벨이 INBOX/STARRED면 각각의 전용 술어, 그 외 라벨 뷰는 단순 포함 판정. */
export function inLabelView(
  labelIds: string[],
  viewLabel: string,
  snoozeLabelId?: string | null
): boolean {
  if (viewLabel === 'INBOX') return isInInboxView(labelIds, snoozeLabelId);
  if (viewLabel === 'STARRED') return isInStarredView(labelIds, snoozeLabelId);
  return labelIds.includes(viewLabel);
}

/**
 * SWR revalidate에서 "뷰를 떠났다"고 판정된 캐시 행에서 벗겨낼 라벨들.
 * INBOX∪STARRED 유니온 제거로 모든 뷰가 단일 라벨이 됐다 — 뷰 라벨 자신만 벗긴다.
 */
export function viewMembershipLabels(viewLabel: string): string[] {
  return [viewLabel];
}
