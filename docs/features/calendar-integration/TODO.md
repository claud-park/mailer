# calendar-integration — Checkpoint TODO

> Goal 2 산출물. 각 CP는 tsc + npm test 통과, breaking change 시 리뷰 프로토콜(`/react-best-practices` + `/code-review low` → 커밋 → push). **CP6 전까지 기존 E2E 157 PASS·0 FAIL·7 SKIP 무회귀가 설계 불변식.**
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## CP0. 설계 (Goal 0~4)
- [x] 설계 스펙 확정([2026-07-13-calendar-integration-design.md](../../superpowers/specs/2026-07-13-calendar-integration-design.md)) — 사용자 확정 D1~D4
- [x] PRD/TODO/TC/DECISIONS 작성

## CP1. main 레이어 — ICS 파서 + 초대 감지 (배선 최소, MessageDetail.invite까지)
- [ ] 최소 ICS 파서 자체 구현(main 프로세스, ~50줄): 라인 언폴딩+이스케이프 처리 후 `METHOD`/`UID`/`SUMMARY`/`DTSTART`/`DTEND`/`ORGANIZER` 6필드 추출
- [ ] 날짜 정규화: UTC(`...Z`)/`TZID=` 두 형식만 ISO로, 해석 불가 시 invite 미노출(fail-safe)
- [ ] vitest: 언폴딩/이스케이프/UTC·TZID 파싱/해석 불가 시 undefined 반환 케이스
- [ ] `gmail.ts` `extractBodies()` 확장 — `text/calendar`/`application/ics` MIME 파트 수집
- [ ] `MessageDetail.invite?: InviteInfo` 노출(`METHOD:REQUEST`만) — types.ts 최소 타입 추가
- [ ] `buildDemoData()`에 초대 메일 1통(text/calendar 파트, METHOD:REQUEST) 추가
- [ ] tsc + npm test

## CP2. calendar.ts Provider + scope + calendarReady + IPC 4-파일 계약
- [ ] `src/main/calendar.ts`: `CalendarProvider` 인터페이스(`listEvents`/`respondToEvent`/`createEvent`)
- [ ] `RealCalendarProvider` — 기존 `Auth.OAuth2Client` 재사용, `google.calendar({version:'v3', auth})`
  - [ ] `respondToEvent`: `events.list({iCalUID})` → 본인 attendee `responseStatus` → `events.patch`
  - [ ] `createEvent`: primary 캘린더 `events.insert`(attendees 포함, `sendUpdates: 'all'`)
- [ ] `MockCalendarProvider` — 데모 이벤트 시드(오늘 2건+내일 1건), 기존 Mock 패턴(`callCounts`/`delay()`/`failIfOffline()`) 적용
- [ ] `auth.ts` `SCOPES`에 `calendar.events` 추가
- [ ] 세션 복원 시 토큰 `scope` 문자열 검사 → `AccountInfo.calendarReady: boolean`
- [ ] 데모 모드는 항상 `calendarReady: true`
- [ ] `types.ts`: `CalendarEvent`/`InviteInfo`/`CreateEventInput` 타입 + `ZenmailApi`에 `listEvents`/`respondToEvent`/`createEvent` + `AccountInfo.calendarReady`
- [ ] `ipc.ts`: `calendar:list-events`/`calendar:respond`/`calendar:create` 핸들러, provider 생성/선택을 기존 sign-in/restore 핸들러에서 GmailProvider와 함께
- [ ] `preload.ts`: 신규 API 노출
- [ ] `__debug` 훅: mock 캘린더 상태 조회, 실패 주입, calendarReady=false 시뮬레이션(ZENMAIL_E2E_PORT 게이트)
- [ ] tsc + npm test

## CP3. RSVP 배너(ThreadView, 낙관 5단계)
- [ ] ThreadView 헤더 아래·스크롤 영역 위(FollowupBanner 자리)에 invite 배너 — 이벤트 요약(제목·일시·주최자) + [수락]/[미정]/[거절]
- [ ] 스레드 내 invite 여러 건이면 최신 메시지 1건만 노출
- [ ] 스토어 액션 F4 낙관 5단계: `instrument('rsvp')` → 이전 상태 캡처 → 낙관 `set` → `done()` → `await api().respondToEvent()` 실패 시 롤백+`recordRollback`+토스트
- [ ] 응답 후 배너 현재 상태 표시(재변경 가능)
- [ ] "캘린더 권한 필요" 안내(calendarReady=false 시 배너 액션 클릭 가드)
- [ ] tsc + npm test

## CP4. 아젠다 패널(g→c, 오버레이 템플릿, useKeyboard guard 등록)
- [ ] `AgendaPanel.tsx` 신설 — SnoozePicker/StatsPanel 오버레이 템플릿(store boolean `agendaOpen`, backdrop `bg-black/50` + click-outside, 패널 stopPropagation + Esc close, 오픈 시 autofocus)
- [ ] kbar 2키 시퀀스 `g→c` + kbar 액션 "Open agenda"
- [ ] 열 때 `listEvents(오늘 00:00 ~ 내일 24:00)` live fetch — 로딩 상태, 실패 시 패널 내 에러 한 줄
- [ ] ⚠️ `useKeyboard.ts` modal guard 배열 + Esc-close 블록 **두 곳 모두**에 `agendaOpen` 등록
- [ ] calendarReady=false 시 "캘린더 권한 필요 — 다시 로그인" 안내(패널 내 또는 액션 진입 가드) → signOut→signIn 재사용
- [ ] tsc + npm test

## CP5. 이벤트 생성 폼(kbar 액션, 규칙 프리필)
- [ ] `EventComposer.tsx` 신설 — 아젠다 패널과 동일 오버레이 템플릿
- [ ] kbar 액션 "Create event from email"(스레드 선택 컨텍스트 필요, `targetThreadId` 가드)
- [ ] 프리필: 제목(`Re:`/`Fwd:` 접두 제거), 참석자(스레드 참여자 이메일, 본인 제외), 날짜/시간 빈 값
- [ ] 날짜 미입력 시 생성 버튼 비활성/차단
- [ ] 생성 성공 토스트 / 실패 토스트
- [ ] ⚠️ `useKeyboard.ts` modal guard 배열 + Esc-close 블록에 `eventComposerOpen` 등록
- [ ] tsc + npm test

## CP6. E2E TC-CAL 전건 + 무회귀 (Goal 5~8)
- [ ] TC-CAL-A1~A4 (초대 배너 표시/미표시/최신 1건/파싱 불가 fail-safe)
- [ ] TC-CAL-B1~B5 (수락/미정/거절 낙관, 실패 롤백+토스트, 재변경)
- [ ] TC-CAL-C1~C5 (g→c 오픈, 오늘+내일 표시, Esc 닫힘, 배경 단축키 차단, fetch 실패 에러)
- [ ] TC-CAL-D1~D6 (kbar 오픈, 제목/참석자 프리필, 날짜 미입력 차단, 생성 성공/실패 토스트)
- [ ] TC-CAL-E1~E3 (calendarReady=false 재로그인 안내, 메일 기능 무영향, 재로그인 복귀)
- [ ] TC-CAL-F1~F5 (vitest — ICS 파서 순수 로직) · TC-CAL-G1~G2 (회귀 게이트)
- [ ] 기존 E2E 무회귀(157 PASS·0 FAIL·7 SKIP 유지) 1회 이상 재실행
- [ ] `/react-best-practices` 클린 + audit(/impeccable 미설치 — F1 D14 선례대로 web-design-guidelines/실측 대체) + 최종 `/code-review low`
- [ ] TC/TODO/DEV_WORKFLOW/루트 TODO 갱신 + Obsidian 기록
