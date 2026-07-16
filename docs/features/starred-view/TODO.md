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
- [x] **선행 단계(오케스트레이터 직접, TDD)**: `src/shared/view.ts` — `isInInboxView` 순수 INBOX로 축소, 신규 `isInStarredView`, `inLabelView` 양쪽 분기, `viewMembershipLabels` 단순화 + `view.test.ts` 진리표 갱신(vitest 26 PASS). CP1/CP2가 공유 의존하므로 먼저 완료 — 병렬 착수 가능해짐.
- [x] **CP1 (main, fast-worker/Sonnet)**: `gmail.ts`(Real STARRED q 번역 — 기존 INBOX q도 순수 `in:inbox`로 동반 수정, `matchesSingleLabelView` 공용 헬퍼, Mock STARRED 필터+시드 라벨+`__debugExternalUnstar` 훅), `cache.ts`(`getThreads`/`getViewRows` STARRED SQL 분기, INBOX SQL의 STARRED OR절 제거), `ipc.ts`+`preload.ts`+`types.ts`(externalUnstar 디버그 IPC 배선) + `cache.test.ts` STARRED 커버리지 4건. vitest 193 PASS. 오케스트레이터가 work 데모 계정 시드에도 STARRED 라벨 누락분 발견·추가(패리티, 별도 커밋).
- [x] **CP2 (renderer, fast-worker/Sonnet, CP1과 병렬)**: `store/mail.ts`(`archiveThread` 게이트를 INBOX∪STARRED로 확장 + 뷰 라벨 표현 통일, `toggleStar` unstar의 `viewLabel !== 'INBOX'` 단축조건 제거), `Sidebar.tsx`(STARRED 시스템 항목+배지), `CommandPalette.tsx`(`g t` 액션, 기존 `g s`=Sent 무변경). store 레벨 유닛 테스트는 기존에도 없는 패턴이라 추가 안 함(E2E가 검증 — CP3).
- [x] **CP3 (E2E, fast-worker/Sonnet, CP1+CP2 완료 후)**: `e2e/run-tc.mjs` — `TC-IZ-B1/B2/B7` 반전 재작성, `TC-IZ-B3`를 `TC-STAR-B3`로 이관, `TC-IZ-A2` 단순화(STARRED 분기 삭제), `TC-STAR-*` 8건 신설(B1~B6·C1·D1·D2, B2/B4/B5/B6은 대응 TC-IZ 시나리오와 액션 통합). 전체 스위트 **224 PASS·0 FAIL·5 SKIP**(캐논 SKIP 집합 동일, 기존 216 PASS 대비 +8). 세션 오케스트레이션 메모: 서브에이전트가 백그라운드 프로세스 완료 알림을 못 받는 채로 2회 공회전 — 오케스트레이터가 PID를 직접 관찰해 개입 후 정상 완료·커밋 확인.

## Goal 6~7: 검증
- [x] 최종 전체 브랜치 리뷰(deep-reasoner/Opus) — Important 1건 발견·수정: `viewMembershipLabels`의 단일-라벨 축소가 cross-view stale 라벨 누수를 만듦(외부 trash된 별표 스레드의 stale INBOX가 캐시에 남아 "0이어야 할" Inbox로 샐 수 있었음) → INBOX/STARRED 어느 쪽에서 벗겨지든 둘 다 벗기도록 복원(D9), 안전성은 반대쪽 뷰의 다음 revalidate가 서버 원본으로 self-heal함을 근거로 증명. archive/toggleStar 게이트 확장은 4칸 매트릭스 전체 무결 확인(수정 불요).
- [x] `/react-best-practices` — (none, 순수 데이터/로직 변경이라 해당 없음)
- [x] `/code-review low` — (none, 2회 패스 후 확정)
- [x] `npx tsc --noEmit` + `npm test` 클린 (vitest 193 PASS)
- [x] E2E 전체 스위트 무회귀 ×2연속 — 리뷰 수정 반영 전 2회(224 PASS·0 FAIL·5 SKIP, 캐논 집합 동일) + 수정 반영 후 1회(동일 결과) = 총 3회 결정적

## Goal 8: 마무리
- [ ] DEV_WORKFLOW 스냅샷·루트 TODO 갱신
- [ ] 커밋·push
- [ ] Obsidian ZenMail.md 체크포인트
