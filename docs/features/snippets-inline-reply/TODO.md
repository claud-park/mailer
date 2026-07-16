# snippets-inline-reply — TODO

> 2026-07-16 시작. 오케스트레이터 도출 UX 개선 3건 중 3번.

## Goal 0~4: 브레인스토밍·PRD·TC·DECISIONS
- [x] 대화형 확인(3건 세트로 함께 승인) — 사용자 확정
- [x] 설계 스펙 커밋(`docs/superpowers/specs/2026-07-16-ux-improvements-design.md`)
- [x] PRD.md / TC.md / DECISIONS.md

## Goal 5: 구현 (SDD)
- [ ] **단일 체크포인트 (renderer만, fast-worker/Sonnet)**: `ThreadView.tsx`의 `InlineReply` 컴포넌트에 Compose의 `insertSnippet` 패턴을 포팅(로컬 `snippetOpen`/`savedRangeRef` state, `onKeyDown`에 `⌘;` 분기 추가, `SnippetsPicker` 재사용). main 프로세스 변경 없음(다른 두 feature와 달리 순수 renderer 스코프) — 다른 두 CP와 완전 병렬 가능.
- [ ] **E2E (fast-worker/Sonnet, 위 완료 후)**: `e2e/run-tc.mjs` — `TC-SNIP-*` 7건 신설.

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
