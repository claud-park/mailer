# starred-view — TODO

> 2026-07-16 시작. 사용자 요청(버그 3건 세션에 이은 두 번째 요청): starred 전용 뷰 분리 + Inbox zeroed-out.

## Goal 0~1: 브레인스토밍·PRD
- [x] 대화형 브레인스토밍 4문항(배치/범위/Inbox 정의/단축키) — 전부 사용자 확정
- [x] 코드베이스 INBOX 특수 케이스 전수 조사(Explore 에이전트) — view.ts/gmail.ts/cache.ts/ipc.ts/mail.ts/splits.ts/e2e 7개 지점
- [x] 브레인스토밍 설계 스펙 커밋(`docs/superpowers/specs/2026-07-16-starred-view-design.md`)
- [x] PRD.md

## Goal 2~4: TC·DECISIONS
- [x] TC.md(If-When-Then, TC-STAR-* 신규 + TC-IZ-* 재작성 매핑)
- [x] DECISIONS.md(D1~D4 사용자 확정 + D5~D8 추천안)

## Goal 5: 구현 (SDD — 체크포인트별 fresh subagent + 리뷰 게이트)
- [ ] **선행 단계(오케스트레이터 직접, TDD)**: `src/shared/view.ts` — `isInInboxView` 순수 INBOX로 축소, 신규 `isInStarredView`, `inLabelView` 양쪽 분기, `viewMembershipLabels` 단순화 + `view.test.ts` 진리표 갱신. CP1/CP2가 공유 의존하므로 먼저 완료해야 병렬 착수 가능.
- [ ] **CP1 (main, fast-worker/Sonnet)**: `gmail.ts`(Real STARRED q 번역, Mock STARRED 필터+시드 라벨+`__debugExternalUnstar` 훅, "단일 라벨+!q" 가드 공용 헬퍼로 정리), `cache.ts`(`getThreads`/`getViewRows` STARRED SQL 분기), `ipc.ts`(externalUnstar 디버그 IPC 배선, 기존 externalArchive 패턴 대칭) + 해당 vitest.
- [ ] **CP2 (renderer, fast-worker/Sonnet, CP1과 병렬)**: `store/mail.ts`(`archiveThread`/`toggleStar` 게이트를 INBOX∪STARRED로 확장, DECISIONS D5 그대로), `Sidebar.tsx`(STARRED 시스템 항목+배지), `CommandPalette.tsx`(`g t` 액션) + 해당 vitest(게이트 매트릭스 유닛).
- [ ] **CP3 (E2E, fast-worker/Sonnet, CP1+CP2 완료 후)**: `e2e/run-tc.mjs` — TC-IZ-B1/B2/B3/B7 재작성(TC.md 매핑대로), TC-STAR-* 전건 신설, 전체 스위트 1회 실행으로 자가 검증.

## Goal 6~7: 검증
- [ ] 최종 전체 브랜치 리뷰(deep-reasoner/Opus) — 게이트 확장(archive/unstar) 안전성 중점
- [ ] `/react-best-practices`
- [ ] `/code-review low`
- [ ] `npx tsc --noEmit` + `npm test` 클린
- [ ] E2E 전체 스위트 무회귀 ×2연속(TC-STAR-G1~G3)

## Goal 8: 마무리
- [ ] DEV_WORKFLOW 스냅샷·루트 TODO 갱신
- [ ] 커밋·push
- [ ] Obsidian ZenMail.md 체크포인트
