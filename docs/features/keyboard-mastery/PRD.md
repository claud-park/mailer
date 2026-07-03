# F3 keyboard-mastery — Feature PRD

> 2026-07-03 · Goal 1 산출물. 설계: deep-reasoner(Opus) 독립 2인스턴스 병렬 → 합성([DECISIONS.md](DECISIONS.md) D4~). Codex는 사용량 한도로 불참(D4).
> 상위: [DEV_WORKFLOW.md](../../DEV_WORKFLOW.md) · [RESEARCH_SUPERHUMAN.md](../../RESEARCH_SUPERHUMAN.md) wow #2 (+#9 온보딩의 셀프서브 버전)

## 1. 목적

키보드 숙련에 보상이 따르는 "게임형" 숙련 곡선을 셀프서브로 만든다. Superhuman의 1:1 화이트글러브 온보딩("단축키 체화 = activation")을 (a) 첫 실행 인터랙티브 튜토리얼, (b) 마우스 사용 시 단축키 힌트, (c) 절제된 숙련도 통계·마일스톤으로 대체한다. 톤은 "미니멀 프로 도구" — 레벨/배지/XP 게임화는 하지 않는다.

## 2. 범위

### In
- **인터랙티브 튜토리얼**: 첫 실행 시 자동 시작(사용자 확정 D1), Esc/Skip으로 즉시 탈출, 팔레트 "Start tutorial"로 재진입. 실 인박스 위에서 j→k→Enter→Esc→e(인터셉트)→c→Esc(discard) 순으로 실제 키를 눌러 체화. 파괴 키(e/#)는 튜토리얼 활성 중 항상 삼킴 — 실제 아카이브 절대 발생 안 함(D7).
- **`?` 치트시트**: 전체 단축키 오버레이(kbar 소유 우선, 실패 시 useKeyboard 폴백 — D8). 팔레트 "Keyboard shortcuts"로도 진입.
- **단축키 힌트**: 단축키 등가물이 있는 마우스 어포던스 사용 시 비침입 토스트("Press C to compose"). 대상 6종(§3-3). 힌트당 누적 3회 + 세션당 1회 캡, "팁 그만 보기" 전역 뮤트(D3·미확인 가정).
- **숙련도 통계**: 키보드 사용 비율(dual-modality 액션만 분모 — D10), 주간 처리량(archive/trash/snooze), 누적 카운트. 팔레트 "Your stats" → 읽기전용 모달(D11).
- **마일스톤**: 조용한 1회성 토스트 — 첫 아카이브 / 첫 스누즈 / 첫 리마인드(h) / 첫 팔레트(⌘K) / 첫 검색 / 100번째 아카이브 / 키보드 비율 80% 첫 돌파.
- **영속화**: 전량 localStorage(별도 coach zustand 스토어 + persist — D6). main/IPC 변경 0.

### Out
- 레벨·배지·XP·스트릭(사용자 확정 기각 — D2)
- 상시 힌트 바, 호버 배지(D3 기각 대안)
- 일별 통계 히스토리·차트(D10 — 주간 단일 카운터로 충분)
- 서버/SQLite 저장(D6), AI 제안(No AI, 스펙 §9)

## 3. UX 스펙

### 3-1. 튜토리얼
- 코치 버블(다크 고밀도 톤): 스텝 프롬프트 + `kbd` 강조 + "Skip (Esc)" 안내. 대상 영역 스포트라이트(anchor: list/thread/toolbar).
- 스텝: ① `j` 아래로 ② `k` 위로 ③ `Enter` 열기 ④ `Esc` 닫기 ⑤ `e` 아카이브(**인터셉트** — "실전에서 가장 많이 쓰는 키" 설명만, 실제 아카이브 없음) ⑥ `c` 컴포즈 ⑦ `Esc` discard → 완료 카드("You're ready. `?` 로 언제든 치트시트").
- 진행 판정: 올바른 키 입력 감지(`e.key ∈ step.keys`). 비파괴 키는 통과시켜 실제 효과를 체감(D7).
- 종료(완주·스킵 공통): `tutorialSeen=true` → 다시 자동 시작 안 함. 재진입은 팔레트.
- 자동 시작 조건: 계정+스레드 로드 완료 && `!tutorialSeen`.

### 3-2. 치트시트 (`?`)
- 전체 오버레이, `lib/shortcuts.ts` 정본 카탈로그에서 렌더(섹션: Actions/Navigation/View/Help). Esc 닫기, keydown stopPropagation(모달 규약).
- 입력 중(`isTyping`)에는 절대 열리지 않음.

### 3-3. 힌트 (마우스 어포던스 → 단축키)
| 어포던스 | 힌트 |
|---|---|
| Toolbar Compose 버튼 | `C` |
| Toolbar Split 토글 | `⌘⇧I` |
| Sidebar Inbox/Sent/Drafts 행 | `g i` / `g s` / `g d` |
| ThreadList 행 클릭(열기) | `j`/`k` + `↵` |
| SplitTabBar 탭 클릭 | `Tab` · `⌘1–9` |
| ThreadList 스와이프 아카이브 | `E` |

- 토스트 문구: "**Press C** to compose · 팁 그만 보기". ~4초 유지. 기존 액션 토스트(2.5s 단일 슬롯)와 **독립 슬롯**(D9).

### 3-4. 통계 모달
- 키보드 비율(큰 숫자, tabular-nums), 이번 주 처리량, 누적(archived/sent/snoozed/reminded), 획득 마일스톤 체크리스트. 읽기전용, Esc 닫기.

## 4. 아키텍처 (합성 설계 — 근거는 DECISIONS D5~D12)

### 4-1. 계측 2층 (D5)
- **Layer A(totals·마일스톤)**: `store/mail.ts` 종단 액션(`archiveThread/trashThread/snoozeThread/send/scheduleFollowup/...`) 끝에 `bumpStat('archive')` 1줄 가산 — 모든 경로(kbar/마우스/스와이프)가 수렴하는 단일 퍼널.
- **Layer B(modality 비율)**: 호출 지점 태깅 — kbar `perform` 일괄 래핑(`recordEfficient(id)`), `useKeyboard` 내비 케이스, 마우스 onClick 6곳(+스와이프)에 `recordMouse(id)`. 비율은 dual-modality 집합(compose/toggleSplit/openThread/goToLabel/switchTab/archive-스와이프)만 계산.

### 4-2. 상태·저장 (D6)
- 신규 `store/coach.ts`(zustand + persist→localStorage, partialize): counters·weekProcessed·firsts·milestonesShown·hintsShown/muted·tutorialSeen + 휘발 상태(튜토리얼 active/step, 토스트 큐, cheatSheetOpen/statsOpen).
- 순수 규칙은 `lib/coach.ts`(비율·주간 리셋·힌트 게이팅·마일스톤 경계 — vitest 대상), 정본 단축키 카탈로그는 `lib/shortcuts.ts`, 스텝은 `lib/tutorial.ts`.

### 4-3. 파일
- 신규: `store/coach.ts`, `lib/coach.ts`, `lib/shortcuts.ts`, `lib/tutorial.ts`, `lib/coach.test.ts`, `components/CheatSheet.tsx`, `components/Tutorial.tsx`, `components/CoachToastHost.tsx`, `components/StatsPanel.tsx`
- 수정(가산): `CommandPalette.tsx`(perform 래핑 + Help 액션 3종), `useKeyboard.ts`(record 1줄씩 + `?` 폴백 시), `Toolbar/Sidebar/SplitTabBar/ThreadList`(onClick 힌트·계측), `store/mail.ts`(bumpStat 1줄씩), `App.tsx`(마운트 + 자동시작 게이트)
- **main/preload/IPC 변경 0.**

## 5. E2E 관점 (D12)
- 하네스 **첫 시나리오 = 튜토리얼 자동시작 검증 + Esc 스킵** → `tutorialSeen` 마킹 → 기존 F1/F2 스위트 언블록. 제품 코드에 E2E 분기 없음.
- ground truth: DOM 어서션 + `page.evaluate(() => localStorage.getItem('zenmail-coach'))`. 신규 디버그 IPC 불필요.
- 게이트: 기존 F1+F2 58 시나리오 + vitest 그린 유지.
