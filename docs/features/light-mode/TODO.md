# light-mode — Checkpoint TODO

> Goal 2 산출물. tsc + npm test + E2E 무회귀 기준. 플랜 참조: `docs/superpowers/plans/2026-07-13-light-mode.md`(Task 1~6 = CP1~CP6).
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## CP0. 설계 (Goal 0~4)
- [x] 브레인스토밍(사용자 확정 2건 — 라이트 기본값, 수동 토글)
- [x] PRD/TODO/TC/DECISIONS 작성

## CP1. 테마 토큰 — 라이트 기본 + 다크 오버라이드 (Task 1)
- [x] `index.css` `@theme` 블록을 라이트 팔레트로 교체(bg/bg-subtle/bg-border/text-primary/text-secondary/text-muted)
- [x] 다크 팔레트를 `:root[data-theme='dark'] { --color-*: … }` 오버라이드 블록으로 이동(accent/label 5색은 공통이라 오버라이드에 넣지 않음)
- [x] 육안 확인 → E2E TC-LM-A1/A2로 대체 검증(computed bg 실측)

## CP2. 스토어 theme 상태 + persist + 부트 복원 (Task 2)
- [x] `MailState`에 `theme: 'light' | 'dark'` 필드 + `setTheme(theme, opts?: { persist?: boolean })` + `toggleTheme()` 선언
- [x] 초기 상태 `theme: 'light'`, `setTheme` 구현(dataset.theme 갱신 + `setSetting('theme', …)` persist), `toggleTheme` 구현
- [x] `init()`에 부트 복원 삽입(`getSetting('theme') === 'dark'`일 때만 `setTheme('dark', {persist:false})`, 계정 유무 무관 — Login 화면에도 적용)
- [x] tsc + npm test

## CP3. kbar "Toggle theme" 액션 (Task 3)
- [x] `CommandPalette.tsx` View 섹션에 `toggleTheme` 액션 추가(단축키 없음)
- [x] 수동 확인 → E2E TC-LM-A2(kbar 경유 토글)로 대체 검증
- [x] tsc

## CP4. 하드코딩 hex 3곳 테마 대응 (Task 4)
- [x] `renderer/lib/theme.ts` 신규 — `labelChipFallback(theme)` 함수
- [x] `ThreadView.tsx` `prepareHtml` opts에 `theme` 추가, iframe srcDoc body color 분기(링크색은 공통 유지), `MessageCard`에서 theme 구독 + useMemo deps 반영
- [x] `ThreadView.tsx`/`ThreadList.tsx` 라벨 칩 fallback을 `labelChipFallback(theme)`로 교체(각각 theme 구독 추가)
- [x] `store/mail.ts` quoteHtml blockquote 보더를 `#cccccc`로 고정(발신 메일 본문용, 테마 무관 — DECISIONS D5)
- [x] tsc + npm test

## CP5. BrowserWindow 배경색 (Task 5)
- [x] `main/cache.ts` `getSetting` export 확인/추가(시그니처 변경 금지)
- [x] `main/index.ts` `backgroundColor`를 `getSetting('theme') === 'dark' ? '#0f0f0f' : '#ffffff'`로 결정(openCache() 이후 createWindow() 순서 전제)
- [x] tsc + E2E TC-LM-A3/A4(재시작 유지)로 대체 검증 — 시작 플래시는 D1~사용자 확인 항목

## CP6. E2E — TC-LM 추가 + 전체 무회귀 (Task 6)
- [x] TC-LM-A1~A4, TC-LM-B1 5건을 `e2e/run-tc.mjs`에 추가(기존 TC-SA-* 등록 패턴 준수)
- [x] 전체 E2E(`node e2e/run-tc.mjs`) + `npm test` + `npx tsc --noEmit` 실행, 기존 전 케이스 무회귀 확인(연속 2회 재실행 동일)
- [x] TC.md 체크박스 실측 갱신
- [x] react-best-practices + code-review low
- [x] 커밋 → push, TODO/DEV_WORKFLOW 갱신
