# starred-view — PRD

> 2026-07-16 · 사용자 요청: "starred 는 따로 split inbox or category로 보이게 변경. default inbox should be zeroed out". 브레인스토밍 설계 스펙: `docs/superpowers/specs/2026-07-16-starred-view-design.md`.
> **선행 결정 supersede**: `docs/features/inbox-zero-starred/DECISIONS.md` D1/D2/D4/D7 — "인박스 뷰 = INBOX ∪ STARRED"(archived-starred를 인박스에 편입)와 "사이드바 Starred 전용 뷰는 논스코프"를 사용자가 이번 세션에서 정반대로 재확정.

## 문제

`inbox-zero-starred`(2026-07-14)가 Inbox 뷰 술어를 `INBOX ∪ STARRED`로 바꾸면서, archive된(=INBOX 라벨 없음) 스레드도 STARRED이기만 하면 Inbox 목록에 영구 편입되게 됐다. 이는 당시엔 의도된 설계(Superhuman식 Done/Star)였지만, 실사용해보니 "Inbox가 진짜 0건이어도 별표 때문에 절대 안 비워짐"이 오히려 불편함 — 사용자가 다시 분리를 요청했다. Starred는 archive 여부와 무관하게 항상 찾을 수 있어야 하지만, 그 자리는 Inbox가 아니라 전용 카테고리여야 한다.

## 요구사항

### R1. Inbox 뷰 = 순수 INBOX 라벨
- Inbox·split 탭 목록은 `INBOX ∧ ¬TRASH ∧ ¬SPAM ∧ ¬snoozed`만 반영(STARRED 유니온 제거).
- 실계정 Gmail 웹 `in:inbox`가 0건이면 ZenMail Inbox도 0건으로 수렴(inbox-zero 도달 가능).
- 데모(Mock)·실계정(Real)·캐시 리더 3곳 시맨틱 일치(inbox-zero-starred D1의 "단일 공유 술어" 원칙 유지, 술어 내용만 변경).

### R2. Starred 전용 뷰 (사이드바 시스템 항목)
- 사이드바에 "Starred" 고정 항목 추가(Inbox 다음, Sent 앞). Split Inbox on/off와 무관하게 항상 노출.
- 뷰 술어 = `STARRED ∧ ¬TRASH ∧ ¬SPAM ∧ ¬snoozed`(archive 여부 무관 — Gmail의 `is:starred`와 동치).
- 안읽음 배지 노출(Inbox와 동일 패턴, `labels` 배열의 STARRED 엔트리 unreadCount).
- 단축키 `g t`(kbar Navigation 섹션, 기존 `g s`=Go to sent는 유지).

### R3. 뷰 간 상호작용 일관성
- Inbox에서 archive: 행 무조건 제거(더 이상 "starred면 유지" 없음 — R1으로 자동 성립).
- Starred에서 archive: 행 유지(archive는 INBOX만 벗기고 STARRED는 안 건드림 — Gmail 그대로).
- Inbox에서 unstar: 행 유지(Inbox는 STARRED 무관).
- Starred에서 unstar: STARRED 제거되는 순간 행도 즉시 제거.
- 기존 star 토글(`s`)·★ 인디케이터(ThreadRow/ThreadView, inbox-zero-starred D7 산출물)는 UI 변경 없이 재사용.

## 논스코프
- Starred 안의 Split 탭·커스텀 규칙 — flat list(Sent/Drafts와 동격).
- 사이드바 Starred 항목에 ★ 글리프 장식 — 텍스트 라벨("Starred")로 충분.
- 계정별 Starred 커스터마이즈(색상 등) — Gmail 표준 STARRED 라벨 그대로.
- label 사이드바 추가·삭제 CRUD — 별도 feature(사용자가 별도 세션으로 분리 요청).

## 성공 기준
- 데모: Inbox에 archived-starred 스레드가 하나도 안 보이고, Inbox가 실제로 0건이면 empty state 도달. Starred 뷰에는 archive 여부와 무관하게 모든 STARRED 스레드가 보임.
- E2E: `TC-IZ-*`(9건)를 새 시맨틱에 맞게 재작성 + 신규 `TC-STAR-*` 전건 PASS + 전체 스위트 무회귀(0 FAIL + SKIP ⊆ 캐논 집합) ×2연속.
