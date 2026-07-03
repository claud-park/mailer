# F3 keyboard-mastery — Checkpoint TODO

> Goal 2 산출물. 각 CP는 `npx tsc --noEmit` 통과 + breaking change 시 리뷰 프로토콜(react-best-practices + code-review low → 커밋 → push).
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## CP0. 설계 (Goal 0~4)
- [x] 브레인스토밍(D1~D3 사용자 확인, D3는 무응답 추천안)
- [x] deep-reasoner 독립 2인스턴스 병렬 설계 → 합성 (D4~D12, Codex 사용량 한도 불참)
- [x] PRD/TODO/TC/DECISIONS 작성
- [x] 밀린 F1 D1~D3 확인 회수(모두 유지 확정)

## CP1. 정본 카탈로그 + 치트시트 + `?` (최대 불확실성 우선)
- [x] `lib/shortcuts.ts` — 단축키 정본 카탈로그(id/keys/label/section/hint 카피) — 치트시트·힌트·튜토리얼 공유
- [x] `store/coach.ts` 골격 — persist(localStorage) + cheatSheetOpen 등 휘발 상태
- [x] `components/CheatSheet.tsx` — 전체 오버레이, Esc 닫기, stopPropagation 모달 규약
- [x] `?` kbar 등록 실측 → 실패 시 useKeyboard 폴백, 결과 DECISIONS D8에 기록
- [x] 팔레트 Help 섹션 "Keyboard shortcuts" 액션
- [x] useKeyboard 모달 가드에 cheatSheetOpen 편입
- [x] tsc 통과

## CP2. 계측 2층 + 통계 모달
- [x] `lib/coach.ts` — 순수 규칙(비율·주간 리셋·힌트 게이팅·마일스톤 경계) + `lib/coach.test.ts` vitest
- [x] `store/coach.ts` — counters/weekProcessed/firsts + recordEfficient/recordMouse/bumpStat
- [x] `store/mail.ts` 종단 액션에 bumpStat 1줄씩(archive/trash/snooze/send/followup/search-first)
- [x] `CommandPalette.tsx` perform 일괄 래핑(recordEfficient)
- [x] `useKeyboard.ts` 내비 케이스 record 1줄씩
- [x] 마우스 계측: Toolbar(Compose/Split)·Sidebar 행·SplitTabBar 탭·ThreadList 행 클릭·스와이프 아카이브 (Back/Esc는 힌트·비율 대상 제외 — 사소)
- [x] `components/StatsPanel.tsx` + 팔레트 "Your stats"
- [x] tsc + vitest 통과

## CP3. 힌트 시스템
- [x] `components/CoachToastHost.tsx` — 독립 큐, 기존 Toasts 컨테이너 형제 마운트
- [x] 힌트 트리거(마우스 계측 지점에서 shouldShowHint 게이팅: 누적 3회·세션 1회·뮤트)
- [x] "팁 그만 보기" 뮤트(영속)
- [x] tsc 통과

## CP4. 마일스톤
- [x] 마일스톤 카탈로그(첫 아카이브/스누즈/리마인드/팔레트/검색·100번째 아카이브·비율 80% 돌파)
- [x] bumpStat 경계 감지 → CoachToastHost 마일스톤 슬롯(1회성, milestonesShown 마킹)
- [x] tsc 통과

## CP5. 인터랙티브 튜토리얼
- [x] `lib/tutorial.ts` 스텝 7종(j/k/Enter/Esc/e[인터셉트]/c/Esc-discard)
- [x] `components/Tutorial.tsx` — 코치 버블 + capture-phase 중재자(비파괴 통과·파괴 키 상시 삼킴·Esc 종료·킬스위치)
- [x] 자동 시작 게이트(App.tsx: 계정+스레드 로드 && !tutorialSeen)
- [x] 팔레트 "Start tutorial" 재진입
- [x] kbar 리스너 phase 확인(capture 선행 보장 — D7 근거 검증)
- [x] tsc 통과

## CP6. E2E + 감사 (Goal 5~7)
- [ ] run-tc.mjs 확장: 첫 시나리오 "튜토리얼 자동시작+Esc 스킵"(D12) + TC.md A~G 전체
- [ ] 기존 F1+F2 58 시나리오 그린 유지 확인
- [ ] /react-best-practices 리뷰 반영
- [ ] web-design-guidelines 감사(/impeccable 대체 — D14) 반영
- [ ] /code-review low
- [ ] TC.md 전 항목 체크 갱신

## CP7. 마무리 (Goal 8)
- [ ] TODO.md(루트)·DEV_WORKFLOW.md 스냅샷 갱신
- [ ] Obsidian ZenMail.md 체크포인트 + vault index 날짜 갱신
- [ ] main push 최종 확인
