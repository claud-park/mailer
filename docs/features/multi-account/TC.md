# multi-account — TC (If-When-Then)

> E2E 프리픽스 `TC-MA-*` (e2e/run-tc.mjs). 데모 하네스: 앱이 `demo@zenmail.app`(기본 활성) + `work@zenmail.app` 2계정으로 기동(design spec R7). TC-MA-E1은 vitest 단위 테스트로 검증(Task 2), E2E에선 N/A.

## 결과 (2026-07-15, `node e2e/run-tc.mjs` 2연속 — Task 8)

| TC | 상태 | 비고 |
| --- | --- | --- |
| TC-MA-A1 | **PASS** ×2 | 사이드바 아바타 aria-label 2건(demo·work) + active=demo(bg-accent) + 인박스 첫 행 = 데모 시드 "Q3 roadmap review" |
| TC-MA-A2 | **PASS** ×2 | ⌃2 후 "W: Acme renewal contract" 표시 ∧ "Q3 roadmap review" 미표시 |
| TC-MA-A3 | **PASS** ×2 | ⌃1 후 demo 복귀 + row 0 단일 선택(selectedIndex 리셋) |
| TC-MA-B1 | **PASS** ×2 | work "W: Kickoff notes" 아카이브 → demo 무영향 → work 재전환 시 아카이브 유지 |
| TC-MA-B2 | **PASS** ×2 | work 스레드 과거 시각 스누즈(커스텀 datetime, −1h) → demo 전환 → `__debugTick` → work 복귀 시 인박스 복귀 |
| TC-MA-C1 | **PASS** ×2 | demo에서 `W:` 검색 0건 ∧ To-자동완성 "client" 입력에 `client@acme.example` 미노출 |
| TC-MA-D1 | **PASS** ×2 | work 활성 상태에서 `__debugSimulateReply('work_3')` → demo 전환+tick → work 아바타 배지 2→3 |
| TC-MA-E1 | **PASS** (vitest) | Task 2 단위 테스트 — E2E N/A |
| TC-MA-G1 | **PASS** ×2 | `npx tsc --noEmit` exit 0 (TC-KM-G3 게이트로 확인) |
| TC-MA-G2 | **PASS** ×2 | `npm test`(vitest) exit 0 (TC-KM-G2 게이트로 확인) |
| TC-MA-G3 | **PASS** ×2 | 전체 스위트 200 PASS / 0 FAIL / 6 SKIP(={A4, D5, D8, SY-C3, SA-B4, SY-B2} = 캐논 집합) ×2, 두 런 id/status 집합 동일(결정성) |

## A. 전환 & 격리 (기본 동작)
- **TC-MA-A1 초기 2계정 기동**: If 데모 로그인, When 앱 진입, Then 사이드바에 계정 2개(demo·work) 표시, active=demo, 기존 데모 인박스 리스트 그대로(무회귀).
- **TC-MA-A2 전환 시 데이터 격리**: If demo 활성, When `⌃2`, Then work 계정 리스트로 전환되어 work 고유 subject가 표시되고 demo 스레드 subject는 미표시(격리 확인).
- **TC-MA-A3 복귀 시 선택 상태 리셋**: If work 활성, When `⌃1`, Then demo 리스트로 복귀하고 `selectedIndex`는 0으로 리셋.

## B. 계정별 캐시·데몬 격리
- **TC-MA-B1 캐시 격리(뮤테이션 유지)**: If work에서 스레드를 아카이브, When demo로 전환 후 다시 work로 전환, Then demo 리스트는 무영향이고 work의 아카이브 상태는 유지(계정별 캐시 완전 격리).
- **TC-MA-B2 비활성 계정 데몬 발화**: If work 스레드를 과거 시각으로 스누즈한 뒤 demo로 전환, When `__debugTick` 호출, Then work로 다시 전환 시 해당 스레드가 인박스로 복귀되어 있음(비활성 계정에서도 데몬이 정시 발화).

## C. 검색/연락처 격리
- **TC-MA-C1 로컬 검색·연락처 격리**: If work 전용 발신자가 존재, When demo 계정에서 로컬 검색 또는 연락처 자동완성을 수행, Then work 발신자가 결과에 노출되지 않음.

## D. 배지
- **TC-MA-D1 비활성 계정 배지 갱신**: If demo가 활성, When work 계정에 `__debugSimulateReply` 발생 + 데몬 틱, Then 사이드바의 work 계정 배지 카운트가 증가.

## E. 마이그레이션 (vitest 전용)
- **TC-MA-E1 레거시 단일 계정 자동 마이그레이션**: If 레거시 `account.json` + `zenmail.db`가 존재하는 상태로 기동, When 앱(accounts 모듈) 초기화, Then `accounts.json`(계정 1개, activeEmail=해당 email)이 생성되고 `zenmail.db`가 계정 스코프 파일명(`zenmail-<sanitized-email>.db`)으로 rename됨(스키마 변경 없음). — **vitest 단위 테스트로 검증**(Task 2, `src/main/accounts.ts`), E2E에선 N/A 표기.

## 회귀 게이트
- **TC-MA-G1**: `npx tsc --noEmit` exit 0.
- **TC-MA-G2**: `npm test`(vitest) exit 0.
- **TC-MA-G3**: 기존 전 TC 무회귀(0 FAIL + SKIP ⊆ 캐논 집합) ×2연속.
