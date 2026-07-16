# undo-toast — TODO

> 2026-07-16 시작. 오케스트레이터 도출 UX 개선 3건 중 1번.

## Goal 0~4: 브레인스토밍·PRD·TC·DECISIONS
- [x] 대화형 브레인스토밍(대상 4종, undo 창) — 사용자 확정
- [x] 설계 스펙 커밋(`docs/superpowers/specs/2026-07-16-ux-improvements-design.md`)
- [x] PRD.md / TC.md / DECISIONS.md

## Goal 5: 구현 (SDD)
- [x] **CP-A (main+shared types, fast-worker/Sonnet, label-crud와 통합 배선)**: `cancelSnooze` IPC/타입/브릿지.
- [x] **CP-B (renderer, fast-worker/Sonnet, label-crud와 통합 배선)**: `toast` state `{msg, undo?}` 확장, 4종 단건+4종 벌크 undo 배선, `Toasts.tsx` Undo 버튼.
- [x] **CP-D (E2E, fast-worker/Sonnet, 3건 통합)**: `TC-UNDO-*` 9건(A1~A5·B1·C1·G1·G2).

## Goal 6~7: 검증
- [x] (3건 통합) 최종 전체 브랜치 리뷰(deep-reasoner/Opus) — Important 1건(applyLabel undo가 이미 있던 라벨을 영구 제거, D8로 수정) + Minor 3건(D9, self-healing으로 수용) 발견. `mail:cancel-snooze` 캐시 즉시반영 시도는 E2E 회귀(TC-UNDO-A4) 2/2 재현으로 되돌림(원인 미확정, 후속 과제).
- [x] (3건 통합) `/react-best-practices` — (해당 없음, 순수 로직/데이터 변경)
- [x] (3건 통합) `/code-review low` — (none)
- [x] `npx tsc --noEmit` + `npm test` 클린(vitest 195 PASS)
- [x] E2E 전체 스위트 무회귀 — revert 반영 후 **250 PASS·0 FAIL·7 SKIP** 클린 확인(캐논 5+신규 2: TC-UNDO-B1/TC-LBL-A5)

## Goal 8: 마무리
- [ ] (3건 통합) DEV_WORKFLOW 스냅샷·루트 TODO 갱신
- [ ] (3건 통합) 커밋·push
- [ ] (3건 통합) Obsidian ZenMail.md 체크포인트
