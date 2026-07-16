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
 *
 * starred-view 최종 리뷰(deep-reasoner) 발견: revalidate의 removal은 "왜 뷰를 떠났는지"를
 * 모른다 — 정의 라벨을 잃어서(예: unstar)인지, 배제 라벨을 얻어서(예: 외부에서 TRASH로 이동,
 * STARRED는 유지)인지 구분할 방법이 없다(fresh는 그 뷰에 없다는 사실만 알려줄 뿐, 스레드의
 * 실제 서버 라벨 전체를 알려주지 않는다). `applyLabelDelta`는 명시된 라벨만 벗기는 델타 병합이라,
 * INBOX/STARRED 뷰 중 하나에서만 벗기면 반대쪽 뷰의 정의 라벨이 캐시에 stale하게 남는다 — 예:
 * Starred 뷰를 보던 중 별표+인박스 스레드가 외부에서 휴지통으로 이동하면(서버=[TRASH,STARRED]),
 * STARRED만 벗기면 캐시가 [INBOX]로 남아 "0이어야 할" Inbox에 휴지통 메일이 새어 들어간다.
 * INBOX와 STARRED는 배제 3종(TRASH/SPAM/snoozed)이 동일해 서로 원인을 대신할 수 있으므로,
 * 이 두 뷰는 어느 쪽에서 벗겨지든 **둘 다** 벗긴다(inbox-zero-starred D4의 원래 근거를 유지 —
 * "무엇이 진짜 이유인지 모르니 둘 다 벗긴다"). 안전한 이유: 잘못 벗겨낸 라벨이 실제로는 아직
 * 유효하다면, 그 라벨이 정의하는 뷰 자신의 다음 revalidate가 fresh 응답의 전체 라벨로 그 행을
 * upsert해 스스로 복구한다(delta 병합이 아니라 서버 원본 그대로 덮어씀) — 그 외 라벨 뷰는
 * INBOX/STARRED와 배제 규칙을 공유하지 않으므로 자기 라벨만 벗긴다.
 */
export function viewMembershipLabels(viewLabel: string): string[] {
  return viewLabel === 'INBOX' || viewLabel === 'STARRED' ? ['INBOX', 'STARRED'] : [viewLabel];
}
