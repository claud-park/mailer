# F2 follow-up-reminders — Checkpoint TODO

> Goal 2 산출물. 각 CP는 `npx tsc --noEmit` 통과. Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## CP0. 설계 (Goal 0~4)
- [x] 탐사(스누즈 데몬/send 경로/답장 프리미티브) + send() void 갭 식별
- [x] deep-reasoner + Codex 병렬 설계 → 합성 (D4~D10)
- [x] PRD/TODO/TC/DECISIONS 작성

## CP1. main 배관 (UI 무변경)
- [ ] `gmail.ts`: `SendResult` 타입, `GmailProvider.send → Promise<SendResult>` (Real: res.data 반환 / Mock: 내부 계산 반환)
- [ ] `cache.ts`: followups 테이블 + CRUD 5종 (add/due/setFired/remove/list)
- [ ] `ipc.ts`: undo 콜백 send 성공 후 등록 + `remindDays` 처리, followup IPC 4종(add/cancel/dismiss/list), fetch-thread 기회적 조기 해제, signOut 시 followups 정리
- [ ] `snooze.ts`: tick 세 번째 루프(답장 체크→해제/재부상), 예약전송 send 성공 후 등록, `runDaemonTickNow` export, `mail:followup-fired` 이벤트
- [ ] 디버그 IPC: `__debugSimulateReply`(mock simulateReply 헬퍼 신설) + `__debugTick` (`ZENMAIL_E2E_PORT` && demo 가드)
- [ ] `shared/types.ts`: SendRequest.remindDays, ZenmailApi 확장, preload expose
- [ ] tsc 통과

## CP2. Compose 리마인드
- [ ] Remind popover(프리셋 2d/3d/1w+커스텀, Schedule popover 패턴) + 설정 pill(✕ 해제)
- [ ] doSend에 remindDays 배선, 기본값 settings KV(`followupDefaultDays`)
- [ ] tsc 통과

## CP3. 기존 스레드 + 마커
- [ ] `FollowupPicker.tsx` 모달(SnoozePicker 셸, 프리셋 상수 공유), store open/schedule/cancel/dismiss 액션
- [ ] CommandPalette `h` 액션("Remind me…"), pending 스레드에서 Cancel reminder 노출
- [ ] store `followups` Map 동기화(init·threads-updated), onFollowupFired → toast
- [ ] ThreadView pending/fired 배너, ThreadList fired 칩
- [ ] tsc 통과

## CP4. 최상단 핀 (격리 — F1 회귀 게이트)
- [ ] `lib/splits.ts` `selectVisibleThreads`에 pinnedIds 파라미터(핀 우선 정렬), 3중 미러 호출부에 fired ids 전달
- [ ] vitest: 핀 정렬·selectedIndex 일관성 케이스 추가
- [ ] **F1 vitest 전체 + F1 E2E TC 회귀 그린 확인**
- [ ] tsc 통과

## CP5. E2E (Goal 7)
- [ ] run-tc.mjs에 F2 시나리오 추가(무답장 재부상·답장 조용한 해제·undo 미등록·예약+리마인드·핀·취소/Dismiss)
- [ ] F1+F2 전체 TC 그린

## 게이트 (Goal 5~8)
- [ ] /react-best-practices 리뷰
- [ ] UI audit (web-design-guidelines — /impeccable 대체, F1 D14)
- [ ] /code-review low → 커밋 → push
- [ ] Obsidian 체크포인트 + 루트 TODO/DEV_WORKFLOW 갱신
