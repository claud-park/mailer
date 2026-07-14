# calendar-integration — DECISIONS

> Goal 4 산출물. 브레인스토밍 확정([설계 스펙](../../superpowers/specs/2026-07-13-calendar-integration-design.md))에서 사용자 확정 항목(D1~D4)과, 스펙 구현 세부를 다루는 추천안(D5~D8)으로 구성.

## D1. 연동 범위 = 메일 중심(캘린더 뷰 없음) — **사용자 확정**
- **컨텍스트**: 캘린더 연동의 스코프를 얼마나 넓힐지 결정 필요 — 전용 캘린더 뷰(day/week 그리드)를 만들지, 메일 워크플로우 내 접점만 지원할지.
- **선택지**: (a) 메일 중심 — RSVP/이벤트 생성/아젠다 패널 3종 접점만, (b) 전용 캘린더 뷰(day/week) 추가.
- **선택**: (a) 메일 중심.
- **이유**: ZenMail의 정체성은 미니멀 키보드 중심 메일 클라이언트다. 캘린더 뷰를 추가하면 앱의 범위가 이중화되고 유지보수·UX 복잡도가 급증한다. 사용자가 필요로 하는 것은 "메일 워크플로우를 벗어나지 않는 것"이지 "캘린더 앱을 흡수하는 것"이 아니다.

## D2. 아젠다 = 단축키 패널(g→c), 사이드바 상주 기각 — **사용자 확정**
- **컨텍스트**: 오늘/내일 일정을 어떻게 노출할지 — 사이드바에 상시 표시할지, 필요할 때만 오버레이로 열지.
- **선택지**: (a) `g→c` 단축키 오버레이 패널(SnoozePicker/StatsPanel 패턴), (b) 사이드바 하단에 상주 위젯.
- **선택**: (a) 단축키 패널.
- **이유**: 사이드바 상주는 항상 화면 공간을 차지하고 미니멀리즘 원칙(D10, sync-engine 사이드바 한 줄 정책과 동일 기조)과 충돌한다. 필요할 때만 열고 Esc로 즉시 닫히는 오버레이가 "메일 작업으로 바로 복귀"라는 목표에 부합하며, 기존 SnoozePicker/StatsPanel 인프라를 그대로 재사용할 수 있어 구현 비용도 낮다.

## D3. 이벤트 생성 = 수동 폼 + 결정적 규칙 프리필, quickAdd 기각(No AI 경계) — **사용자 확정**
- **컨텍스트**: 이벤트 생성 시 제목/일시/참석자를 어떻게 채울지 — Google Calendar의 `quickAdd`(자연어 파싱 API) 또는 자체 AI 요약을 쓸지, 결정적 규칙만 쓸지.
- **선택지**: (a) 수동 폼 + 결정적 규칙 프리필(제목 접두 제거, 참여자 목록 추출, 날짜는 사용자 입력 필수), (b) `quickAdd`/AI 자연어 파싱으로 날짜·제목까지 자동 추론.
- **선택**: (a) 수동 폼 + 결정적 규칙.
- **이유**: v1은 No AI(스펙 §9)가 명시적 제품 경계이자 차별화 포인트다. `quickAdd`는 Google 서버 측 자연어 해석이라 엄밀히는 로컬 AI가 아니지만, "메일 텍스트에서 일시를 추측한다"는 행동 자체가 사용자에게 예측 불가능한 결과를 줄 수 있어 경계를 흐린다. 결정적 규칙(문자열 접두 제거, 참여자 목록 추출)만 자동화하고 날짜/시간은 항상 사용자가 명시적으로 입력하게 하여 신뢰 가능한 동작을 보장한다.

## D4. 접근 = A안(Calendar API 정공법, `calendar.events` scope 1개) — **사용자 확정**
- **컨텍스트**: 캘린더 접근 방식을 어떻게 구현할지 — 정식 Calendar API를 쓸지, 메일 회신 기반 RSVP로 우회할지, 로컬 캐시를 둘지.
- **선택지**:
  - (A) Calendar API 정공법 — `google.calendar_v3` + OAuth scope `calendar.events` 1개 추가, `listEvents`/`respondToEvent`/`createEvent` 전부 정식 API 호출.
  - (B) `calendar.readonly` scope + 메일 회신으로 RSVP(초대 메일에 Accept/Decline 회신 전송) — 이벤트 생성 기능과 모순(읽기 전용 scope로는 `createEvent` 불가).
  - (C) 로컬 캐시(자체 DB에 이벤트 미러링) — 실시간성 보장 안 되고 동기화 복잡도만 늘어 YAGNI.
- **선택**: (A) 정공법.
- **이유**: B안은 이벤트 생성(FR12) 요구사항과 근본적으로 모순된다(읽기 전용 scope로는 쓰기 불가). C안은 F6 sync-engine 같은 오프라인 캐시 인프라가 이미 메일에 존재하지만, 캘린더는 뮤테이션 빈도가 낮고(스펙상 F6 큐 비대상, D6 참조) 실시간 정확성이 RSVP/생성에서 더 중요해 로컬 캐시의 이점이 크지 않다. A안은 `googleapis` 기존 의존성에 `calendar_v3`가 이미 포함돼 있어 신규 의존성 0으로 구현 가능하고, scope 1개 추가로 세 기능(읽기/응답/생성) 전부를 커버한다.

## D5. ICS 파서 자체 구현(~50줄, 필드 6개), 풀 라이브러리 YAGNI — 추천안
- **컨텍스트**: 초대 메일의 `text/calendar` 파트를 파싱하려면 ICS(iCalendar) 포맷 파서가 필요하다. npm에는 `ical.js`, `node-ical` 등 풀 스펙 라이브러리가 존재한다.
- **선택지**: (a) 자체 최소 파서(라인 언폴딩+이스케이프, `METHOD`/`UID`/`SUMMARY`/`DTSTART`/`DTEND`/`ORGANIZER` 6필드만), (b) `ical.js`/`node-ical` 등 풀 라이브러리 도입.
- **선택**: (a) 자체 최소 파서.
- **이유**: v1이 실제로 필요한 필드는 6개뿐이고(반복 규칙(RRULE)·타임존 DB·알람 등은 범위 밖), 풀 라이브러리는 스펙에 명시된 "필요 필드 6개"에 비해 과설계다. 날짜 정규화도 UTC/`TZID=` 두 형식만 지원하면 충분하며, 해석 불가 형식은 fail-safe로 invite를 노출하지 않는다(배너 미표시 — 크래시나 잘못된 정보 노출보다 "기능 미제공"이 안전). 신규 의존성 추가 없이 main 프로세스 내 ~50줄로 구현 가능해 유지보수 표면적이 최소화된다.

## D6. 캘린더 뮤테이션은 F6 큐(attemptOrEnqueue) 비대상, 실패 시 즉시 롤백+토스트 — 추천안
- **컨텍스트**: F6 sync-engine은 Gmail 라벨 뮤테이션을 오프라인 내성 큐(`attemptOrEnqueue`, per-thread FIFO, transient/permanent 분류)로 처리한다. 캘린더 RSVP/생성도 같은 큐에 태울지 결정 필요.
- **선택지**: (a) 큐 비대상 — 즉시 시도, 실패 시 즉시 F4 스타일 롤백+토스트(재시도 없음), (b) F6 큐에 편입 — transient 실패는 큐 잔류, 데몬 drain.
- **선택**: (a) 큐 비대상.
- **이유**: F6 큐는 "Gmail 라벨 캐시"라는 로컬 SoT(source of truth)를 전제로 낙관 델타를 큐와 원자적으로 적용하는 구조다(F6 D3). 캘린더 이벤트는 그런 로컬 캐시가 없는 순수 원격 쓰기이므로 큐에 편입하려면 캘린더 전용 캐시·큐 인프라를 새로 만들어야 해 범위가 커진다. v1은 단순화를 택해 즉시 실패 시 롤백하는 F4 5단계 패턴을 그대로 재사용한다(offline resilience는 범위 밖으로 명시).

## D7. scope 부족 시 calendarReady 게이트로 캘린더만 비활성화, 재동의는 기존 signOut→signIn 재사용 — 추천안
- **컨텍스트**: 기존 저장 토큰에는 scope 검사 로직이 없다. `calendar.events` scope를 신규 추가하면, 기존 사용자의 저장된 토큰에는 이 scope가 없을 수 있다.
- **선택지**: (a) 세션 복원 시 토큰 scope를 검사해 `calendarReady: boolean`을 계산, false면 캘린더 기능만 국소 비활성화(메일 무영향, 토큰 강제 무효화 없음) — 첫 사용 시 재로그인 안내로 기존 signOut→signIn 흐름 재사용, (b) 기존 토큰을 전부 강제 만료시켜 모든 사용자에게 재로그인을 강제, (c) incremental auth(추가 scope만 별도 요청) 신설.
- **선택**: (a) calendarReady 게이트 + 기존 재로그인 흐름 재사용.
- **이유**: (b)는 캘린더 기능을 쓰지 않는 사용자까지 불필요하게 로그아웃시켜 메일 워크플로우를 방해한다(No 기능 저하 원칙 위반). (c) incremental auth는 Google OAuth 흐름상 구현 가능하지만 별도 인증 플로우·UI가 필요해 구현 비용이 크다. 기존 `signIn()`이 이미 `prompt: 'consent'`를 사용하므로 signOut→signIn 재실행만으로 scope가 자동 갱신된다 — 별도 incremental auth UI 없이 기존 경로로 충분하다.

## D8. 스레드 내 invite 여러 건이면 최신 메시지 1건만 배너 노출 — 추천안
- **컨텍스트**: 회의 시간이 변경되면 조직자가 업데이트된 invite를 같은 스레드에 재전송하는 경우가 흔하다. 스레드 안에 invite가 여러 개 있을 때 배너를 어떻게 노출할지 결정 필요.
- **선택지**: (a) 가장 최신 메시지의 invite 1건만 노출, (b) 스레드 내 모든 invite를 나열, (c) UID로 그룹핑해 최신 UID별 1건씩 노출.
- **선택**: (a) 최신 메시지 1건.
- **이유**: 스펙 범위 밖으로 `METHOD:CANCEL`/`REPLY` 처리를 명시적으로 제외했기 때문에 취소/변경 이력을 추적하는 정교한 UID 그룹핑(c)은 과설계다. 실무적으로 "동일 이벤트 업데이트 재전송"이 가장 흔한 케이스이므로, 스레드에서 가장 최근에 도착한 invite가 사용자가 응답해야 할 최신 상태를 대표한다고 가정하는 것이 단순하고 안전하다. 여러 건을 모두 나열(b)하면 어느 것에 응답해야 하는지 사용자가 혼란스러울 수 있다.

## D9. 구현 중 확정 — 리뷰 루프에서 내린 판정 (2026-07-13)

구현(SDD) 태스크 리뷰에서 계획 문면과 어긋나거나 계획에 없던 결정 5건:

- **D9-1. parseIcs 컴포넌트 스코핑**: 계획의 flat 파서는 VTIMEZONE의 DTSTART(예: DST 전환 시각)가 VEVENT 값을 덮어써 Outlook발 초대를 fail-safe로 떨어뜨림 → BEGIN/END 스택 추적으로 METHOD는 VCALENDAR 레벨, 이벤트 필드는 첫 VEVENT 안에서만 캡처. 부수 효과: extractInvite는 완전한 ICS 래퍼를 요구(실 payload는 항상 포함).
- **D9-2. LatencyAction 유니언에 'rsvp' 추가**: 계획 코드 instrument('rsvp')의 전제가 유니언에 없었음 — 소비처 전수 확인(Partial<Record>/단순 비교뿐) 후 안전 확장.
- **D9-3. openAgenda stale-fetch 가드를 세대 카운터로**: boolean(agendaOpen) 가드는 닫기→재열기/연타 레이스에서 이전 fetch가 새 상태를 덮어씀 → 모듈 레벨 agendaFetchSeq로 latest-wins. "닫힌 뒤 도착 응답 무시"라는 계획 의도의 더 정확한 이행.
- **D9-4. openEventComposer 가드를 activeThread로**: 계획은 targetThreadId 가드 + activeThread 프리필로 내부 불일치(스레드 미오픈 시 빈 프리필) → 가드를 프리필 소스와 일치. "Create event from email"은 열린 메일이 전제.
- **D9-5. 오버레이 단축키 차단 메커니즘 확인(as-designed)**: useKeyboard guard는 자기 소유 키(j/k/Enter/[/]/Esc)만 막고, kbar 소유 단일 키(e 등)는 패널 keydown stopPropagation이 차단 — CLAUDE.md에 문서화된 기존 이중 메커니즘 그대로. TC-CAL-C4가 실측 검증.
- **D9-6. MockCalendarProvider 실패 주입은 failIfOffline이 아니라 one-shot failIfArmed**: 캘린더 뮤테이션은 F6 큐 비대상(D6)이라 온라인/오프라인 상태 시뮬레이션이 의미 없음 — E2E가 필요한 것은 "다음 호출 1회 실패"의 결정적 주입뿐(PRD FR13의 failIfOffline 문구는 Gmail Mock 패턴의 관용적 인용).

## D10. E2E 캐논 재해석 — "157·0·7"의 7번째 SKIP은 런타임 유동 (2026-07-13)

- **컨텍스트**: CP6 무회귀 목표를 "157+25=182 PASS·7 SKIP"으로 뒀으나 실측 183 PASS·6 SKIP(총 189).
- **확인**: 순수 베이스 리비전 실행 대조 결과 pre-CP6 총 어서션은 164이고, TC-SA-B4(select-all destructive bulk-snooze)는 "reserved-free sender 잔존 여부"를 런타임에 판정해 실행마다 PASS/SKIP이 갈리는 pre-existing 특성(의도된 graceful-degradation). 종전 캐논 "157·0·7"은 B4가 SKIP으로 떨어진 특정 실행의 스냅샷.
- **결정**: 이후 무회귀 기준은 고정 PASS 총계가 아니라 **"0 FAIL + SKIP 집합이 기존 집합의 부분집합(신규 SKIP 없음) + 총 어서션 = 기존 총계(164)+신규"**로 판정한다. calendar-integration 완료 시점 집계: 183 PASS·0 FAIL·6 SKIP(총 189) ×2 결정적.

## D11. E2E CAL 블록 배치 — F1 직후·F2 앞 (2026-07-13)

- **컨텍스트**: 계획은 select-all 뒤 배치를 지정했으나 실측 결함 2건: ① select-all의 TC-SA-B2 bulk-trash가 초대 스레드 발신자(events@calendly.example)를 동적 후보로 골라 삼킴, ② F2 뒤 배치는 CAL-E의 signOut(→cache.clearFollowups)이 TC-FUP-E1의 pending followup을 파괴.
- **결정**: CAL을 F1 직후·F2 시작 전에 배치. F2는 자기 시작부(scenario_followup_E2)에서 signOut/재로그인을 하므로 CAL-E 잔여 상태를 흡수. E3의 로그인 관용구도 원시 IPC 대신 검증된 UI 클릭 경로(text=Sign out → demoLogin) 사용.
