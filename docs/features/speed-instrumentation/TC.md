# F4 speed-instrumentation — Test Cases (If-When-Then)

> Goal 3 산출물. 데모 모드 자동 E2E(run-tc.mjs 확장). ground truth: DOM + `window.__zenmailLatency.snapshot()` 판독(D9) + localStorage(`zenmail-latency`) + 실패 주입 debug IPC(D11). vitest는 lib 순수 로직 담당.
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP(사유 병기)
>
> CP6 실측(2026-07-04): run-tc.mjs 확장 실행 — 총 112건(기존 93 + 신규 TC-SP 18 + G 분리 1), 109 PASS / 0 FAIL / 3 SKIP(전부 F1 기존). 연속 2회 재실행으로 비-flaky 확인. markRead burst p50 실측 13.1ms/12.9ms, overGross(>400ms) 0. vitest 73(latency 18 + optimistic 15 포함), tsc clean.

## A. 계측 코어 (vitest — `lib/latency.test.ts`)

- [x] **TC-A1** If 링버퍼에 50개 초과를 push하면, When 스냅샷을 읽으면, Then 최신 50개만 남는다(순환).
- [x] **TC-A2** If 샘플이 19개면, When p50/p95를 계산하면, Then null을 반환한다(n<20 관례). 20개면 수치를 반환한다.
- [x] **TC-A3** If 버짓(100ms) 초과 샘플이 섞이면, When 위반 판정을 돌리면, Then 위반 수와 gross(400ms) 초과 수가 정확히 집계된다.
- [x] **TC-A4** If `openThread:content`를 classify하면, Then informational로 분류되어 하드 게이트 집합에 들지 않는다.

## B. 계측 배선·버짓 게이트 (E2E)

- [x] **TC-B1** If 리스트에 스레드가 충분하면, When `e` 아카이브를 K≥25회 연속 수행하면, Then 스냅샷의 `archive` count≥25이고 웜업 2건 폐기 후 **p50 ≤ 100ms**이며 400ms 초과가 0건이다(D10 하드 게이트).
  - **E2E 구현 노트(CP6)**: 실제 하네스(`e2e/run-tc.mjs` `scenario_sp_burst`)는 아카이브가 아니라 **markRead/unread 토글(I/U, K≥26회)** burst로 구현했다 — 아카이브 burst는 유한한 데모 스레드를 고갈시켜 이 위치 이후에 실행되는 F1~F3 시나리오가 의존하는 특정 시드 스레드를 훼손하기 때문이다. `markRead`도 `instrument()`로 계측되는 동일한 100ms 버짓 뮤테이션 액션이므로 게이트의 취지(하드 버짓 위반 없음)는 동일하게 검증된다. TC-SP-B4도 이 시나리오에서 함께 판정한다.
- [x] **TC-B2** If 뮤테이션 6종을 각 1회 이상 수행하면, When 스냅샷을 읽으면, Then 각 actionId에 샘플이 기록돼 있다(배선 커버리지).
- [x] **TC-B3** If 계측이 배선된 상태면, When 아카이브를 수행하면, Then 행 제거·토스트 등 기존 동작이 F1~F3 어서션과 동일하다(측정의 무침습).
- [x] **TC-B4** If markRead를 수행하면, When 스냅샷을 읽으면, Then `markRead` 샘플이 기록되고 사이드바 라벨 재렌더는 예산 구간에 포함되지 않는다(D14 — p50이 프레임 스케일).

## C. 롤백 (실패 주입 — D11)

- [x] **TC-C1** If `__debug-fail-next-modify`를 무장하면, When `e` 아카이브하면, Then 행이 즉시 사라졌다가(낙관) 에러 토스트와 함께 복원된다(멤버십 기준, 위치 드리프트 허용 — D4).
- [x] **TC-C2** If 실패를 무장하고 스레드 X를 아카이브 직후 스레드 Y도 아카이브하면(연타), When X가 실패 복원되면, Then Y는 사라진 상태를 유지한다(엔티티별 invert — 전역 스냅샷 오염 없음).
- [x] **TC-C3** If markRead 실패를 주입하면, When 복원되면, Then unread 상태가 멱등 반전으로 원복된다(중복 복원 없음).
- [x] **TC-C4** If 롤백이 발생하면, When 스냅샷/`zenmail-latency`를 읽으면, Then rollback 이벤트가 집계돼 있다.

## D. followup 낙관화

- [x] **TC-D1** If 스레드에서 `h` 팔로업을 잡으면, When IPC 완료를 기다리지 않고 즉시 판독하면, Then followup 핀이 이미 반영돼 있고 `followup:add` 샘플이 기록된다(낙관 전환 증명 — D5).
- [x] **TC-D2** If followup 실패를 주입하면, When schedule하면, Then 핀이 낙관 표시 후 제거되고 에러 토스트가 뜬다.
- [x] **TC-D3** If 팔로업을 취소하면, Then 핀이 즉시 사라지고 `followup:cancel` 샘플이 기록된다. 기존 F2 TC(리마인드 발화 등)는 무회귀.

## E. openThread 분리 계측 (D7)

- [x] **TC-E1** If 스레드를 Enter로 열면, When 스냅샷을 읽으면, Then `openThread:select` 샘플(어포던스 페인트)이 100ms 버짓 클래스에, `openThread:content`가 informational에 각각 기록된다.
- [x] **TC-E2** If burst 게이트(TC-B1)를 돌리면, Then `openThread:content`는 하드 게이트 판정에 포함되지 않는다.

## F. 개발자 표면 (D8)

- [x] **TC-F1** If 앱이 떠 있으면, When ⌘⌥⇧L을 누르면, Then LatencyHud가 열려 per-action p50/p95/count가 보이고, 다시 누르면 닫힌다.
- [x] **TC-F2** If HUD가 열려 있으면, When `j`/`k`를 누르면, Then 리스트 내비가 정상 동작한다(비모달 — 전역 단축키 불간섭).
- [x] **TC-F3** If 프로덕션 기본 상태면, Then 레이턴시 관련 사용자 노출 UI가 없다(StatsPanel 무변화, HUD 기본 닫힘).

## G. 회귀 게이트

- [x] **TC-G1** If 위반이 발생한 세션을 리로드하면, When `zenmail-latency`를 판독하면, Then 위반 집계가 persist돼 있고 원시 샘플은 저장돼 있지 않다(D3).
- [x] **TC-G2** If F4 전체가 배선된 상태면, When 기존 F1~F3 E2E 93건을 돌리면, Then 전부 기존 상태(90 PASS·3 SKIP)를 유지한다 — 특히 D12(recordEfficient 이동) 후 TC-KM-* 전체.
- [x] **TC-G3** If `npm test`와 `npx tsc --noEmit`을 돌리면, Then 신규 latency 스위트 포함 전부 통과한다.
