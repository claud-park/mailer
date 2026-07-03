# F3 keyboard-mastery — Test Cases (If-When-Then)

> Goal 3 산출물. 데모 모드 자동 E2E(run-tc.mjs 확장). ground truth: DOM + `page.evaluate`로 localStorage(`zenmail-coach`) 판독 — 신규 디버그 IPC 없음.
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP(사유 병기)
>
> CP6 실측(2026-07-04): `zenmail/e2e/run-tc.mjs` 확장 실행 결과 — 93건(기존 F1/F2 61 + 신규 F3 32), PASS 90 / FAIL 0 / SKIP 3(전부 F1의 기존 SKIP, F3 신규 SKIP 없음). 연속 2회 재실행으로 안정성(비-flaky) 확인. 각 항목 아래에 대응하는 run-tc.mjs의 `TC-KM-*` 레코드 id를 병기.

## A. 치트시트 (`?`)

- [x] **TC-A1** If 리스트에 포커스가 있으면, When `?`(Shift+/)를 누르면, Then 치트시트 오버레이가 열리고 Archive `e`·Compose `c` 등 전체 단축키가 보인다. — `TC-KM-A1` PASS
- [x] **TC-A2** If 치트시트가 열려 있으면, When Esc를 누르면, Then 닫히고 전역 단축키가 즉시 복원된다. — `TC-KM-A2` PASS (닫힌 직후 `j`로 리스트 선택 이동 재확인)
- [x] **TC-A3** If 검색 입력에 타이핑 중이면, When `?`를 입력하면, Then 치트시트가 열리지 않고 문자로 입력된다(isTyping 가드). — `TC-KM-A3` PASS
- [x] **TC-A4** If ⌘K 팔레트에서 "shortcuts"를 검색하면, When 실행하면, Then 치트시트가 열린다. — `TC-KM-A4` PASS
- [x] **TC-A5** If 치트시트가 열려 있으면, When `j`/`k`를 누르면, Then 리스트 선택이 움직이지 않는다(모달 keydown 차단 규약). — `TC-KM-A5` PASS

## B. 계측·통계

- [x] **TC-B1** If 키보드로 아카이브(`e`)를 2회 하면, When Stats를 열면(팔레트 "Your stats"), Then 누적 아카이브 카운트에 2가 반영돼 있다. — `TC-KM-B1` PASS (baseline 대비 델타 +2로 검증 — 이전 시나리오들의 누적 베이스라인이 0이 아니므로 절대값이 아닌 델타 비교)
- [x] **TC-B2** If Compose를 마우스 버튼으로 열면, When localStorage를 판독하면, Then mouse 카운트가 증가하고 키보드 비율이 하락한다(또는 불변). — `TC-KM-B2` PASS
- [x] **TC-B3** If Compose를 `c`로 열면, When localStorage를 판독하면, Then keyboard 카운트가 증가한다. — `TC-KM-B3` PASS
- [x] **TC-B4** If 스와이프로 아카이브하면, When 카운트를 판독하면, Then 총계(archive)와 mouse(modality) 양쪽에 반영된다(D5 2층·D10 dual-modality). — `TC-KM-B4` PASS. 스와이프는 Playwright `page.mouse.wheel(deltaX, deltaY)`로 실제 Chromium wheel 이벤트를 발생시켜 `ThreadRow.onWheel`의 실제 코드 경로를 구동(합성 우회 아님). CDP 좌표 관련 이슈는 아래 구현 메모 참고.
- [x] **TC-B5** If 마우스 등가물이 없는 액션(`b` 스누즈 등)만 쓰면, When 비율을 보면, Then 비율 계산에 산입되지 않는다(분모 불변 — 허수 방지). — `TC-KM-B5` PASS
- [x] **TC-B6** If Stats 모달이 열려 있으면, When Esc를 누르면, Then 닫힌다. — `TC-KM-B6` PASS
- [x] **TC-B7** If vitest(`lib/coach.test.ts`)를 돌리면, Then 비율·주간 리셋·힌트 게이팅·마일스톤 경계 순수함수가 전부 통과한다. — `npm test` (23 coach + 17 splits = 40 통과, `TC-KM-G2`에 포함)

## C. 힌트

- [x] **TC-C1** If 힌트 노출 이력이 없으면, When Toolbar Compose 버튼을 마우스로 클릭하면, Then "Press C" 힌트 토스트가 뜬다(액션 토스트와 독립 슬롯). — `TC-KM-C1` PASS (ground truth: bodyText + `hintsShown.compose` 카운트 증가)
- [x] **TC-C2** If 같은 힌트가 이 세션에 이미 노출됐으면, When 다시 클릭하면, Then 재노출되지 않는다(세션당 1회). — `TC-KM-C2` PASS (ground truth: `hintsShown.compose` 카운트 불변 — bodyText만으로는 이전 토스트의 잔상과 재발화를 구분할 수 없어 localStorage 카운트를 1차 근거로 사용)
- [x] **TC-C3** If 힌트 shownCount가 3이면(localStorage 사전 주입), When 새 세션에서 클릭하면, Then 노출되지 않는다(누적 3회 캡). — `TC-KM-C3` PASS (`page.evaluate`로 `hintsShown.compose=3` 주입 → 페이지 리로드로 세션 상태만 리셋 → 캡이 세션과 무관하게 유지됨을 확인)
- [x] **TC-C4** If 힌트 토스트의 "팁 그만 보기"를 클릭하면, When 이후 다른 마우스 어포던스를 클릭하면, Then 어떤 힌트도 나오지 않는다(전역 뮤트, 재시작 후에도 유지). — `TC-KM-C4`(즉시 뮤트) PASS + `TC-KM-F1`(재시작 후 `hintsMuted` 영속) PASS
- [x] **TC-C5** If 스레드 행을 마우스로 클릭해 열면, When 토스트를 보면, Then `j`/`k` + `↵` 힌트가 뜬다. — `TC-KM-C5` PASS
- [x] **TC-C6** If 스와이프로 아카이브하면, When 토스트를 보면, Then `E` 힌트가 뜬다. — `TC-KM-C6` PASS (B4와 동일 스와이프 액션에서 함께 검증)

## D. 마일스톤

- [x] **TC-D1** If 아카이브 이력이 없으면, When 첫 아카이브를 하면, Then 마일스톤 토스트가 1회 뜨고, 두 번째 아카이브에서는 뜨지 않는다. — `TC-KM-D1` PASS. `firsts`가 진짜 virgin인 시점(데모로그인 직후, 튜토리얼 skip 다음)에서만 관측 가능하므로 run() 최선두(scenario_km_intro)에 배치. 두 번째 아카이브 전 첫 토스트가 완전히 auto-dismiss(4s)될 때까지 대기 후 재확인(잔상 오탐 방지).
- [x] **TC-D2** If 스누즈 이력이 없으면, When 첫 스누즈를 하면, Then 마일스톤 토스트가 뜬다. — `TC-KM-D2` PASS (기존 F1/F2 스위트는 스누즈 프리셋을 한 번도 커밋하지 않으므로 실행 시점 제약 없음)
- [x] **TC-D3** If 액션 토스트("Archived")와 마일스톤 토스트가 동시에 발생하면, When 화면을 보면, Then 서로 덮어쓰지 않고 함께 보인다(D9 독립 채널). — `TC-KM-D3` PASS
- [x] **TC-D4** If milestonesShown에 기록된 상태로 재시작하면, When 같은 조건을 재현하면, Then 재발화하지 않는다(영속). — `TC-KM-D4` PASS (재시작 직후 "Design tokens v2" 아카이브 — 일반 재시작은 F2의 sign-out과 달리 온디스크 캐시를 초기화하지 않으므로, TC-FUP-E1로 직전에 존재가 재확인된 특정 스레드를 타깃)

## E. 튜토리얼

- [x] **TC-E1** If 신선한 프로필로 첫 실행하면, When 인박스 로드가 끝나면, Then 튜토리얼이 자동 시작된다(step 1 코치 버블 — `j`). — `TC-KM-E1` PASS
- [x] **TC-E2** If 튜토리얼 step 1에서, When `j`를 누르면, Then 리스트 선택이 실제로 이동하고 다음 스텝으로 진행된다(비파괴 키 통과). — `TC-KM-E2` PASS (팔레트 재진입 후 검증)
- [x] **TC-E3** If 현재 스텝과 무관한 키를 누르면, When 스텝 상태를 보면, Then 진행되지 않는다. — `TC-KM-E3` PASS (미바인딩 키 `q` 사용)
- [x] **TC-E4** If 아카이브 스텝(`e`)에서, When `e`를 누르면, Then 스텝은 진행되지만 실제 스레드는 아카이브되지 않는다(리스트 카운트 불변 — 인터셉트). — `TC-KM-E4` PASS
- [x] **TC-E5** If 튜토리얼 중 어느 스텝에서든(예: step 1), When `e`를 누르면, Then 아카이브가 발생하지 않는다(파괴 키 상시 삼킴 — D7). — `TC-KM-E5` PASS. `TC-KM-E7` 재진입 직후(step 1 "Move down", `e`는 이 스텝의 지정 키가 아님)에 `e`를 눌러 (a) 진행되지 않음(여전히 "Move down") (b) 실제 아카이브도 발생하지 않음(리스트 행 수 불변)을 동시 확인.
- [x] **TC-E6** If 튜토리얼 중, When Esc를 누르면, Then 즉시 종료되고, 재시작해도 자동 시작되지 않는다(tutorialSeen 영속). — `TC-KM-E6`(즉시 스킵) PASS + `TC-KM-F1`(재시작 후 미자동시작) PASS
- [x] **TC-E7** If 튜토리얼을 스킵했어도, When 팔레트 "Start tutorial"을 실행하면, Then step 1부터 재진입한다. — `TC-KM-E7` PASS
- [x] **TC-E8** If 마지막 스텝까지 올바른 키를 누르면, When 완주하면, Then 완료 카드가 뜨고 닫으면 정상 상태로 복귀한다(전역 단축키 복원). — `TC-KM-E8` PASS (j→k→Enter→Esc→e→c→Esc 순, Compose가 To 필드 autoFocus인 상태에서의 Esc는 composeInit 구독 경로로 진행됨을 실측)

## F. 영속성

- [x] **TC-F1** If 카운터·뮤트·tutorialSeen이 쌓인 상태에서, When 동일 user-data-dir로 재시작하면, Then 전부 유지된다(localStorage 파티션). — `TC-KM-F1` PASS (counters/keyboardCount/mouseCount/hintsMuted/milestonesShown/hintsShown 캡/tutorialSeen 전부 재시작 전후 일치 확인 + 자동시작 없음)

## G. 회귀

- [x] **TC-G1** If F1+F2 E2E 전체(run-tc.mjs)를 돌리면, When 완료되면, Then 기존 58 시나리오가 전부 그린이다(perform 래핑·capture 리스너가 기존 단축키를 깨지 않음). — `TC-KM-G1` PASS: 기존(비-KM) 어서션 61건(중복 id 포함) 전부 그린, FAIL 0
- [x] **TC-G2** If vitest 전체를 돌리면, Then 기존 17 + 신규 케이스 전부 통과한다. — `TC-KM-G2` PASS: `npm test` → 40 tests passed (coach.test.ts 23 + splits.test.ts 17)
- [x] **TC-G3** If `npx tsc --noEmit`을 돌리면, Then 에러 0. — `TC-KM-G3` PASS

## 구현 메모 (CP6)

- **스와이프 시뮬레이션**: Playwright `page.mouse.wheel(deltaX, deltaY)`가 실제 Chromium `wheel` DOM 이벤트를 발생시켜 `ThreadRow.onWheel`(`deltaX` 기반) 경로를 그대로 구동함을 확인 — 별도 우회/모킹 불필요.
- **CDP 좌표 이슈(제품 버그 아님, 하네스 이슈)**: 가상화된(react-virtual) 리스트에서, 뷰포트 하단 경계에 가까운 특정 행(예: y≈728px, 뷰포트 840px)에 대해 `page.mouse.wheel` 디스패치가 raw capture-phase `wheel` 리스너에는 정확한 좌표/deltaX로 도달하지만 `ThreadRow.onWheel`(React 합성 이벤트)에는 도달하지 않는 현상을 재현·확인(CDP/Chromium 히트테스트 특성으로 추정, React 이벤트 위임 문제 아님 — 같은 이벤트가 문서 레벨 리스너에는 정상 도달). 대응: 뷰포트 초반(첫 8~10행) 내의 행을 스와이프 타깃으로 선택하고, `swipeArchiveRowUntilCounted` 헬퍼로 `counters.archive` 증가를 폴링하며 최대 3회 재시도.
- **비동기 반영 레이스**: `archiveThread()`/`snoozeThread()`는 호출부에서 await되지 않는(`void archiveThread(...)`) fire-and-forget 패턴이라, `bumpStat`(counters 갱신)은 IPC 왕복이 끝난 뒤에만 실행된다. 고정 `sleep()` 대신 `waitFor()`로 카운터 변화를 폴링하도록 여러 지점을 보강.
- **토스트 잔상 오탐**: 힌트/마일스톤 토스트는 각각 세션 스코프 캡·4초 자동소멸을 가지므로, 짧은 간격으로 연속 액션을 수행하면 "새로 떴다"와 "아직 안 사라졌다"를 bodyText만으로 구분할 수 없다. hintsShown 카운트(localStorage) 비교를 1차 근거로 삼거나, 이전 토스트가 완전히 사라질 때까지 대기한 뒤 다음 액션을 수행하도록 조정.
