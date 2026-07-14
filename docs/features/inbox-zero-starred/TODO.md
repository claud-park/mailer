# inbox-zero-starred — TODO

> 2026-07-14 시작. 버그(외부 아카이브 미수렴) + 제품 요구(starred는 done에도 표시) 동시 처리.

## Goal 0~1: 진단·PRD
- [x] 실계정 근본 원인 확정: Gmail 웹 in:inbox=0 vs ZenMail 84행 — SWR revalidate removal 미계산 + 60s 폴 수렴 루프 깨짐 (PRD.md)
- [x] 캐시 DB 포렌식(84행 upsert 타임라인, mutations 큐 0건) + `in:inbox OR is:starred` 실계정 시맨틱 검증(starred-archived 20건)
- [x] PRD.md

## Goal 2~4: 설계
- [x] deep-reasoner(Opus) 독립 2인스턴스 병렬 설계 → 합성 (DECISIONS D1~D9; Codex 한도 불참 명시)
- [x] TC.md (If-When-Then, TC-IZ-*)
- [x] src/shared/view.ts 술어 신설(공유 상수 선생성 관례)

## Goal 5: 구현
- [x] CP1 main: cache.ts(getViewRows·snoozes 배제 getThreads·로컬-델타 타임스탬프), ipc.ts(revalidate removals+3중 가드), gmail.ts(Real q 번역·Mock 술어·시드 2종·__debugExternalArchive 훅) — 병렬 fast-worker(Opus)
- [x] CP2 renderer: store(applyThreadsDiff 술어·archiveThread starred 분기·toggleStar), optimistic 헬퍼, ThreadRow/ThreadView ★, kbar `s`·shortcuts 카탈로그 — 병렬 fast-worker(Sonnet)
- [x] CP3 vitest: view/cache/revalidate-diff/optimistic/splits (TC.md 커버리지 맵) — 154 PASS·0 FAIL

## Goal 6~7: 검증
- [x] `npx tsc --noEmit` + `npm test` 클린
- [x] E2E TC-IZ-A(3)+B(6) 신규 전건 PASS + 전체 스위트 183+9 PASS·0 FAIL·6 SKIP ×2연속(SKIP=캐논 집합 정확 일치) — fast-worker(Opus)가 하네스 작성, 오케스트레이터가 베이스라인 worktree 대조로 회귀 4건(TC-FUP-D2/E2·TC-SP-C2·TC-SY-B5) 확정 후 근본원인 수정
- [x] /react-best-practices(ThreadView 인라인 중복 제거) + /code-review low(2건: getThreads 언더페치 SQL 수정, Mock/Real provider q 분기 parity) — 둘 다 수정 반영, 재검증 0 FAIL 유지
- [x] 실계정 스모크: `npm start`(real OAuth, 사용자 실DB)로 인박스 뷰 확인 — 결과는 DECISIONS D12 참조

## Goal 8: 마무리
- [x] DEV_WORKFLOW 스냅샷·루트 TODO 갱신
- [ ] 커밋·push
- [ ] Obsidian ZenMail.md 체크포인트
