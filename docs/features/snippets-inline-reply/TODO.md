# snippets-inline-reply — TODO

> 2026-07-16 시작. 오케스트레이터 도출 UX 개선 3건 중 3번.

## Goal 0~4: 브레인스토밍·PRD·TC·DECISIONS
- [x] 대화형 확인(3건 세트로 함께 승인) — 사용자 확정
- [x] 설계 스펙 커밋(`docs/superpowers/specs/2026-07-16-ux-improvements-design.md`)
- [x] PRD.md / TC.md / DECISIONS.md

## Goal 5: 구현 (SDD)
- [x] **CP-C (renderer만, fast-worker/Sonnet, 완전 독립 병렬)**: `ThreadView.tsx`의 `InlineReply`에 Compose의 `insertSnippet` 패턴 포팅.
- [x] **CP-D (E2E, fast-worker/Sonnet, 3건 통합)**: `TC-SNIP-*` 7건(A1~A5·G1·G2, B1/B2는 기존 `TC-DD-B*` 무회귀로 검증).

## Goal 6~7: 검증
- [x] (3건 통합) 최종 전체 브랜치 리뷰(deep-reasoner/Opus) — InlineReply 포팅 자체는 깨끗함(Compose와 상태 완전 독립, DOM 언마운트 없어도 Range 누수 없음). 오케스트레이터가 별도로 `SnippetPicker` 백드롭이 Shell 루트의 `relative`를 근거로 앱 전체를 정확히 덮는지 직접 확인(문제 없음).
- [x] (3건 통합) `/react-best-practices` — (none, 훅/재렌더 이슈 없음)
- [x] (3건 통합) `/code-review low` — (none)
- [x] `npx tsc --noEmit` + `npm test` 클린
- [x] E2E 전체 스위트 무회귀 — **250 PASS·0 FAIL·7 SKIP** 클린 확인(snippets-inline-reply 자체는 신규 SKIP 없음)

## Goal 8: 마무리
- [ ] (3건 통합) DEV_WORKFLOW 스냅샷·루트 TODO 갱신
- [ ] (3건 통합) 커밋·push
- [ ] (3건 통합) Obsidian ZenMail.md 체크포인트
