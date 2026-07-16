# undo-toast — TODO

> 2026-07-16 시작. 오케스트레이터 도출 UX 개선 3건 중 1번.

## Goal 0~4: 브레인스토밍·PRD·TC·DECISIONS
- [x] 대화형 브레인스토밍(대상 4종, undo 창) — 사용자 확정
- [x] 설계 스펙 커밋(`docs/superpowers/specs/2026-07-16-ux-improvements-design.md`)
- [x] PRD.md / TC.md / DECISIONS.md

## Goal 5: 구현 (SDD)
- [ ] **CP1 (main+shared types, fast-worker/Sonnet)**: `src/shared/types.ts`에 `ZenmailApi.cancelSnooze(accountId, threadId): Promise<void>` 추가, `src/main/ipc.ts`에 `mail:cancel-snooze` 핸들러(캐시 `removeSnooze` + `modifyLabels`로 원래 라벨 복원), `src/main/preload.ts` 브릿지.
- [ ] **CP2 (renderer, fast-worker/Sonnet, CP1과 병렬 — cancelSnooze는 타입 계약만 있으면 되므로 CP1 완료 전 착수 가능)**: `store/mail.ts` — `toast` state를 `{msg, undo?}` 형태로 확장, `showToast` 오버로드, `archiveThread`/`trashThread`/`applyLabel`/`snoozeThread`(단건) + `archiveSelected`/`trashSelected`/`applyLabelSelected`/`snoozeSelected`(벌크) 각각에 5초 capture+undo 콜백 배선. `Toasts.tsx`에 Undo 버튼 UI(기존 `UndoSendToast` 시각 패턴 재사용).
- [ ] **CP3 (E2E, fast-worker/Sonnet, CP1+CP2 완료 후)**: `e2e/run-tc.mjs` — `TC-UNDO-*` 8건 신설, 전체 스위트 자가 검증.

## Goal 6~7: 검증
- [ ] (3건 통합) 최종 전체 브랜치 리뷰
- [ ] (3건 통합) `/react-best-practices`
- [ ] (3건 통합) `/code-review low`
- [ ] `npx tsc --noEmit` + `npm test` 클린
- [ ] E2E 전체 스위트 무회귀 ×2연속

## Goal 8: 마무리
- [ ] (3건 통합) DEV_WORKFLOW 스냅샷·루트 TODO 갱신
- [ ] (3건 통합) 커밋·push
- [ ] (3건 통합) Obsidian ZenMail.md 체크포인트
