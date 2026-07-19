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
- [x] **CP1 (main, fast-worker/Sonnet)**: `src/main/ipc.ts`(`AccountContext.lastKnownUnreadIds` 필드, `refreshBadges()`에 dock 배지 갱신, `mail:debug-inject-new-mail`), `src/main/notify.ts` 신규(`diffNewUnread`/`fireNewMailNotification`/`updateDockBadge`), `src/main/snooze.ts`(배지 루프 확장 — `n > ctx.unreadCount`일 때만 추가 조회), `src/main/gmail.ts`(`NEW_MAIL_QUERY` + Mock 특별취급 + `injectNewMail`), `notify.test.ts`(vitest 3케이스). tsc/vitest(198) 클린.
- [x] **CP2 (renderer, fast-worker/Sonnet, CP1과 병렬)**: `src/shared/types.ts`/`src/main/preload.ts`(`onNotificationActivate`), `src/renderer/hooks/useThreads.ts`(단건=`switchAccount`+`openThread`, 그룹=`setActiveLabel('INBOX')`). tsc 클린.
- [x] **CP3 (E2E, fast-worker/Sonnet, CP1+CP2 완료 후)**: `e2e/run-tc.mjs` — `runAltSession`(전용 fresh user-data-dir 세션) + `TC-ALT-A1~E3` 14건 신설 + 네이티브 OS Notification/포커스를 우회하는 디버그 훅 4종(`mail:debug-notification-log`/`debug-dock-badge`/`debug-set-window-focused`/`debug-notify-activate`). 최초 구현에서 CP3 자신이 킬된 후 오케스트레이터가 이어받아 검증 — E2E harness 자체 버그 1건 발견·수정(`sidebarNavActive`/`clickSidebarNav`가 unread 배지 숫자까지 포함된 textContent와 정확매칭 시도 → `tabsInfo`의 기존 배지-제거 패턴 재사용해 수정, TC-ALT-E3). 실인프라 인시던트 재발(`npm test`의 `pretest`가 better-sqlite3를 plain-Node ABI로 리빌드 → `electron-rebuild`로 즉시 복구, attachments feature 선례와 동일) — DEV_WORKFLOW.md에 상시 규약으로 명문화.

## Goal 6~7: 검증
- [x] 최종 전체 브랜치 리뷰(deep-reasoner/Opus) — Critical/Important 0건. Low 2건 발견·처리: ① 상세조회 실패 시 배지 카운트는 갱신되지만 그 배치의 알림은 유실될 수 있는 트레이드오프(주석 오류 동반) — 주석 정정 + DECISIONS D12로 문서화(수정 없이 유지, 배지 정확성 우선이 의도된 선택). ② macOS에서 창을 완전히 닫은 뒤 알림 클릭 시 재오픈 안 됨 — DECISIONS D13으로 백로그 이월.
- [x] `/react-best-practices` — (해당 없음, useThreads.ts 추가분은 기존 onSnoozeFired/onFollowupFired와 동일 패턴의 순수 IPC 구독이라 렌더링/재렌더 이슈 자체가 없음)
- [ ] `/code-review low` — 사용자 직접 실행 필요(model-invocation 비활성 커맨드)
- [x] `npx tsc --noEmit` + `npm test`(198 PASS) 클린
- [x] E2E 전체 스위트 무회귀 — 새 정책(일반 feature ×1)에 따라 1회, **0 FAIL·273 어서션**(TC-ALT-A1~E3 14건 전부 PASS 포함)

## Goal 8: 마무리
- [x] DEV_WORKFLOW 스냅샷·루트 TODO 갱신 + E2E 실행 비용 정책 신설 조항 추가
- [x] 커밋·push
- [x] Obsidian ZenMail.md 체크포인트
