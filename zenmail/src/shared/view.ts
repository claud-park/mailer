/**
 * inbox-zero-starred D1: 인박스 뷰 멤버십의 단일 소스 술어.
 * main(Mock provider·cache 리더)과 renderer(applyThreadsDiff·낙관 제거 판정)가 공유한다 —
 * 계층별 하드코딩이 어긋나는 것이 이번 버그의 축소판이었으므로 정의는 여기 한 곳에만 둔다.
 * Real provider는 이 술어를 Gmail q 문자열로 번역한다(gmail.ts inboxViewQuery — 형태만 다르고 의미 동일).
 *
 * 인박스 뷰 = (INBOX ∨ STARRED) ∧ ¬TRASH ∧ ¬SPAM ∧ ¬snoozed
 * — starred 스레드는 archived(done)여도 인박스에 남는다(스펙: Superhuman식 Done/Star 시맨틱).
 * snoozeLabelId는 동적(계정별 라벨 id)이라 인자로 받는다; 모르는 컨텍스트(null)에서는 snooze
 * 배제를 생략한다 — main 캐시 리더는 라벨 id 대신 로컬 truth인 snoozes 테이블로 배제한다.
 */
export function isInInboxView(labelIds: string[], snoozeLabelId?: string | null): boolean {
  if (labelIds.includes('TRASH') || labelIds.includes('SPAM')) return false;
  if (snoozeLabelId && labelIds.includes(snoozeLabelId)) return false;
  return labelIds.includes('INBOX') || labelIds.includes('STARRED');
}

/** 뷰 라벨이 INBOX면 인박스 술어, 그 외 라벨 뷰는 기존 단순 포함 판정. */
export function inLabelView(
  labelIds: string[],
  viewLabel: string,
  snoozeLabelId?: string | null
): boolean {
  if (viewLabel === 'INBOX') return isInInboxView(labelIds, snoozeLabelId);
  return labelIds.includes(viewLabel);
}

/**
 * SWR revalidate에서 "뷰를 떠났다"고 판정된 캐시 행에서 벗겨낼 라벨들.
 * INBOX 뷰의 fresh 페이지 부재는 "INBOX도 (유효한) STARRED도 아님"을 뜻하므로 둘 다 벗긴다.
 */
export function viewMembershipLabels(viewLabel: string): string[] {
  return viewLabel === 'INBOX' ? ['INBOX', 'STARRED'] : [viewLabel];
}
