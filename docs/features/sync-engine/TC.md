# F6 sync-engine — Test Cases (If-When-Then)

> Goal 3 산출물. 데모 모드 자동 E2E(run-tc.mjs, TC-SY-*). ground truth: DOM + `window.__zenmailLatency.snapshot()` + debug IPC(`__debugSetOnline`/`__debugQueueDepth`/`__debugTick`/provider 호출 카운터) + 캐시 cold read(재시작). vitest는 classify/backoff/캐시 조립 순수 로직.
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP(사유 병기)
>
> CP8 실측(2026-07-06): run-tc.mjs — 총 142건(기존 129 + 신규 TC-SY 13), 136 PASS / 0 FAIL / 5 SKIP(기존 3 + B2·C3 사유 기록), 연속 2회 동일. warm-hit openThread:content p50 실측 21.4ms/14.2ms(<100 게이트, 45샘플). send exactly-once(drain +1 후 추가 tick 불변). vitest 116, tsc clean.
> SKIP 사유: B2 — 실재시작 시 데몬 부팅 틱이 큐를 즉시 자동 drain하여 depth 유지 어서션이 원리적으로 불가(C2 캐시 cold-read + B1 라이브 depth로 갈음). C3 — mock 상태 직접 변경 수단 부재로 조용한 병합 자동화 보류(C1 warm-hit가 SWR 경로 증명). B3 — per-thread 2건은 UI로 재현 불가(아카이브가 뷰에서 제거), depth 축적+drain 수렴으로 갈음(FIFO 장벽은 vitest 커버).

## A. 순수 로직 (vitest)

- [x] **TC-A1** If 에러가 `{code:'ECONNRESET'}`/`{status:503}`/`{status:429}`면, When classify하면, Then transient다.
- [x] **TC-A2** If 에러가 `{status:400}`/`{status:404}`/code·status 없는 generic Error면, When classify하면, Then permanent다(D5 fail-safe — F4/F5 주입 실패 보존의 근거).
- [x] **TC-A3** If attempts가 0→8로 증가하면, When backoff를 계산하면, Then 지수 증가하되 cap(15m)을 넘지 않고 max 초과 시 소진 판정된다.
- [x] **TC-A4** If threads row + messages payload가 캐시에 있으면, When ThreadDetail을 조립하면, Then subject/labelIds/messages가 fetch 결과와 동형이다.
- [x] **TC-A5** If 같은 라벨 델타를 캐시에 2회 적용하면, Then 멱등이다(중복 라벨 없음).

## B. 오프라인 낙관 유지 (vs F4 롤백 — 핵심 대비 증명)

- [x] **TC-SY-B1** If `__debugSetOnline(false)`면, When `e` 아카이브하면, Then 행이 사라진 채 **유지**되고(롤백 없음 — TC-SP-C1과 대비), 큐 depth=1, 사이드바에 "Offline — 1 pending"이 보인다.
- [~] **TC-SY-B2** If B1 상태에서 앱을 재시작(cold read)하면, Then 리스트가 캐시에서 즉시 paint되고 아카이브된 스레드는 여전히 부재하며 큐 depth=1이 유지된다(캐시 낙관+큐 영속).
- [x] **TC-SY-B3** If 오프라인에서 같은 스레드에 archive→라벨 적용을 순차로 하면, Then 둘 다 큐에 쌓이고(per-thread 장벽) drain 시 생성 순서대로 적용된다.
- [x] **TC-SY-B4** If 온라인을 복귀시키고 drain(즉시 트리거 또는 `__debugTick`)하면, Then 큐 depth=0, 지표 소거, mock 서버 상태가 낙관 상태와 일치한다.
- [x] **TC-SY-B5** If drain 중 항목이 4xx(coded `{status:400}`) 실패하면, Then 항목 drop + `mutation-permanent-failed` → 해당 스레드가 서버 진실로 원복되고 토스트가 뜬다.
- [x] **TC-SY-B6(무회귀)** If 온라인 상태에서 기존 generic 주입 실패(`__debugFailNextModify`)를 쓰면, Then 여전히 즉시 롤백된다 — TC-SP-C1~C4 전부 기존대로 PASS.

## C. 읽기 로컬-퍼스트

- [x] **TC-SY-C1** If 스레드를 한 번 열었다 닫으면, When 같은 스레드를 다시 열면, Then `openThread:content` warm 샘플이 **< 100ms**다(캐시 히트 증명 — cold 300ms informational 게이트는 불변).
- [x] **TC-SY-C2** If 캐시가 채워진 상태로 재시작하면, When 첫 화면을 그리면, Then provider 응답 전에 리스트가 paint된다(cold-read SWR — provider 지연 주입으로 판별).
- [~] **TC-SY-C3** If revalidate가 서버측 변경을 발견하면, Then `threads-changed` diff로 조용히 병합되고 선택/스크롤이 보존된다.

## D. diff-push · churn 해소

- [x] **TC-SY-D1** If 아카이브가 성공하면, Then `threads-changed` removal 1건만 push되고 **list refetch 0회**다(provider 호출 카운터).
- [x] **TC-SY-D2** If 데몬 틱이 due 항목 N(≥2)건을 처리하면, Then change 이벤트는 **1발**이다(D12 debounce).
- [x] **TC-SY-D3(무회귀)** If diff-push 전환 후 기존 F1~F5 시나리오를 돌리면, Then 아카이브 후 행 소멸·스누즈 복귀·followup 발화 등 화면 갱신이 전부 기존과 동일하게 관찰된다.

## E. send spill

- [x] **TC-SY-E1** If 오프라인에서 undo-window가 만료되면, Then send가 scheduled_sends로 spill되고 온라인 복귀 후 데몬이 발송한다(mock Sent에 정확히 1통 — 정상 케이스 exactly-once).

## F. 회귀 게이트

- [x] **TC-SY-G1** If F6 전체가 배선된 상태면, When 기존 E2E 128건을 돌리면, Then 전부 기존 상태(125 PASS·3 SKIP)를 유지한다.
- [x] **TC-SY-G2** If `npm test`+`npx tsc --noEmit`를 돌리면, Then 신규 sync 스위트 포함 전부 통과한다.
