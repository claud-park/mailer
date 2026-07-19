# new-mail-alerts — TODO

> 2026-07-19 시작. 사용자 요청: "새로운 메일이 도착했을 때 app alert(badge + push alert) 기능 추가".

## Goal 0~1: 브레인스토밍·PRD
- [x] 대화형 브레인스토밍 8문항(계정 범위/판정 기준/알림 내용/클릭 동작/포커스 억제/설정 토글/E2E 훅/혼합 계정 그룹) — 전부 사용자 확정
- [x] 기존 배지·알림·새 메일 감지 파이프라인 전수 조사(Explore 에이전트) — dock 배지·`Notification` API 전무 확인, 기존 `snooze.ts`/`ipc.ts` 배지 데몬만 존재
- [x] 브레인스토밍 설계 스펙 커밋(`docs/superpowers/specs/2026-07-19-new-mail-alerts-design.md`)
- [x] PRD.md

## Goal 2~4: TC·DECISIONS
- [x] TC.md(If-When-Then, TC-ALT-* 신규 7섹션 A~F)
- [x] DECISIONS.md(D1~D6 사용자 확정 + D7~D11 추천안)

## Goal 5: 구현 (SDD — 체크포인트별 fresh subagent + 리뷰 게이트)
- [ ] **CP1 (main, fast-worker/Sonnet)**: `src/main/ipc.ts`(`AccountContext.lastKnownUnreadIds` 필드 추가, `refreshBadges()`에 dock 배지 갱신 추가·알림 로직은 안 건드림, 신규 `mail:debug-inject-new-mail` 디버그 IPC), `src/main/notify.ts` 신규(`diffNewUnread` 순수 함수, `fireNewMailNotification`, `updateDockBadge`), `src/main/snooze.ts`(배지 루프를 `n > ctx.unreadCount`일 때만 추가 조회하도록 확장 + 틱 종료 시 `updateDockBadge`/`fireNewMailNotification` 호출), `src/main/gmail.ts`(Mock `listThreads`에 Inbox∪Starred unread 필터 대응 — 필요 시 `isInInboxView`/`isInStarredView` 조합 쿼리 지원 확인·보강), `notify.test.ts`(vitest 3케이스).
- [ ] **CP2 (renderer, fast-worker/Sonnet, CP1과 병렬 가능 — IPC 계약은 설계 스펙에 이미 확정)**: `src/shared/types.ts`(`onNotificationActivate` 시그니처), `src/main/preload.ts`(대칭 브리지), `src/renderer/hooks/useThreads.ts`(구독 배선 — payload 있으면 `setActiveAccount`+`openThread`, 없으면 활성 계정 Inbox 유지).
- [ ] **CP3 (E2E, fast-worker/Sonnet, CP1+CP2 완료 후)**: `e2e/run-tc.mjs` — `TC-ALT-*` A~F 전건 신설. 전체 스위트 무회귀 확인.

## Goal 6~7: 검증
- [ ] 최종 전체 브랜치 리뷰(deep-reasoner/Opus)
- [ ] `/react-best-practices`
- [ ] `/code-review low`
- [ ] `npx tsc --noEmit` + `npm test` 클린
- [ ] E2E 전체 스위트 무회귀 ×2연속

## Goal 8: 마무리
- [ ] DEV_WORKFLOW 스냅샷·루트 TODO 갱신
- [ ] 커밋·push
- [ ] Obsidian ZenMail.md 체크포인트
