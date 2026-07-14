# inbox-zero-starred — DECISIONS

> 2026-07-14. 설계 병렬: deep-reasoner(Opus) 독립 2인스턴스 동일 브리프(A/B) → 오케스트레이터 합성.
> ⚠️ Codex는 사용량 한도(리셋 2026-08-02)로 불참 — 동일 모델 2인스턴스라 독립성이 약함을 명시(F3 선례).
> 핵심 아키텍처(D1·D2·D4·D6)는 A/B **완전 수렴**. 갈린 축은 D3·D5·D7에 판정 근거와 함께 기록.

## D1. 단일 공유 술어 `isInInboxView` (src/shared/view.ts) — A/B 수렴
- 인박스 뷰 = (INBOX ∨ STARRED) ∧ ¬TRASH ∧ ¬SPAM ∧ ¬snoozed. main(Mock provider, cache 리더)과 renderer(applyThreadsDiff, 낙관 판정)가 공유.
- 계층별 하드코딩 기각: 네 곳이 필연적으로 어긋남(이번 버그의 축소판). Real provider만 q 문자열로 번역(형태만 다름).
- STARRED의 ThreadSummary boolean 승격 기각 — labelIds로 충분, 스키마 무변경.

## D2. Real provider q 번역은 프로바이더 내부에서만 — A/B 수렴
- `req.labelIds === ['INBOX']` && !q && (pageToken은 통과)일 때 `q = '(in:inbox OR is:starred) -in:trash -in:spam -label:zenmail/snoozed'`, labelIds 미전송.
- **q를 IPC 요청에 넣지 않는 이유**: SWR 자격 판정이 `!req.q && !req.pageToken`(ipc.ts) — 요청에 q가 실리면 인박스 warm-cache 읽기(CP6 SWR) 전체가 무력화된다.
- threads.list의 labelIds는 순수 AND라 OR 표현 불가(두 번 호출 병합은 nextPageToken 병합 불가로 기각).
- 실계정 검증(2026-07-14, Gmail 웹): `in:inbox OR is:starred` = starred-archived 20건 정확 반환, inbox zero 상태에서 `in:inbox` = 0건. API 페이지네이션 동작은 D9 스모크에서 재확인.

## D3. 부활 가드: applyLabelDelta의 로컬-델타 타임스탬프(15s grace) + hasPendingMutations — A/B 합성
- 갈린 축: A는 in-memory `recentlyMutatedAt` Map(15s grace), B는 `updated_at > fetchStartedAt` 컬럼 비교.
- **B 단독 기각 이유**: `updated_at`은 서버 upsert(upsertThreads)도 bump하므로 로컬/서버 기원을 구별 못 함 — revalidate 자신이 쓴 upsert가 다음 판정을 오염(fetch 직전 로컬 아카이브의 stale-index 부활도 못 막음).
- **채택**: cache.ts가 applyLabelDelta의 **로컬 기원 호출에만** in-memory 타임스탬프를 기록(`origin: 'server'` 플래그로 revalidate발 스트립은 제외). 가드 대상 = `hasPendingMutations(id) ∨ localDeltaAt(id) > fetchStartedAt − 15_000`. 가드된 id는 revalidate의 **upsert·removal·cache 기록 세 곳 모두**에서 제외(B가 지적한 "upsertThreads 무조건 기록이 낙관 아카이브를 덮는 기존 잠재 버그"도 이걸로 닫힘 — D14 부활 리스크의 구조적 완화).
- grace 15s는 Gmail list 인덱스 지연 추정치 — 실계정 로그로 튜닝 여지(D9).

## D4. removal 수렴 규칙: 완전-페이지 권위 + bounded window, 열거는 뷰 전체 캐시 행 — B 채택(A 결함 보정)
- fresh에 `nextPageToken` **없음** = 그 뷰의 전수 → removal 후보 = **뷰 매칭 전체 캐시 행**(신규 `cache.getViewRows(label)`, LIMIT 없음) − fresh id 집합.
- `nextPageToken` 있음 = 부분 창 → `date ≥ min(fresh date)`인 부재 행만 제거, 창 밖(더 오래된) 행은 판단 보류.
- **A의 "비교는 반환했던 cached 페이지(top-50)" 기각**: 84행 케이스에서 51~84번이 캐시에 남아 cold-read마다 부활 — A 스스로의 "1사이클 수렴" 주장과 모순(B가 정확히 진단).
- 제거 시 행 삭제가 아니라 `applyLabelDelta(id, [], viewMembershipLabels(view))`로 뷰 라벨 스트립(INBOX 뷰는 INBOX+STARRED 동시) — FTS·타 라벨 뷰·undo용 행 보존, 기존 D3(sync-engine) 프리미티브 재사용, 멱등.
- 84행 오염 캐시는 코드 수정만으로 **첫 revalidate 1사이클에 자동 수렴**(마이그레이션 없음). 첫 실행이 오프라인이면 transient 보류 후 재접속 시 수렴(수용).

## D5. unstar-drops-row는 toggleStar의 명시적 낙관 제거 — B의 render 백스톱 기각
- B는 selectVisibleThreads(INBOX_TAB)에 술어 1차 필터(render 백스톱)를 제안 — unstar가 자동 처리된다는 장점.
- **기각 이유**: 시그니처 변경이 FollowupPicker·splits.test 전반에 파급되고, 리스트 멤버십 판정이 store(낙관)와 render(백스톱) 두 곳으로 갈라져 기존 TC의 카운트 불변식을 은폐할 수 있음. archiveThread가 이미 "조건부 제거" 분기를 갖게 되므로 toggleStar도 **동일 패턴의 명시 분기**(델타 적용 후 `inLabelView` false면 captureRemoval+제거)가 대칭적이고 국소적.
- diff 경로는 술어가 처리: unstar 성공 → pushThreadUpsert → applyThreadsDiff에서 inView=false → 드롭(수렴).

## D6. snooze 배제 3중화 — A/B 수렴(형태 합성)
- renderer: 술어에 snoozeLabelId(로드된 labels에서 SNOOZE_LABEL_NAME으로 파생) — snooze 낙관/upsert가 starred여도 인박스 재유입 안 함.
- main cache 리더: 라벨 id를 모르므로 로컬 truth `snoozes` 테이블 서브쿼리로 배제(wake 시 데몬이 행을 지우고 needsRefetch — 기존 흐름 그대로 복귀).
- real q: `-label:zenmail/snoozed`(hydration 절감 겸 정확성; 존재하지 않는 라벨이면 Gmail이 무시).

## D7. star 토글(s)·인디케이터 동시 출하 — A/B 수렴
- 앱에 star 기능이 전무한 상태에서 뷰만 바꾸면 starred-archived 행이 "왜 여기 있는지" 비가독 + unstar 경로를 앱 안에서 행사·검증 불가(반쪽 기능). 최소 구현(kbar 's', ThreadRow ★, ThreadView 헤더 토글, 낙관+롤백)을 함께 출하.
- 단일 `s`는 미점유(`g s` 시퀀스와 kbar가 구별). 사이드바 Starred 전용 뷰는 논스코프.

## D8. 사이드바 INBOX 배지 ≠ 리스트 카운트 — 의도된 불일치 수용 (A/B 수렴)
- 배지는 Gmail literal INBOX unreadCount 유지(배지 의미 = "인박스 unread", 리스트 = "인박스 + 별표"). archived-unread-starred가 리스트에 보여도 배지 미포함 — v1 수용, 흔해지면 재검토.

## D9. 실계정 잔여 검증 항목 (sync-engine D14 백로그 승계)
- threads.list({q}) 페이지네이션·정렬 실측(Gmail 웹 검색으로는 확인 완료), grace 15s 튜닝, `-label:zenmail/snoozed` 문법(슬래시 포함 이름) 동작.

## D10. grace 가드는 실계정 전용(mock=0) — E2E 실측으로 발견·수정
- **증상**: 구현 직후 전체 E2E에서 TC-FUP-D2·TC-FUP-E2·TC-SP-C2·TC-SY-B5 4건이 새로 FAIL(베이스라인 worktree 대조로 "내 변경이 원인" 확정, 사전 존재 플레이크 아님).
- **근본 원인**: D3의 15s grace가 **모든 provider에 무조건 적용**됐다. grace의 설계 의도는 "실계정 Gmail list 인덱스 전파 지연 동안 스테일 fresh가 낙관 아카이브를 되살리는 것"을 막는 것(D14 부활 리스크) — 그런데 mock provider는 자체 상태에 대해 **항상 동기적으로 최신**이라(F6 sync-engine D1 주석 "mock provider is synchronous... E2E is unaffected"가 이미 명시) 이 리스크가 물리적으로 존재하지 않는다. 반대로, 데몬(followup 발화 `snooze.ts:110-115`, 스누즈 웨이크)은 `provider.modifyThread`를 **캐시를 거치지 않고 직접 호출**한 뒤 `needsRefetch: true`로만 렌더러에 알린다 — 로컬 아카이브 수 초~십수 초 뒤 데몬이 같은 스레드를 정당하게 되살리는 것은 정상 설계(TC-FUP-D2가 정확히 이 경로: send&archive → 11.4s 뒤 팔로업 발화 → INBOX 복귀 기대). grace가 mock에도 걸리면 이 정당한 복원 upsert까지 최대 15초간 억제해 자기모순적으로 회귀를 만든다.
- **디버깅 경로(계측 3단계)**: ① `page.evaluate(fetchThreads)` 직접 호출로 렌더러 우회 진단 → cache 자체가 스레드 부재를 반환함을 확인(DOM 타이밍 문제 아님, single-shot 폴링 10회×500ms로도 불변 — 확정적 결함). ② `fetchThread('demo_1')`로 진짜 ground truth 조회 → INBOX가 정말 사라짐(스테일 표시가 아니라 실제 캐시 손상). ③ 세션 전반에 체크포인트를 촘촘히 심어 이분 탐색 → 손실 시점을 `scenario_cal_E`의 TC-CAL-E2("archive top selected", 최신 스레드=demo_1을 실제로 아카이브)로 확정, `mail:debug-queue-depth`로 pending mutation 개입 배제(0건) → 남은 유일한 변수는 grace 가드.
- **결정**: `ipc.ts`의 `GRACE_MS`를 `p.demo ? 0 : 15_000`으로 provider별 분기. Real Gmail에서만 15s 보호가 적용되고, mock(모든 E2E)에서는 가드가 사실상 no-op(hasPendingMutations만 남음).
- **검증**: 수정 후 전체 스위트 0 FAIL ×2연속(SKIP은 캐논 집합과 정확히 일치), TC-SP-C2·TC-SY-B5도 **같은 클래스**(레이스 창에서 mock 신선 페이지가 정당한 최신 상태를 반영했는데 grace가 막음)로 확인 — 별도 수정 불필요, 이 한 줄로 4건 전부 해소.
- **잔여 리스크**: real Gmail에서 "아카이브 직후 수 초 내 데몬이 재-INBOX"하는 케이스(팔로업처럼)는 grace 15s 동안 여전히 억제될 수 있음 — 실계정에서 팔로업 발화 타이밍과 grace가 겹치는 시나리오는 D9의 실측 대상에 추가.

## D11. `/code-review low` 반영 2건
- **cache.ts getThreads('INBOX') 언더페치**: LIMIT 100 프리필터 뒤에 JS `isInInboxView`로 TRASH/SPAM을 걸러내고 상위 limit(50)을 slice하던 구조는, 상위 100행에 TRASH/SPAM 잔류 행이 몰리면 유효 행이 50개 미만으로 반환될 수 있었다(뒤쪽 유효 행을 SQL이 애초에 안 봄). SQL에 `label_ids NOT LIKE '%"TRASH"%' AND NOT LIKE '%"SPAM"%'`을 직접 추가해 프리필터를 isInInboxView와 동치로 맞추고 LIMIT을 `limit`(50)에서 바로 적용 — JS 필터는 공유 술어 단일 소스 불변식(D1) 유지용 미러로 남기되 실질적으로 no-op. `getViewRows`도 동일 조건 추가(대칭성, 원래도 LIMIT이 없어 버그는 아니었음).
- **gmail.ts Mock/Real provider q 분기 불일치**: RealGmailProvider의 인박스뷰 라우팅 가드는 `!req.q`를 포함하는데 MockGmailProvider는 누락 — `labelIds:['INBOX']`와 `q`를 동시에 받는 요청(현재 어떤 호출자도 만들지 않음, 잠재적)에서 두 provider가 다른 시맨틱으로 갈릴 수 있었다. Mock에도 `!req.q` 추가로 parity 확보.

## D12. 실계정 스모크 결과 (2026-07-14, `npm start` real OAuth, 사용자 실DB)
- 앱이 현재 실행 중이지 않음을 `ps` 확인 후, 격리 없이(기본 userData) `electron-forge start` + `ZENMAIL_E2E_PORT`로 CDP 연결 → 읽기 전용(`window.zenmail.fetchThreads`)으로만 검증, 어떤 쓰기 IPC도 호출하지 않음.
- **결과**: `fetchThreads({labelIds:['INBOX']})` → **22건**(수정 전 84건에서 정상 수렴), 그중 STARRED∧¬INBOX(=archived-but-starred) **20건** — Gmail 웹에서 사전 검증한 `in:inbox OR is:starred` 쿼리의 20건과 정확히 일치. DOM 렌더 행 수(22)도 fetch 결과와 일치, UI가 실제로 반영함을 확인.
- 샘플 스레드 라벨 확인: 순수 INBOX 항목("Your Supabase Project...", "회의록: ...")과 STARRED-only archived 항목("[법무검토-최종 검토]...", "[동양생명 퇴직연금]...")이 date DESC로 올바르게 혼합 표시됨 — 버그 리포트의 원 증상(85행 스테일 인박스)과 요구사항(starred는 archived여도 표시) 모두 실계정에서 직접 확인.
- 남은 실계정 미검증 항목(D9)은 여전히 유효: grace 15s의 실측 튜닝, `-label:zenmail/snoozed` 문법의 slash-포함 라벨명 동작.

## ⚠️ 사용자 미확인 결정 (복귀 시 확인 관례)
- D6의 "snoozed-starred는 인박스에서 숨김"(snooze 의도 우선) — Superhuman도 동일하나 사용자 취향 확인 요망.
- D7 최소 star UI의 형태(★ 글리프 위치), D8 배지 시맨틱.
