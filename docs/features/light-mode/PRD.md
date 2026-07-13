# light-mode — Feature PRD

> 2026-07-13 · Goal 1 산출물. 상위: `docs/superpowers/specs/2026-07-13-right-pane-and-light-mode-design.md` Feature B(승인된 설계). 사용자 확정 2건 — 라이트가 기본값, 수동 토글 방식(2026-07-13 브레인스토밍에서 사용자가 직접 선택). DECISIONS D1~D7 전부 사용자 확정 또는 설계 근거 명시 — ⚠️ 미확인 아님.
> 상위: 사용자 요청 "light mode 추가"(post-release, F1~F6 완료 후). 자매 feature `right-reading-pane`과 함께 브레인스토밍됐으나 겹침이 ThreadView.tsx 한 파일뿐이라 독립 구현(light-mode 먼저 머지).

## 1. 목적

현재 ZenMail은 다크 테마만 지원한다. 라이트 테마를 추가하고 **기본값을 light**로 전환한다. 다크는 kbar를 통한 수동 토글로 유지한다.

## 2. 범위

### In
- **토큰 재정의**: Tailwind v4 CSS-first `@theme` 블록의 색상 값을 라이트 팔레트로 교체(기본). 기존 다크 팔레트는 `:root[data-theme='dark'] { --color-*: … }` 오버라이드 블록으로 이동. 시맨틱 토큰 클래스(`bg-bg`, `text-text-primary` 등)만 쓰는 21개 컴포넌트 파일은 무수정 자동 대응.
- **상태 관리**: `store/mail.ts`에 `theme: 'light' | 'dark'`(초기 `'light'`) + `setTheme(theme, opts?)` + `toggleTheme()`. 전환 시 `document.documentElement.dataset.theme` 갱신 + SQLite settings KV(`setSetting('theme', …)`) persist. `init()` 부트스트랩에서 `getSetting('theme')` 복원(dark일 때만 전환, 기본 light).
- **kbar 액션**: CommandPalette View 섹션에 "Toggle light/dark theme" 추가, `perform: () => useMailStore.getState().toggleTheme()`. 단축키는 부여하지 않는다(저빈도 액션).
- **하드코딩 hex 예외 3곳**: (1) `ThreadView.tsx` iframe `srcDoc` 인라인 스타일의 본문 글자색(iframe은 부모 CSS 변수 미상속 → theme prop으로 조건 분기), (2) `ThreadView.tsx`/`ThreadList.tsx` 라벨 칩 fallback 배경색(테마별 중립색 함수 `lib/theme.ts`의 `labelChipFallback`), (3) `store/mail.ts`의 quoteHtml blockquote 보더색(발신 메일 본문용이라 테마 무관 고정값으로 정리).
- **BrowserWindow backgroundColor**: main 프로세스에서 `getSetting('theme')`(동기, better-sqlite3)로 시작 배경색 결정 — 렌더러 부트 전 다크/라이트 플래시 방지.

### Out (v1 범위 외, YAGNI)
- 시스템 테마 추종(`nativeTheme`) — '기본 light' 요구와 어긋나고 IPC 범위가 늘어남.
- 테마별 커스텀 색상 설정 UI(사용자가 팔레트를 직접 편집하는 기능).
- `right-reading-pane`과의 레이아웃 통합(별도 feature, 겹침은 ThreadView.tsx 한 파일뿐).

## 3. 성공 기준

1. 앱을 처음 실행하면 라이트 테마로 뜬다(배경 흰색, 다크 플래시 없음).
2. kbar(⌘K)에서 "theme" 검색 → 실행 시 즉시 다크로 전환되고, 재실행 시 라이트로 복귀한다.
3. 테마를 전환하고 앱을 재시작해도 마지막 선택이 유지된다(SQLite persist).
4. 스레드 상세(iframe)가 열린 채로 토글해도 본문 글자색이 즉시 반영된다.
5. 기존 21개 컴포넌트 파일은 무수정, 기존 E2E 전체 무회귀 + 신규 TC 통과.

## 4. 아키텍처

```
index.css: @theme(라이트 기본) + :root[data-theme='dark'](다크 오버라이드)
store/mail.ts: theme 상태 + setTheme(document.dataset.theme 갱신 + setSetting persist) + toggleTheme
  init(): getSetting('theme') === 'dark' 면 setTheme('dark', {persist:false})로 복원
CommandPalette: "Toggle light/dark theme" kbar 액션 → toggleTheme()
lib/theme.ts: labelChipFallback(theme) — 테마별 라벨 칩 중립색
ThreadView/ThreadList: theme 구독 → iframe srcDoc 색 분기, 라벨 칩 fallback 분기
main/index.ts: getSetting('theme')로 BrowserWindow backgroundColor 동기 결정(openCache() 이후)
```

신규: `renderer/lib/theme.ts`. 변경: `renderer/index.css`, `renderer/store/mail.ts`, `renderer/components/CommandPalette.tsx`, `renderer/components/ThreadView.tsx`, `renderer/components/ThreadList.tsx`, `main/index.ts`, `main/cache.ts`(getSetting export 확인).
