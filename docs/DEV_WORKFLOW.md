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

## 현재 상태 스냅샷 (2026-07-04)

- **F3 keyboard-mastery 완료**: Goal 0~8 완주. `?` 치트시트(kbar 소유) + 계측 2층(store 종단 bumpStat + dispatch modality) + 힌트/마일스톤(CoachToastHost) + StatsPanel + 인터랙티브 튜토리얼(capture-phase 중재, 파괴 키 상시 삼킴). 저장은 localStorage(`zenmail-coach`, coach 스토어 persist). E2E 93건 90 PASS·0 FAIL·3 SKIP(F1 기존), vitest 40. ⚠️ 설계 병렬은 Codex 사용량 한도(2026-08-02 리셋)로 deep-reasoner 2인스턴스 대체(D4). D3(힌트 방식)·D13(설계 승인)은 사용자 무응답 추천안 — 복귀 시 확인. 다음: **F4 Goal 0**.
- **F2 follow-up-reminders 완료**: Goal 0~8 완주. remind-if-no-reply + `h` follow-up + 데몬 3루프 + fired 핀. E2E 58 PASS·0 FAIL(F1 회귀 포함). 디버그 IPC는 `--zenmail-e2e` argv 플래그로 노출.
- **F1 split-inbox-plus 완료**: Goal 0~8 완주. 스플릿 탭 바 + 로컬 규칙 매칭 + 설정 모달 + 영속화. E2E 하네스 `zenmail/e2e/run-tc.mjs`(playwright-core CDP, `node e2e/run-tc.mjs`) 신설 — TC 35 PASS·3 SKIP·0 FAIL. vitest 도입(`npm test`). ⚠️ /impeccable 미설치라 web-design-guidelines로 대체(D14). 다음: **F2 Goal 0**.
- **MVP 완료**: 스펙(docs/MAIL_APP_SPEC.md) §8 빌드 순서 1~12 전부 구현·검증됨. TODO.md 46/49.
- **구조**: `zenmail/` Electron 33 + React 19 + Tailwind v4 + zustand + kbar + better-sqlite3. main process(auth/gmail/cache/snooze/ipc) + renderer(store/components/hooks). 데모 모드(mock provider) 내장.
- **실행**: `cd zenmail && npm start` (데모 모드). 실계정: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` env 또는 `~/Library/Application Support/zenmail/config.json`.
- **OAuth 진행 상황**: 사용자가 dreamus.io Internal 프로젝트(번호 63954981092)에 동의 화면 + 스코프 설정 완료. Gmail API enable 단계에서 에러 발생 → enable 안내까지 완료, **실계정 로그인 E2E 최종 확인은 미완**.
- **알려진 백로그**: 예약 전송 경로가 `archive` 플래그 무시(UI에서 도달 불가라 보류), External/Testing 모드였다면 7일 토큰 만료(Internal이라 해당 없음).
- **빌드 주의사항**: vite config는 `.mts`(ESM 전용 플러그인 때문), `@vitejs/plugin-react`는 v4 고정(vite 5), googleapis 타입 충돌 시 `npm dedupe`.

## 새 세션 재개 절차

1. 이 문서 + TODO.md + 직전 feature의 `docs/features/<slug>/` 문서 읽기
2. `git log --oneline -10`으로 마지막 커밋 확인
3. 진행 중 feature가 있으면 그 TODO의 `[~]` 항목부터, 없으면 다음 순서 feature의 Goal 0(plan)부터
