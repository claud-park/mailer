# label-crud — TODO

> 2026-07-16 시작. 오케스트레이터 도출 UX 개선 3건 중 2번.

## Goal 0~4: 브레인스토밍·PRD·TC·DECISIONS
- [x] 대화형 브레인스토밍(삭제 확인 다이얼로그) — 사용자 확정
- [x] 설계 스펙 커밋(`docs/superpowers/specs/2026-07-16-ux-improvements-design.md`)
- [x] PRD.md / TC.md / DECISIONS.md

## Goal 5: 구현 (SDD)
- [x] **CP-A (main, fast-worker/Sonnet, undo-toast와 통합 배선)**: `GmailProvider.createLabel`/`deleteLabel`(Real+Mock, Mock은 D4 캐스케이드), `ZenmailApi`/`ipc.ts`/`preload.ts` 배선, `gmail.test.ts` 신규.
- [x] **CP-B (renderer, fast-worker/Sonnet, undo-toast와 통합 배선)**: `Sidebar.tsx` `+`버튼/인라인 입력/삭제 아이콘/`DeleteLabelDialog`, `store/mail.ts` `createLabel`/`deleteLabel` 액션.
- [x] **CP-D (E2E, fast-worker/Sonnet, 3건 통합)**: `TC-LBL-*` 11건(A1~A5·B1~B5·G1·G2, A5는 실패주입 훅 부재로 SKIP·문서화).

## Goal 6~7: 검증
- [x] (3건 통합) 최종 전체 브랜치 리뷰(deep-reasoner/Opus) — label-crud 자체는 별도 결함 없음(Sidebar 다이얼로그 스테일 참조·이중 loadThreads 등 가설 전부 기각).
- [x] (3건 통합) `/react-best-practices` — (해당 없음)
- [x] (3건 통합) `/code-review low` — (none)
- [x] `npx tsc --noEmit` + `npm test` 클린(vitest 195 PASS)
- [x] E2E 전체 스위트 무회귀 — **250 PASS·0 FAIL·7 SKIP** 클린 확인(TC-LBL-A5는 의도된 SKIP)

## Goal 8: 마무리
- [x] (3건 통합) DEV_WORKFLOW 스냅샷·루트 TODO 갱신
- [x] (3건 통합) 커밋·push
- [x] (3건 통합) Obsidian ZenMail.md 체크포인트
