# calendar-integration — Test Cases (If-When-Then)

> Goal 3 산출물. 데모 모드 자동 E2E(run-tc.mjs, TC-CAL-*). ground truth: DOM + 기존 `--zenmail-e2e` 게이트의 `__debug` 훅(mock 캘린더 상태 조회, 실패 주입, calendarReady=false 시뮬레이션) + vitest(ICS 파서 순수 로직).
> **데모 시드 전제**(모든 TC의 If에 반영): `MockCalendarProvider`는 오늘 일정 2건 + 내일 일정 1건을 시드하고, `buildDemoData()`는 초대 메일(text/calendar 파트, `METHOD:REQUEST`) 1통을 포함한 스레드를 시드한다.
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP(사유 병기)
> 2026-07-13 전건 통과 — E2E 183 PASS·0 FAIL·6 SKIP(총 189) ×2 결정적, vitest 130/130(ics 10·calendar 4 포함), tsc clean. 무회귀는 베이스 리비전 대조 실행으로 확인(158·0·6, SKIP 집합 동일). G1 집계 기준은 DECISIONS D10.

## A. 초대 배너 (ThreadView invite 감지)

- [x] **TC-CAL-A1** If 데모 시드의 초대 메일 스레드를 열면, When ThreadView가 렌더되면, Then 헤더 아래·스크롤 영역 위에 배너가 표시되고 제목·일시·주최자가 초대 메일의 ICS 내용과 일치한다.
- [x] **TC-CAL-A2** If 초대가 없는 일반 스레드를 열면, When ThreadView가 렌더되면, Then invite 배너가 표시되지 않는다.
- [x] **TC-CAL-A3** If 한 스레드 안에 동일 이벤트의 invite가 여러 메시지(업데이트 재전송)에 걸쳐 있으면, When ThreadView가 렌더되면, Then 가장 최신 메시지의 invite 1건만 배너로 노출된다.
- [x] **TC-CAL-A4** If ICS 파트의 날짜 필드가 UTC/`TZID=` 두 형식 어느 쪽도 아니면(해석 불가), When 메시지를 파싱하면, Then `invite`가 노출되지 않고 배너도 표시되지 않는다(fail-safe, 앱 크래시 없음).

## B. RSVP (낙관 5단계)

- [x] **TC-CAL-B1** If 초대 배너가 표시된 상태에서, When [수락] 버튼을 누르면, Then 배너가 즉시 "수락됨" 상태로 낙관 반영되고(F4 5단계 패턴), 성공 응답 후에도 상태가 유지된다.
- [x] **TC-CAL-B2** If 초대 배너가 표시된 상태에서, When [미정] 버튼을 누르면, Then 배너가 즉시 "미정" 상태로 낙관 반영되고 성공 응답 후에도 유지된다.
- [x] **TC-CAL-B3** If 초대 배너가 표시된 상태에서, When [거절] 버튼을 누르면, Then 배너가 즉시 "거절됨" 상태로 낙관 반영되고 성공 응답 후에도 유지된다.
- [x] **TC-CAL-B4** If `respondToEvent` 실패를 주입한 상태에서, When RSVP 버튼(예: 수락)을 누르면, Then 배너는 낙관 반영 직후 실패 응답 시 이전 상태로 롤백되고(`recordRollback`) 토스트가 뜬다.
- [x] **TC-CAL-B5** If 이미 응답(예: 수락)을 완료한 배너에서, When 다른 응답(예: 거절)을 누르면, Then 재변경이 즉시 반영되고 최종적으로 새 응답 상태가 표시된다.

## C. 아젠다 패널

- [x] **TC-CAL-C1** If 어느 화면에서든, When `g` → `c` 시퀀스를 입력하면, Then `AgendaPanel`이 오버레이로 열린다(backdrop + autofocus).
- [x] **TC-CAL-C2** If 아젠다 패널을 열면, When `listEvents(오늘 00:00~내일 24:00)` 결과가 도착하면, Then 데모 시드의 오늘 일정 2건 + 내일 일정 1건이 표시된다.
- [x] **TC-CAL-C3** If 아젠다 패널이 열려 있으면, When `Esc`를 누르거나 backdrop을 클릭하면, Then 패널이 닫힌다.
- [x] **TC-CAL-C4** If 아젠다 패널이 열려 있으면, When 배경에서 단축키(예: `e` 아카이브)를 누르면, Then 해당 단축키가 실행되지 않는다(`useKeyboard.ts` modal guard로 차단).
- [x] **TC-CAL-C5** If `listEvents` 실패를 주입한 상태에서, When `g` → `c`로 아젠다 패널을 열면, Then 토스트가 아니라 패널 내부에 인라인 에러 한 줄이 표시된다.

## D. 이벤트 생성 폼

- [x] **TC-CAL-D1** If 스레드가 선택된 상태에서, When kbar에서 "Create event from email" 액션을 실행하면, Then `EventComposer` 폼이 오버레이로 열린다.
- [x] **TC-CAL-D2** If 열린 스레드의 제목이 `Re: 팀 미팅`이면, When `EventComposer`가 프리필되면, Then 제목 필드는 `Re:` 접두가 제거된 `팀 미팅`으로 채워진다(`Fwd:`도 동일 규칙).
- [x] **TC-CAL-D3** If 열린 스레드의 참여자가 본인 포함 여러 명이면, When `EventComposer`가 프리필되면, Then 참석자 필드에 본인 이메일을 제외한 나머지 참여자만 채워진다.
- [x] **TC-CAL-D4** If `EventComposer`가 열려 있고 날짜/시간 필드가 비어 있으면, When 생성을 시도하면, Then 생성이 차단되고(버튼 비활성 또는 검증 에러) `createEvent`가 호출되지 않는다.
- [x] **TC-CAL-D5** If 날짜/시간을 입력하고 생성을 요청하면, When `createEvent`가 성공하면, Then 성공 토스트가 뜨고 폼이 닫힌다.
- [x] **TC-CAL-D6** If `createEvent` 실패를 주입한 상태에서, When 생성을 요청하면, Then 실패 토스트가 뜨고 폼은 열린 상태로 유지된다(입력 보존).

## E. calendarReady 게이트

- [x] **TC-CAL-E1** If `__debug` 훅으로 `calendarReady: false`를 시뮬레이션한 상태에서, When 초대 배너의 RSVP 버튼을 누르거나 `g→c`로 아젠다를 열거나 이벤트 생성 액션을 실행하면, Then "캘린더 권한 필요 — 다시 로그인" 안내가 표시되고 해당 캘린더 액션은 실행되지 않는다.
- [x] **TC-CAL-E2** If `calendarReady: false` 상태이면, When 메일 목록 열람·검색·라벨 적용·아카이브·스누즈 등 기존 메일 기능을 사용하면, Then 전부 기존과 동일하게 정상 동작한다(캘린더 게이트가 메일 기능에 영향을 주지 않음).
- [x] **TC-CAL-E3** If `calendarReady: false` 상태에서 재로그인 안내를 통해 signOut→signIn을 수행하면, When 데모/실계정 세션이 복원되면, Then `calendarReady: true`로 전환되고 캘린더 기능이 정상 동작한다(데모 모드는 항상 true).

## F. vitest — ICS 파서 순수 로직

- [x] **TC-CAL-F1** If ICS 텍스트에 라인 폴딩(다음 줄이 공백으로 시작)과 이스케이프 문자(`\,`/`\;`/`\n`)가 섞여 있으면, When 파싱하면, Then 언폴딩·언이스케이프된 올바른 필드 값이 추출된다.
- [x] **TC-CAL-F2** If `DTSTART`가 `...Z`(UTC) 형식이면, When 파싱하면, Then ISO 문자열로 정규화된다.
- [x] **TC-CAL-F3** If `DTSTART;TZID=...` 형식이면, When 파싱하면, Then ISO 문자열로 정규화된다.
- [x] **TC-CAL-F4** If 날짜 형식이 UTC/TZID 어느 것도 아니면, When 파싱하면, Then 파서가 undefined/invite 없음을 반환한다(예외를 던지지 않음).
- [x] **TC-CAL-F5** If `METHOD:REQUEST`가 아닌 ICS(예: `METHOD:CANCEL`)이면, When 파싱하면, Then `InviteInfo`가 생성되지 않는다(범위 밖 처리 확인).

## G. 회귀 게이트

- [x] **TC-CAL-G1** If calendar-integration 전체가 배선된 상태면, When 기존 E2E 전건을 돌리면, Then 기존 캐논(157 PASS·0 FAIL·7 SKIP)이 그대로 유지된다.
- [x] **TC-CAL-G2** If `npm test`+`npx tsc --noEmit`를 돌리면, Then 신규 ICS 파서 vitest 포함 전부 통과한다.
