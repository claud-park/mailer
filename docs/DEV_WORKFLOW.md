# ZenMail v1.x Feature Development Workflow

> 2026-07-03 확정. 새 세션은 이 문서 + [CLAUDE.md](../CLAUDE.md) + [TODO.md](../TODO.md)를 읽고 이어서 진행한다.
> 근거 리서치: [RESEARCH_SUPERHUMAN.md](RESEARCH_SUPERHUMAN.md)

## 개발 순서 (사용자 확정)

RESEARCH_SUPERHUMAN.md의 wow factor 번호 기준 **3 → 4 → 2 → 1 → 5 → 6**:

| 순서 | Wow # | Feature slug | 내용 |
|---|---|---|---|
| F1 | #3 | `split-inbox-plus` | Split Inbox 고도화 — 커스텀 스플릿(VIP/뉴스레터/팀), 스플릿 탭·카운트, 설정 UI |
| F2 | #4 | `follow-up-reminders` | Inbox-zero 시스템 — remind-if-no-reply, send & remind (기존 snooze 데몬 인프라 재사용) |
| F3 | #2 | `keyboard-mastery` | 게임형 키보드 UX — 첫 실행 인터랙티브 튜토리얼, 단축키 힌트, 숙련도 피드백 |
| F4 | #1 | `speed-instrumentation` | 100ms 레이턴시 버짓 — 인터랙션 계측, 낙관적 업데이트 전면화, 회귀 감시 |
| F5 | #5 | `detail-density` | 디테일 — Snippets(재사용 문구), Instant Intro 등. read-status(픽셀 트래킹)는 PRD 단계에서 채택 여부 결정 |
| F6 | #6 | `sync-engine` | 오프라인-퍼스트 전면화 — 로컬 우선 읽기, 뮤테이션 큐, 백그라운드 동기화, 충돌 처리 |

## 각 feature의 Goal (사용자 지정 프로세스, 순서 고정)

0. **superpowers 사용**: plan first → develop → test (brainstorming/writing-plans/TDD 등 해당 스킬 필수 invoke)
1. 해당 feature의 **feature PRD** 생성 → `docs/features/<slug>/PRD.md`
2. PRD 기반 **checkpoint TODO** 생성 → `docs/features/<slug>/TODO.md`
3. 두 문서를 활용해 **If-When-Then 구조의 TC** 생성 → `docs/features/<slug>/TC.md`
4. 모든 설계·개발 결정마다 **선택 이유를 문서화** → `docs/features/<slug>/DECISIONS.md`
5. **/react-best-practices** 스킬로 feasible code structuring
6. **/impeccable** 스킬로 UI 검증, audit pass까지 subagent를 통한 feature 완전 개발
7. **TC로 E2E 테스트** — 전부 통과해야 완료
8. **Obsidian에 기록** → `_obsidian/Projects/ZenMail.md` 체크포인트 추가

## 상시 규약 (사용자 지시, 모든 breaking change마다)

1. `/react-best-practices`로 FE 코드 리뷰 + `/code-review low`
2. 커밋 후 `git@github.com:claud-park/mailer.git` (main)으로 push
3. subagent dispatch 시 모델 명시, 기계적 구현의 하한은 Sonnet (~/.claude/CLAUDE.md 오버라이드)

## 현재 상태 스냅샷 (2026-07-13)

- **UI/UX 개선 2종 완료(post-release, 2026-07-13)**: ① `light-mode` — 라이트 테마 **기본값**(사용자 확정), 다크는 kbar "Toggle light/dark theme" 수동 토글 + settings KV persist. Tailwind v4 `@theme` 토큰을 라이트로 교체하고 다크는 `:root[data-theme='dark']` 오버라이드(컴포넌트 21개 무수정), 예외 처리 3곳(iframe srcDoc 테마 분기, labelChipFallback, quoteHtml #ccc 고정) + BrowserWindow backgroundColor(main 동기 getSetting, 시작 플래시 방지). ② `right-reading-pane` — 상세를 상하 40/60에서 **좌우 40/60**(사용자 확정, 리사이저 없음)으로. ThreadList 루트를 section 래퍼로 바꿔 폭 분기 소유(fragment는 flex-row에서 흩어짐), ThreadRow compact 2줄 변형(칩 생략 — 상세 헤더가 대체), 행 높이 56↔64 동적 + virtualizer.measure(). store 무수정(j/k 자동 리딩 등 무회귀 불변식). E2E **156 PASS·0 FAIL·7 SKIP ×2연속**(TC-LM 5 + TC-RP 4 신규). ⚠️ **E2E 집계 관례 수정**: 종전 스냅샷의 "294 PASS·14 SKIP"는 브래킷 라인+결과 테이블 중복 카운트(2×147·2×7)였음 — 이후 기준은 `=== TC Results ===` 블록 상태 컬럼 집계(이번 156·7이 캐논). 하네스 회귀 1건 수습: compact 전환으로 행 textContent가 바뀌어 TC-SP-C3의 classic-캡처 매칭이 깨짐(→ id 캡처를 열기 전으로 이동; abort 오염으로 TC-SY-SendSpill까지 연쇄 FAIL했었음 — **시나리오 mid-abort는 무관해 보이는 하류 실패를 만든다: 하류 FAIL 조사 전 최상류 FAIL부터 고칠 것**). /impeccable은 미설치(F1 D14 선례)로 react-best-practices+code-review+E2E 기하·색상 실측으로 대체.
- **select-all-in-view 완료(post-release, 2026-07-07)**: ⌘A로 현재 뷰 전체선택 → 기존 단축키(e/#/I/U/l/b)를 그대로 일괄 적용(Gmail식). 개별 체크박스/범위선택은 v1 범위 외(YAGNI). 집계 토스트 1건, 액션 후 자동 해제. 브레인스토밍 질문 60s 무응답 → 추천안 채택(DECISIONS D1~D5 ⚠️ 미확인 — 복귀 시 확인). E2E 294 PASS·0 FAIL·14 SKIP(B2/B4는 데모 시드상 무회귀-안전한 격리 대상 부재로 SKIP, 사유 TC.md 기록).
- **F6 sync-engine 완료 — v1.x 로드맵(F1~F6) 완주**: Goal 0~8 완주. 읽기 로컬-퍼스트(fetch-thread/threads 캐시-퍼스트 SWR, 검색·페이지네이션 제외), diff-push(D1: threads-changed upserts — 뮤테이션 hot path 재fetch 0, 데몬·send는 needsRefetch 절충), 뮤테이션 큐(Option B: 낙관 직행+transient만 폴백, per-thread 장벽, 데몬 drain+backoff+재접속 트리거), 실패 분류(D5: 미분류=영구 fail-safe — TC-SP 롤백 무수정 보존), send spill(scheduled_sends backoff), 사이드바 sync 한 줄. E2E 142건 136 PASS·0 FAIL·5 SKIP(기존3 + B2/C3 사유), warm-hit openThread:content p50 ~14-21ms, send exactly-once, 아카이브 churn ~50콜→0 실증. 잔여 백로그: 실계정 검증(D14 — eventual consistency·warm nextPageToken), F4 D8·F3 D3/D13 사용자 확인.
- **F5 detail-density 완료**: Goal 0~8 완주. 사용자 확정 3건(read-status 기각·⌘; 피커·Instant Intro 채택). Snippets(settings KV JSON·신규 IPC 0·plain text+textToFragment, Range 스냅샷+execCommand insertText 1차/insertNode 폴백 — ⌘Z 1스텝), SnippetsManager(kbar), Instant Intro(구조∧길이≤2∧키워드 AND 게이트, 배너 원클릭·자동적용 금지, demo_20 시드). E2E 128건 125 PASS·0 FAIL·3 SKIP. 수습: demo_20 date 최고령 이동(F2 인덱스 가정), 실패 주입 400ms 지연(즉시 throw는 TC-SP-C2 동시성 창 붕괴 — C3 3단계 settle). 다음: **F6 Goal 0**.
- **F4 speed-instrumentation 완료**: Goal 0~8 완주. 측정 구간 = 스토어 액션 진입→낙관 set의 double-rAF 페인트 커밋(D1·D2), lib/latency+optimistic 순수 코어(vitest 73), 뮤테이션 6종 계측+엔티티별 롤백(실패 시 refresh 조정, D4), followup 3종 낙관화, openThread select/content 분리(content는 F6 베이스라인), 숨김 LatencyHud(⌘⌥⇧L), `zenmail-latency` 위반 집계만 persist, 실패 주입 debug IPC, F3 부채 완화(D12: recordEfficient를 perform 뒤로). E2E 112건 109 PASS·0 FAIL·3 SKIP(F1 기존), markRead burst p50 ~13ms. ⚠️ D8(사용자向 레이턴시 UI 0) 미확인 추천안 — 복귀 시 확인. 다음: **F5 Goal 0**.
- **F3 keyboard-mastery 완료**: Goal 0~8 완주. `?` 치트시트(kbar 소유) + 계측 2층(store 종단 bumpStat + dispatch modality) + 힌트/마일스톤(CoachToastHost) + StatsPanel + 인터랙티브 튜토리얼(capture-phase 중재, 파괴 키 상시 삼킴). 저장은 localStorage(`zenmail-coach`, coach 스토어 persist). E2E 93건 90 PASS·0 FAIL·3 SKIP(F1 기존), vitest 40. ⚠️ 설계 병렬은 Codex 사용량 한도(2026-08-02 리셋)로 deep-reasoner 2인스턴스 대체(D4). D3(힌트 방식)·D13(설계 승인)은 사용자 무응답 추천안 — 복귀 시 확인. 다음: **F4 Goal 0**.
- **F2 follow-up-reminders 완료**: Goal 0~8 완주. remind-if-no-reply + `h` follow-up + 데몬 3루프 + fired 핀. E2E 58 PASS·0 FAIL(F1 회귀 포함). 디버그 IPC는 `--zenmail-e2e` argv 플래그로 노출.
- **F1 split-inbox-plus 완료**: Goal 0~8 완주. 스플릿 탭 바 + 로컬 규칙 매칭 + 설정 모달 + 영속화. E2E 하네스 `zenmail/e2e/run-tc.mjs`(playwright-core CDP, `node e2e/run-tc.mjs`) 신설 — TC 35 PASS·3 SKIP·0 FAIL. vitest 도입(`npm test`). ⚠️ /impeccable 미설치라 web-design-guidelines로 대체(D14). 다음: **F2 Goal 0**.
- **MVP 완료**: 스펙(docs/MAIL_APP_SPEC.md) §8 빌드 순서 1~12 전부 구현·검증됨. TODO.md 46/49.
- **구조**: `zenmail/` Electron 33 + React 19 + Tailwind v4 + zustand + kbar + better-sqlite3. main process(auth/gmail/cache/snooze/ipc) + renderer(store/components/hooks). 데모 모드(mock provider) 내장.
- **실행**: `cd zenmail && npm start` (데모 모드). 실계정: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` env 또는 `~/Library/Application Support/zenmail/config.json`.
- **릴리즈 트랙 완료(2026-07-07)**: 실계정 OAuth E2E 확인(토큰 자동 복원·실 인박스 렌더, 읽기 전용) + DMG/ZIP 패키징 검증. 패키징 함정 2건 수정: ① forge vite 템플릿은 externals(better-sqlite3/keytar/googleapis/squirrel)를 asar에 안 실음 — 개발 트리 안에서는 모듈 해석이 asar 밖으로 걸어 올라가 우연히 동작하는 착시(packageAfterCopy 폐쇄 복사 훅으로 해결, 스모크는 반드시 프로젝트 밖 경로에서), ② FusesPlugin이 adhoc 서명을 파손(resetAdHocDarwinSignature: true). 참고: fuses의 EnableNodeCliInspectArguments=false는 패키지 앱의 remote-debugging-port도 차단(CDP 스모크 불가 — 의도된 보안). 정식 배포는 osxSign+공증 필요.
- **알려진 백로그**: 예약 전송 경로가 `archive` 플래그 무시(UI에서 도달 불가라 보류), External/Testing 모드였다면 7일 토큰 만료(Internal이라 해당 없음).
- **빌드 주의사항**: vite config는 `.mts`(ESM 전용 플러그인 때문), `@vitejs/plugin-react`는 v4 고정(vite 5), googleapis 타입 충돌 시 `npm dedupe`.

## 새 세션 재개 절차

1. 이 문서 + TODO.md + 직전 feature의 `docs/features/<slug>/` 문서 읽기
2. `git log --oneline -10`으로 마지막 커밋 확인
3. 진행 중 feature가 있으면 그 TODO의 `[~]` 항목부터, 없으면 다음 순서 feature의 Goal 0(plan)부터
