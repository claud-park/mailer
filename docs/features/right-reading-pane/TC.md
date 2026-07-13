# right-reading-pane — Test Cases (If-When-Then)

> Goal 3 산출물. E2E는 run-tc.mjs 확장(TC-RP-*). 플랜 Task 3(`docs/superpowers/plans/2026-07-13-right-reading-pane.md`) 기반.
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP
>
> CP3 실측(2026-07-13): run-tc.mjs 확장 — 총 163건(기존 159 + 신규 TC-RP 4), **156 PASS / 0 FAIL / 7 SKIP**(전부 기존 SKIP, 신규 0). 연속 2회 재실행 동일. vitest 116/tsc clean. 집계는 `=== TC Results ===` 블록의 상태 컬럼 기준(게이트 케이스 상세 텍스트의 "PASS/SKIP" 문자열이 토큰 카운트를 부풀리므로 주의).

## A. 레이아웃 전환

- [x] **TC-RP-A1** If 리스트에서 스레드를 열면(Enter), When ThreadView와 ThreadList의 `getBoundingClientRect()`를 비교하면, Then ThreadView `rect.left`가 ThreadList `rect.right` 이상(우측 배치)이고 리스트 폭이 컨테이너 폭의 36~44%다.
- [x] **TC-RP-A2** If 상세가 열려 있으면, When 리스트의 임의 행 `offsetHeight`를 측정하면, Then `COMPACT_ROW_HEIGHT`(64)와 일치하고 제목 텍스트가 발신자 텍스트와 다른 y 좌표에 있다(2줄 레이아웃).
- [x] **TC-RP-A3** If 상세가 열린 상태에서, When Escape로 닫으면, Then 리스트가 컨테이너 전체 폭으로 복귀하고 임의 행의 `offsetHeight`가 56(기본 `ROW_HEIGHT`)으로 되돌아온다.
- [x] **TC-RP-A4** If 상세가 열린 상태에서, When `j`를 2회 누르면, Then 우측 ThreadView의 제목이 새로 선택된 스레드의 제목과 일치한다(자동 리딩 무회귀).

## C. 회귀

- [x] **TC-RP-C1** If 좌우 분할 배선이 완료된 상태면, When 기존 전체 E2E(run-tc.mjs)를 돌리면, Then 전부 기존 상태를 유지한다. 단 상하 분할 기하(높이/스크롤/가시성)에 의존해 실패하는 기존 케이스가 있으면, 동작 의미(무엇을 검증하는지)는 바꾸지 않고 어서션만 새 기하(좌우 폭/행 높이)에 맞춰 수정하며 그 사유를 아래 "회귀 수정 로그"에 기록한다.
- [x] **TC-RP-C2** If `npm test`+`npx tsc --noEmit`를 돌리면, Then 신규 스위트(TC-RP 포함) 전부 통과한다.

## 회귀 수정 로그

- **TC-SP-C3** (`scenario_sp_rollback`): `threadIdOfRowContaining(c3Text)` 호출을 `clickRowContaining` **앞**으로 이동(검증 의미 불변 — id 확보 시점만 변경). 사유: 행 텍스트를 classic(전체 폭 1행) 모드에서 캡처한 뒤 스레드를 열면 행이 compact 2줄로 바뀌어 textContent 구성(칩 생략·날짜 위치 이동)이 달라지므로 `includes()` 매칭이 실패 → `threadIdC3=null` → "markRead optimistic flip" 관측이 영구 false로 2000ms 타임아웃. 이 abort가 스위트 상태를 오염시켜 TC-SY-SendSpill까지 연쇄 FAIL시켰음(C3 수정만으로 두 실패 모두 해소, 재실행 2회 검증). 그 외 기존 어서션 수정 0건.
