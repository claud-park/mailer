# multi-account — TODO

> 2026-07-14 시작. 설계 스펙: `docs/superpowers/specs/2026-07-14-multi-account-design.md`. 태스크 번호는 SDD 플랜(`.superpowers/sdd/`) Task 1~9와 1:1 매핑.

## Goal 1~4: 설계·문서 (Task 1)
- [x] PRD.md — 사용자 확정 4건·요구사항·범위(포함/제외)·성공 기준
- [x] TODO.md(본 문서) — Task 2~9 체크포인트 매핑
- [x] TC.md — If-When-Then, TC-MA-A1~E1
- [x] DECISIONS.md — D1~D7

## Goal 5: 구현 (Task 2~7)
- [x] **CP1 (Task 2)**: `src/main/accounts.ts` — accounts.json 레지스트리 + 전역 설정 KV + 레거시 마이그레이션(TDD, vitest 단위 테스트로 TC-MA-E1 검증)
- [x] **CP2 (Task 3)**: `cache.ts` → `AccountCache` 클래스 — 계정별 DB 핸들, DB-level 단위테스트
- [x] **CP3 (Task 4)**: Mock provider email 파라미터화 + `work@zenmail.app` 시드 + inboxUnreadCount
- [x] **CP4 (Task 5)**: 계약·컨텍스트 대전환 — auth/types/preload/ipc/sync-state/snooze/index + renderer 콜사이트
- [x] **CP5 (Task 6)**: 배지 갱신 + `accounts-changed` 데몬 push
- [x] **CP6 (Task 7)**: 전환 UI — 사이드바 계정 섹션 + ⌃1~⌃9 + kbar

## Goal 6~7: 검증 (Task 8)
- [x] `npx tsc --noEmit` + `npm test`(vitest) 클린
- [x] E2E TC-MA 7건(A1~D1, E1은 vitest로 별도 검증·E2E N/A) 신규 전건 PASS
- [x] 전체 스위트 캐논 무회귀(0 FAIL + SKIP ⊆ 캐논 집합) ×2연속 — 200 PASS·0 FAIL·6 SKIP
- [x] `/react-best-practices` + `/code-review low` 리뷰 반영

## Goal 8: 마무리 (Task 9)
- [x] 리뷰 게이트 통과 확인 — 최종 전체 브랜치 리뷰(Opus) With fixes → af93685, react-best-practices → 86be9ab, code-review low → (none)
- [x] DEV_WORKFLOW 스냅샷·루트 TODO 갱신
- [x] 커밋·push
- [x] Obsidian ZenMail.md 체크포인트
