# Google Calendar 연동 (calendar-integration) — 설계 스펙

> 2026-07-13 브레인스토밍 확정. post-roadmap(F1~F6 완주 이후) 신규 feature.
> 사용자 확정: 범위=**메일 중심 연동**, 아젠다=**단축키 패널**, 생성=**수동 폼+규칙 프리필**, 접근=**A안(Calendar API 정공법)**.

## 목적

ZenMail(미니멀 키보드 중심 Gmail 클라이언트)에서 메일 워크플로우를 벗어나지 않고 캘린더의 세 가지 접점을 처리한다:

1. **RSVP** — 초대 메일을 열면 ThreadView 배너에서 수락/미정/거절.
2. **이벤트 생성** — 메일에서 결정적 규칙 프리필로 이벤트 생성 폼 오픈 (No AI).
3. **아젠다 패널** — `g→c`로 오늘+내일 일정 오버레이 확인.

캘린더 "뷰"는 만들지 않는다 — 메일 클라이언트 정체성 유지.

## 범위 밖 (명시)

캘린더 뷰(day/week), Compose 가용시간 공유, 반복 일정 편집, 다중 캘린더 선택(primary 고정), ICS `METHOD:CANCEL`/`REPLY` 처리, 오프라인 캐시(F6 큐 미적용), AI 파싱 일체(v1 No AI).

## 아키텍처

기존 GmailProvider 패턴을 미러링한다.

### `src/main/calendar.ts` (신설)

```
interface CalendarProvider {
  listEvents(timeMinISO, timeMaxISO): Promise<CalendarEvent[]>
  respondToEvent(iCalUID, response: 'accepted'|'tentative'|'declined'): Promise<void>
  createEvent(input: CreateEventInput): Promise<CalendarEvent>
}
```

- `RealCalendarProvider` — 기존 `Auth.OAuth2Client` 재사용, `google.calendar({version:'v3', auth})`. googleapis ^173에 calendar_v3 포함 — **신규 의존성 0**.
  - `respondToEvent`: `events.list({iCalUID})`로 이벤트 특정 → 본인 attendee의 `responseStatus`를 `events.patch`.
  - `createEvent`: primary 캘린더에 `events.insert` (attendees 포함, `sendUpdates: 'all'`).
- `MockCalendarProvider` — 데모 이벤트 시드(오늘 2건+내일 1건), 기존 Mock 패턴(`callCounts`/`delay()`/`failIfOffline()`) 동일 적용.
- provider 생성/선택은 `ipc.ts`의 기존 sign-in/restore 핸들러에서 GmailProvider와 함께.

### OAuth scope & 재동의 (`src/main/auth.ts`)

- `SCOPES`에 `https://www.googleapis.com/auth/calendar.events` 1개 추가 (아젠다 읽기+RSVP patch+생성 전부 커버).
- 저장 토큰에는 scope 검사 로직이 현재 없음 → 세션 복원 시 토큰 응답의 `scope` 문자열에 calendar.events 포함 여부를 검사해 `AccountInfo.calendarReady: boolean`으로 renderer에 전달.
- `calendarReady: false`면 **캘린더 기능만 비활성** (메일 무영향, 기존 토큰 강제 무효화 없음). 캘린더 기능 첫 사용 시 "캘린더 권한 필요 — 다시 로그인" 안내 → 기존 signOut→signIn 경로 재사용 (`prompt:'consent'`라 별도 incremental auth 불요).
- 데모 모드는 항상 `calendarReady: true`.

### 초대 감지 (`src/main/gmail.ts` 확장)

- `extractBodies()`의 MIME walk를 확장해 `text/calendar`(및 `application/ics`) 파트를 수집.
- **최소 ICS 파서 자체 구현**(main 프로세스, ~50줄): 라인 언폴딩+이스케이프 처리 후 `METHOD/UID/SUMMARY/DTSTART/DTEND/ORGANIZER`만 추출. 날짜는 UTC(`...Z`)와 `TZID=` 파라미터 두 형식만 ISO로 정규화하고, 해석 불가 형식이면 invite 노출을 포기(배너 미표시 — fail-safe). 풀 ICS 라이브러리는 YAGNI(필요 필드 6개) — DECISIONS 기록 대상.
- `METHOD:REQUEST`인 경우만 `MessageDetail.invite?: InviteInfo`로 노출.

### IPC 계약 (기존 4-파일 규약)

1. `src/shared/types.ts` — `CalendarEvent`, `InviteInfo`, `CreateEventInput` 타입 + `ZenmailApi`에 `listEvents`/`respondToEvent`/`createEvent` + `AccountInfo.calendarReady` + `MessageDetail.invite`.
2. `src/main/ipc.ts` — `calendar:list-events` / `calendar:respond` / `calendar:create` 핸들러.
3. `src/main/preload.ts` — 노출.
4. `src/main/calendar.ts` — Real/Mock 구현.

## UI (renderer)

### RSVP 배너 (`ThreadView.tsx`)

- FollowupBanner 자리(헤더 아래, 스크롤 영역 위)에 스레드 내 `invite` 메시지가 있으면 이벤트 요약(제목·일시·주최자) + [수락]/[미정]/[거절] 버튼. 스레드에 invite가 여러 건이면 **가장 최신 메시지의 invite 1건**만 배너로 노출(동일 이벤트 업데이트 재전송이 일반적).
- 스토어 액션은 F4 낙관 5단계 패턴 그대로: `instrument('rsvp')` → 이전 상태 캡처 → 낙관 `set`(배너에 응답 상태 즉시 반영) → `done()` → `await api().respondToEvent()` 실패 시 롤백+`recordRollback`+토스트.
- 응답 후 배너는 현재 응답 상태를 표시(재변경 가능).

### 아젠다 패널 (`AgendaPanel.tsx` 신설)

- kbar 2키 시퀀스 `g→c`(기존 `g,i/s/d/l`과 동일 방식) + kbar 액션 "Open agenda".
- SnoozePicker/StatsPanel 오버레이 템플릿 그대로: store boolean `agendaOpen`, backdrop `bg-black/50` + click-outside close, 패널 `onKeyDown` stopPropagation + Esc close, 오픈 시 autofocus.
- 열 때 `listEvents(오늘 00:00 ~ 내일 24:00)` live fetch — 로딩 상태 표시, 실패 시 패널 내 에러 한 줄. 캐시 없음.
- ⚠️ `useKeyboard.ts`의 **modal guard 배열과 Esc-close 블록 두 곳 모두**에 `agendaOpen`(및 아래 `eventComposerOpen`) 등록 — 누락 시 배경 단축키 누수.

### 이벤트 생성 폼 (`EventComposer.tsx` 신설)

- kbar 액션 "Create event from email" (스레드 선택 컨텍스트 필요, `targetThreadId` 가드).
- 프리필은 결정적 규칙만: 제목=메일 제목(`Re:`/`Fwd:` 접두 제거), 참석자=스레드 참여자 이메일 목록(본인 제외), 날짜/시간=빈 값(사용자 입력 필수). AI 파싱 없음.
- 오버레이 템플릿은 아젠다 패널과 동일. 생성 성공 토스트, 실패 토스트.

## 에러·오프라인 정책

- 캘린더 뮤테이션은 F6 뮤테이션 큐(`attemptOrEnqueue`) **비대상** — Gmail 라벨 캐시와 무관한 원격 쓰기. 실패 시 즉시 롤백+토스트(transient 재시도 없음, v1 단순화).
- 아젠다 fetch 실패는 패널 내 인라인 에러(토스트 아님).

## 데모 모드 & E2E

- `MockCalendarProvider` 시드 + `buildDemoData()`에 초대 메일 1통(text/calendar 파트, METHOD:REQUEST) 추가 → 세 기능 전부 데모에서 동작.
- `__debug` 훅(기존 `--zenmail-e2e` 게이트): mock 캘린더 상태 조회, 실패 주입 → TC-CAL-* E2E.
- E2E 검증 대상: 초대 배너 표시/RSVP 낙관+롤백, `g→c` 아젠다 열기/Esc/단축키 차단, 생성 폼 프리필 규칙, calendarReady=false 게이트(데모에선 debug 훅으로 시뮬레이션).

## 프로세스

DEV_WORKFLOW Goal 0~8 준수: 이 스펙 승인 → feature PRD(`docs/features/calendar-integration/PRD.md`) → checkpoint TODO → If-When-Then TC → DECISIONS(ICS 자체 파서, 큐 비대상, calendarReady 게이트 등) → react-best-practices → audit → E2E 전부 통과 → Obsidian 기록.
