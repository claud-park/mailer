# calendar-integration — Feature PRD

> 2026-07-13 · Goal 1 산출물. 설계: 브레인스토밍 확정([설계 스펙](../../superpowers/specs/2026-07-13-calendar-integration-design.md)) — 사용자 확정: 범위=메일 중심 연동, 아젠다=단축키 패널, 생성=수동 폼+규칙 프리필, 접근=A안(Calendar API 정공법).
> 상위: [DEV_WORKFLOW.md](../../DEV_WORKFLOW.md) · post-roadmap(F1~F6 완주 이후) 신규 feature.

## 1. 배경 / 목표

ZenMail은 미니멀 키보드 중심 Gmail 클라이언트다. 사용자는 메일 워크플로우 안에서 캘린더 초대에 응답하고, 메일 스레드에서 이벤트를 만들고, 오늘 일정을 빠르게 확인해야 하는 순간을 메일 앱을 벗어나 별도 캘린더 앱으로 전환하지 않고 처리하고 싶어 한다.

목표는 메일 워크플로우를 벗어나지 않고 캘린더의 세 가지 접점을 처리하는 것이다:

1. **RSVP** — 초대 메일을 열면 ThreadView 배너에서 수락/미정/거절.
2. **이벤트 생성** — 메일에서 결정적 규칙 프리필로 이벤트 생성 폼 오픈(No AI).
3. **아젠다 패널** — `g→c`로 오늘+내일 일정 오버레이 확인.

캘린더 "뷰"(day/week 그리드)는 만들지 않는다 — 메일 클라이언트 정체성 유지가 최우선이며, 이는 사용자 확정 사항이다.

## 2. 사용자 스토리

### US1. RSVP
- 사용자로서, 회의 초대 메일이 담긴 스레드를 열면 배너에서 이벤트 제목·일시·주최자를 바로 확인하고 [수락]/[미정]/[거절] 중 하나를 눌러 즉시 응답하고 싶다. 다른 캘린더 앱으로 전환하고 싶지 않다.
- 사용자로서, 실수로 응답을 잘못 눌렀을 때 다시 눌러 응답을 바꾸고 싶다.
- 사용자로서, 네트워크 문제로 응답 전송이 실패하면 즉시 알림을 받고 배너가 이전 상태로 되돌아가길 원한다.

### US2. 이벤트 생성
- 사용자로서, 메일 스레드에서 논의된 미팅을 캘린더 이벤트로 빠르게 만들고 싶다. 제목과 참석자는 메일에서 자동으로 채워지되, 날짜/시간은 내가 직접 확인하고 입력하고 싶다(AI가 임의로 추측하는 것을 원하지 않는다).
- 사용자로서, 커맨드 팔레트(kbar)에서 "Create event from email" 액션으로 폼을 빠르게 열고 싶다.

### US3. 아젠다 패널
- 사용자로서, 메일을 확인하다가 오늘/내일 일정이 뭐가 있는지 키보드만으로 빠르게 확인하고 다시 메일 작업으로 돌아가고 싶다. `g→c` 같은 단축키 시퀀스로 열고 Esc로 즉시 닫히길 원한다.
- 사용자로서, 아젠다 패널이 열려 있는 동안에는 배경의 다른 단축키(예: `e` 아카이브)가 실수로 실행되지 않길 원한다.

## 3. 기능 요구사항 (FR)

### 초대 감지 & RSVP 배너
- **FR1**: `extractBodies()`의 MIME walk를 확장해 `text/calendar`(및 `application/ics`) 파트를 수집한다.
- **FR2**: main 프로세스에 최소 ICS 파서를 자체 구현한다(~50줄, 신규 의존성 0). 라인 언폴딩+이스케이프 처리 후 `METHOD`/`UID`/`SUMMARY`/`DTSTART`/`DTEND`/`ORGANIZER` 6개 필드만 추출한다.
- **FR3**: 날짜는 UTC(`...Z`)와 `TZID=` 파라미터 두 형식만 ISO로 정규화한다. 해석 불가 형식이면 해당 invite는 노출하지 않는다(fail-safe).
- **FR4**: `METHOD:REQUEST`인 ICS 파트만 `MessageDetail.invite?: InviteInfo`로 노출한다.
- **FR5**: ThreadView 헤더 아래·스크롤 영역 위(FollowupBanner 자리)에 스레드 내 invite가 있으면 이벤트 요약(제목·일시·주최자) + [수락]/[미정]/[거절] 버튼 배너를 표시한다.
- **FR6**: 스레드에 invite가 여러 건이면 가장 최신 메시지의 invite 1건만 배너로 노출한다.
- **FR7**: RSVP 응답은 F4 낙관 5단계 패턴(`instrument('rsvp')` → 이전 상태 캡처 → 낙관 반영 → `done()` → 실패 시 롤백+`recordRollback`+토스트)을 그대로 따른다.
- **FR8**: 응답 후 배너는 현재 응답 상태를 표시하고, 사용자는 재변경할 수 있다.

### 캘린더 Provider & IPC
- **FR9**: `src/main/calendar.ts`에 `CalendarProvider` 인터페이스(`listEvents`/`respondToEvent`/`createEvent`)와 `RealCalendarProvider`/`MockCalendarProvider` 구현을 신설한다.
- **FR10**: `RealCalendarProvider`는 기존 `Auth.OAuth2Client`를 재사용하고 `google.calendar({version:'v3', auth})`를 사용한다(신규 npm 의존성 없음).
- **FR11**: `respondToEvent`는 `events.list({iCalUID})`로 이벤트를 특정한 뒤 본인 attendee의 `responseStatus`를 `events.patch`로 갱신한다.
- **FR12**: `createEvent`는 primary 캘린더에 `events.insert`(attendees 포함, `sendUpdates: 'all'`)한다.
- **FR13**: `MockCalendarProvider`는 데모 이벤트를 시드(오늘 2건+내일 1건)하고 기존 Mock 패턴(`callCounts`/`delay()`/`failIfOffline()`)을 동일 적용한다.
- **FR14**: 기존 4-파일 IPC 계약(types.ts / ipc.ts / preload.ts / calendar.ts)을 따라 `CalendarEvent`/`InviteInfo`/`CreateEventInput` 타입과 `listEvents`/`respondToEvent`/`createEvent` API, `calendar:list-events`/`calendar:respond`/`calendar:create` 핸들러를 추가한다.

### OAuth scope & calendarReady 게이트
- **FR15**: `SCOPES`에 `https://www.googleapis.com/auth/calendar.events` 1개를 추가한다(아젠다 읽기+RSVP patch+생성 전부 커버).
- **FR16**: 세션 복원 시 토큰 응답의 `scope` 문자열에 `calendar.events` 포함 여부를 검사해 `AccountInfo.calendarReady: boolean`을 renderer에 전달한다.
- **FR17**: `calendarReady: false`면 캘린더 기능(RSVP/이벤트 생성/아젠다)만 비활성화한다. 메일 기능은 무영향이며 기존 토큰을 강제 무효화하지 않는다.
- **FR18**: 캘린더 기능을 첫 사용 시도할 때 `calendarReady: false`면 "캘린더 권한 필요 — 다시 로그인" 안내를 표시하고, 기존 signOut→signIn 경로를 재사용한다(`prompt: 'consent'`이므로 별도 incremental auth 불요).
- **FR19**: 데모 모드는 항상 `calendarReady: true`다.

### 아젠다 패널
- **FR20**: kbar 2키 시퀀스 `g→c`(기존 `g,i/s/d/l`과 동일 방식) + kbar 액션 "Open agenda"로 `AgendaPanel.tsx`를 연다.
- **FR21**: SnoozePicker/StatsPanel과 동일한 오버레이 템플릿(store boolean `agendaOpen`, backdrop `bg-black/50` + click-outside close, 패널 `onKeyDown` stopPropagation + Esc close, 오픈 시 autofocus)을 따른다.
- **FR22**: 패널을 열 때 `listEvents(오늘 00:00 ~ 내일 24:00)`를 live fetch한다(캐시 없음). 로딩 상태를 표시하고, 실패 시 패널 내 에러 한 줄을 표시한다.
- **FR23**: `useKeyboard.ts`의 modal guard 배열과 Esc-close 블록 두 곳 모두에 `agendaOpen`을 등록해 배경 단축키 누수를 막는다.

### 이벤트 생성 폼
- **FR24**: kbar 액션 "Create event from email"(스레드 선택 컨텍스트 필요, `targetThreadId` 가드)로 `EventComposer.tsx`를 연다.
- **FR25**: 제목은 메일 제목에서 `Re:`/`Fwd:` 접두를 제거해 프리필한다.
- **FR26**: 참석자는 스레드 참여자 이메일 목록(본인 제외)으로 프리필한다.
- **FR27**: 날짜/시간은 빈 값으로 두고 사용자 입력을 필수로 한다(AI 파싱 없음).
- **FR28**: 오버레이 템플릿은 아젠다 패널과 동일하며, `useKeyboard.ts`의 modal guard 배열과 Esc-close 블록에 `eventComposerOpen`을 등록한다.
- **FR29**: 생성 성공 시 토스트를 표시하고, 실패 시 토스트를 표시한다.

### 에러·오프라인 정책
- **FR30**: 캘린더 뮤테이션(RSVP/생성)은 F6 뮤테이션 큐(`attemptOrEnqueue`) 비대상이다 — Gmail 라벨 캐시와 무관한 원격 쓰기이므로 실패 시 즉시 롤백+토스트한다(transient 재시도 없음, v1 단순화).
- **FR31**: 아젠다 fetch 실패는 패널 내 인라인 에러로 표시한다(토스트 아님).

### 데모 모드 & E2E 지원
- **FR32**: `buildDemoData()`에 초대 메일 1통(`text/calendar` 파트, `METHOD:REQUEST`)을 추가해 세 기능 전부 데모에서 동작하도록 한다.
- **FR33**: 기존 `--zenmail-e2e` 게이트 안에 `__debug` 훅(mock 캘린더 상태 조회, 실패 주입, calendarReady=false 시뮬레이션)을 추가해 TC-CAL-* E2E를 지원한다.

## 4. 비기능 요구사항 (NFR)

- **NFR1 (No AI)**: v1은 No AI 원칙(스펙 §9)을 준수한다. 이벤트 생성 프리필은 결정적 규칙(제목 접두 제거, 참여자 목록 추출)만 사용하며, 날짜/시간 추측이나 자연어 파싱을 일체 포함하지 않는다. ICS 파싱도 정규식 기반 결정적 필드 추출이며 AI 요약을 쓰지 않는다.
- **NFR2 (키보드 중심)**: 아젠다 패널(`g→c`)과 이벤트 생성(kbar 액션)은 마우스 없이 접근 가능해야 하며, 오버레이는 Esc로 닫히고 배경 단축키를 차단해야 한다(기존 SnoozePicker/StatsPanel 패턴 재사용).
- **NFR3 (데모 모드 동작)**: 실계정 OAuth 없이도 `MockCalendarProvider` + 데모 초대 메일로 RSVP/아젠다/생성 세 기능이 전부 동작해야 한다.
- **NFR4 (calendarReady 게이트)**: scope 미획득 상태에서도 메일 핵심 기능(읽기/쓰기/라벨/스누즈/검색 등)은 전혀 영향받지 않아야 한다. 캘린더 기능만 국소적으로 비활성화된다.
- **NFR5 (아키텍처 일관성)**: `CalendarProvider`는 기존 `GmailProvider` 패턴(Real/Mock 이원화, 4-파일 IPC 계약, 기존 인증 재사용)을 그대로 미러링한다. 신규 npm 의존성을 추가하지 않는다(googleapis ^173에 calendar_v3 포함, ICS 파서 자체 구현).
- **NFR6 (무회귀)**: 기존 E2E 스위트(현재 캐논 157 PASS·0 FAIL·7 SKIP)가 그대로 유지되어야 한다.

## 5. 범위 밖 (명시)

스펙 원문 그대로:

- 캘린더 뷰(day/week)
- Compose 가용시간 공유
- 반복 일정 편집
- 다중 캘린더 선택(primary 고정)
- ICS `METHOD:CANCEL`/`REPLY` 처리
- 오프라인 캐시(F6 큐 미적용)
- AI 파싱 일체(v1 No AI)

## 6. 성공 기준

1. 초대 메일이 포함된 스레드를 열면 배너에 제목·일시·주최자가 표시되고, RSVP 3종 응답이 낙관 반영+실패 시 롤백으로 동작한다.
2. `g→c`로 아젠다 패널이 열리고 오늘+내일 일정이 표시되며, Esc로 닫히고 열려 있는 동안 배경 단축키가 차단된다.
3. kbar에서 이벤트 생성 폼을 열면 제목/참석자가 규칙대로 프리필되고, 날짜 미입력 시 생성이 차단된다.
4. `calendarReady: false` 상태에서 캘린더 기능 사용 시 재로그인 안내가 뜨고, 메일 기능은 정상 동작한다.
5. 신규 TC-CAL-* E2E 전부 통과 + 기존 E2E 무회귀(157 PASS·0 FAIL·7 SKIP 유지) + vitest(ICS 파서) + tsc.
