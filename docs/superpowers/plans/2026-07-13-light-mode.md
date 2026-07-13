# light-mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 라이트 테마를 추가하고 기본값을 light로, 다크는 kbar 수동 토글 + SQLite settings persist로 유지한다.

**Architecture:** Tailwind v4 CSS-first `@theme`의 색상 토큰을 라이트 팔레트로 교체하고, 다크 팔레트를 `:root[data-theme='dark']` 오버라이드로 이동. 렌더러는 zustand `theme` 상태가 `document.documentElement.dataset.theme`을 구동. 예외 3곳(iframe srcDoc, 라벨 칩 fallback, quoteHtml)과 BrowserWindow 배경색만 개별 처리.

**Tech Stack:** Electron 33, React 19, TypeScript, Tailwind v4(CSS-first), zustand, kbar, better-sqlite3(settings KV).

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-13-right-pane-and-light-mode-design.md` Feature B. 기본 테마는 **light**(사용자 확정).
- 신규 npm 의존성 금지. 신규 IPC 채널 금지(기존 `getSetting`/`setSetting` 재사용).
- 검증 커맨드(전부 `zenmail/`에서): `npx tsc --noEmit` · `npm test` · E2E `node e2e/run-tc.mjs`(별도 터미널 `npm start` 불필요 — 하네스가 앱을 직접 띄움. 기존 방식은 `zenmail/e2e/run-tc.mjs` 상단 주석 참조).
- 커밋 메시지는 한국어, `feat(light-mode): CPn — …` 형식(git log 참조). 각 Task 완료 시 커밋.
- 시맨틱 토큰 클래스(`bg-bg` 등)를 쓰는 21개 컴포넌트 파일은 **수정 금지** — 토큰 재정의로만 대응.

---

### Task 1: 테마 토큰 — 라이트 기본 + 다크 오버라이드

**Files:**
- Modify: `zenmail/src/renderer/index.css:3-20`

**Interfaces:**
- Produces: `:root[data-theme='dark']`일 때 다크 팔레트 — Task 2의 `dataset.theme` 스위칭이 이 셀렉터에 의존.

- [ ] **Step 1: `@theme` 블록을 라이트 팔레트로 교체하고 다크 오버라이드 블록 추가**

`index.css`의 3-20행 `@theme` 블록을 다음으로 교체하고, 직후(21행)에 다크 오버라이드 블록을 삽입:

```css
@theme {
  --color-bg: #ffffff;
  --color-bg-subtle: #f4f4f5;
  --color-bg-border: #e4e4e7;
  --color-text-primary: #18181b;
  --color-text-secondary: #71717a;
  --color-text-muted: #a1a1aa;
  --color-accent: #6366f1;
  --color-accent-hover: #4f52d4;
  --color-label-red: #ef4444;
  --color-label-yellow: #eab308;
  --color-label-green: #22c55e;
  --color-label-blue: #3b82f6;
  --color-label-purple: #a855f7;

  --font-sans:
    'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
}

/* dark palette — document.documentElement.dataset.theme = 'dark' 로 활성화 (store/mail.ts setTheme) */
:root[data-theme='dark'] {
  --color-bg: #0f0f0f;
  --color-bg-subtle: #1a1a1a;
  --color-bg-border: #2a2a2a;
  --color-text-primary: #ececec;
  --color-text-secondary: #8a8a8a;
  --color-text-muted: #555555;
}
```

주의: Tailwind v4는 `@theme` 값을 `:root` CSS 변수로 방출하고 유틸리티가 `var()`를 참조하므로, `[data-theme='dark']` 오버라이드가 런타임에 즉시 반영된다. accent/label 색은 두 테마 공통이므로 오버라이드 블록에 넣지 않는다.

- [ ] **Step 2: 육안 확인**

Run: `npm start` → 앱 전체가 라이트로 뜨는지, DevTools 콘솔에서 `document.documentElement.dataset.theme = 'dark'` 실행 시 즉시 다크로 바뀌는지 확인.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/index.css
git commit -m "feat(light-mode): CP1 — @theme 라이트 팔레트 기본 + [data-theme=dark] 오버라이드"
```

---

### Task 2: 스토어 theme 상태 + persist + 부트 복원

**Files:**
- Modify: `zenmail/src/renderer/store/mail.ts` — interface `MailState`(74행 `bulkSelectedIds` 아래), 초기 상태(264행 아래), `init()`(266행), 액션 구현(store 반환 객체 끝부분)

**Interfaces:**
- Produces: `theme: 'light' | 'dark'`(초기 `'light'`), `setTheme(theme: 'light' | 'dark', opts?: { persist?: boolean }): void`, `toggleTheme(): void` — Task 3(kbar)·Task 4(ThreadView)가 사용.
- Consumes: 기존 `api().getSetting(key): Promise<string | null>` / `api().setSetting(key, value): Promise<void>`.

- [ ] **Step 1: MailState 인터페이스에 필드/액션 추가**

`bulkSelectedIds: Set<string>;`(74행) 아래에:

```ts
  theme: 'light' | 'dark';
```

액션 선언부(`clearBulkSelection(): void;` 근처)에:

```ts
  setTheme(theme: 'light' | 'dark', opts?: { persist?: boolean }): void;
  toggleTheme(): void;
```

- [ ] **Step 2: 초기 상태 + 액션 구현**

초기 상태 블록의 `bulkSelectedIds: new Set(),`(264행) 아래에 `theme: 'light',` 추가. 액션 구현(예: `clearBulkSelection` 구현 근처)에:

```ts
    setTheme(theme, opts) {
      set({ theme });
      document.documentElement.dataset.theme = theme;
      if (opts?.persist !== false) void api().setSetting('theme', theme);
    },

    toggleTheme() {
      get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
    },
```

- [ ] **Step 3: `init()` 부트 복원**

`init()`(266행) 본문 맨 앞(followup 리스너 등록 전)에 삽입 — 계정 유무와 무관하게 Login 화면에도 테마가 적용돼야 한다:

```ts
      // theme boot — 저장값이 dark일 때만 전환, 기본 light (재기록 불필요라 persist:false)
      try {
        if ((await api().getSetting('theme')) === 'dark') get().setTheme('dark', { persist: false });
      } catch {
        /* default light */
      }
```

- [ ] **Step 4: typecheck + 기존 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: PASS (무회귀).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/store/mail.ts
git commit -m "feat(light-mode): CP2 — store theme 상태 + setTheme/toggleTheme + init 부트 복원(settings KV)"
```

---

### Task 3: kbar "Toggle theme" 액션

**Files:**
- Modify: `zenmail/src/renderer/components/CommandPalette.tsx:112-127` (View 섹션)

**Interfaces:**
- Consumes: Task 2의 `toggleTheme()`.

- [ ] **Step 1: View 섹션에 액션 추가**

`snippets` 액션(122-127행) 뒤에:

```ts
      {
        id: 'toggleTheme',
        name: 'Toggle light/dark theme',
        section: 'View',
        perform: () => useMailStore.getState().toggleTheme(),
      },
```

단축키는 부여하지 않는다(테마 전환은 저빈도 — kbar 검색으로 충분, 단일 키 예산 절약).

- [ ] **Step 2: 수동 확인 + typecheck**

Run: `npm start` → ⌘K → "theme" 검색 → 실행 시 다크 전환·재실행 시 라이트 복귀. `npx tsc --noEmit` PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/CommandPalette.tsx
git commit -m "feat(light-mode): CP3 — kbar Toggle light/dark theme 액션"
```

---

### Task 4: 하드코딩 hex 3곳 테마 대응

**Files:**
- Create: `zenmail/src/renderer/lib/theme.ts`
- Modify: `zenmail/src/renderer/components/ThreadView.tsx:8-42(prepareHtml), 50-53(useMemo), 242-243(칩 fallback)`
- Modify: `zenmail/src/renderer/components/ThreadList.tsx:149-150` (ThreadRow 칩 fallback)
- Modify: `zenmail/src/renderer/store/mail.ts:194` (quoteHtml blockquote)

**Interfaces:**
- Produces: `lib/theme.ts` — `export function labelChipFallback(theme: 'light' | 'dark'): string`
- Consumes: Task 2의 `useMailStore((s) => s.theme)`.

- [ ] **Step 1: `lib/theme.ts` 생성**

```ts
/** 라벨에 색이 없을 때 칩 배경으로 쓰는 테마별 중립색 (`${hex}33` 알파 합성에 쓰이므로 hex여야 함) */
export function labelChipFallback(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? '#2a2a2a' : '#e4e4e7';
}
```

- [ ] **Step 2: ThreadView iframe srcDoc 테마 분기**

`prepareHtml`의 opts에 `theme: 'light' | 'dark'` 추가하고 body color를 분기:

```ts
function prepareHtml(
  message: MessageDetail,
  opts: { showQuoted: boolean; allowImages: boolean; theme: 'light' | 'dark' }
): { srcDoc: string; hasQuoted: boolean } {
```

스타일 블록(33행)의 `color: #ececec` 부분을:

```ts
      body { margin: 0; padding: 4px 0; background: transparent; color: ${
        opts.theme === 'dark' ? '#ececec' : '#18181b'
      };
```

링크 색 `#6366f1`은 두 테마 공통이므로 유지. `MessageCard`에서:

```ts
  const theme = useMailStore((s) => s.theme);

  const { srcDoc, hasQuoted } = useMemo(
    () => prepareHtml(message, { showQuoted, allowImages, theme }),
    [message, showQuoted, allowImages, theme]
  );
```

theme이 useMemo deps에 있으므로 스레드가 열린 채 토글해도 iframe이 재렌더된다(스펙 리스크 해소).

- [ ] **Step 3: 라벨 칩 fallback 2곳 교체**

`ThreadView.tsx` 242행과 `ThreadList.tsx` 149행의 `l.color?.backgroundColor ?? '#2a2a2a'`(background 쪽만)를 `l.color?.backgroundColor ?? labelChipFallback(theme)`로 교체. 두 컴포넌트 모두 `const theme = useMailStore((s) => s.theme);` 구독 추가(`ThreadRow`는 props 대신 직접 구독 — 기존 `openThread` 등과 동일 패턴). `color:` 쪽 fallback(`var(--color-text-secondary)`)은 이미 토큰이라 무수정.

- [ ] **Step 4: quoteHtml blockquote 테마 독립화**

`store/mail.ts:194`의 `border-left:2px solid #2a2a2a`를 `border-left:2px solid #cccccc`로 교체. 근거: 이 HTML은 **발신 메일 본문**에 포함되어 수신자 클라이언트(대부분 라이트)에서 렌더되므로 앱 테마와 무관하게 Gmail 표준(#ccc 계열)이 맞다. DECISIONS에 기록할 것.

- [ ] **Step 5: typecheck + 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/theme.ts src/renderer/components/ThreadView.tsx src/renderer/components/ThreadList.tsx src/renderer/store/mail.ts
git commit -m "feat(light-mode): CP4 — iframe srcDoc/라벨 칩 fallback 테마 분기, quoteHtml 발신용 #ccc 고정"
```

---

### Task 5: BrowserWindow 배경색 — 시작 플래시 방지

**Files:**
- Modify: `zenmail/src/main/index.ts:23`
- Modify(필요시): `zenmail/src/main/cache.ts` — `getSetting` export 여부 확인

**Interfaces:**
- Consumes: `cache.ts`의 `getSetting(key: string): string | null`(동기, better-sqlite3). export 안 되어 있으면 export 추가.

- [ ] **Step 1: 배경색을 저장된 테마로 결정**

`main/index.ts`에서 `openCache()`가 `createWindow()`보다 먼저 호출됨(63-67행)을 확인하고:

```ts
import { openCache, getSetting } from './cache';
```

`createWindow` 내 `backgroundColor: '#0f0f0f',`(23행)을:

```ts
    backgroundColor: getSetting('theme') === 'dark' ? '#0f0f0f' : '#ffffff',
```

`cache.ts`의 `getSetting`이 export되어 있지 않으면 `export`를 붙인다(시그니처 변경 금지). 예외 가능성이 걱정되면 `try { … } catch { '#ffffff' }` 불필요 — openCache 이후 호출이 전제이고 E2E가 이 경로를 커버한다.

- [ ] **Step 2: typecheck + 수동 확인**

Run: `npx tsc --noEmit` PASS. `npm start` → 라이트 시작 시 흰 배경(다크 플래시 없음), kbar로 다크 전환 후 재시작 → 어두운 배경으로 시작.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts src/main/cache.ts
git commit -m "feat(light-mode): CP5 — BrowserWindow backgroundColor를 persisted theme으로 (시작 플래시 방지)"
```

---

### Task 6: E2E — TC-LM 추가 + 전체 무회귀

**Files:**
- Modify: `zenmail/e2e/run-tc.mjs` (기존 TC-SA-* 등록 패턴을 그대로 따를 것 — 파일 상단과 기존 케이스 등록부를 먼저 읽고 동일 구조로 추가)

**Interfaces:**
- Consumes: 렌더러 전역 상태 — `document.documentElement.dataset.theme`, `getComputedStyle(document.body).backgroundColor`, kbar 액션 실행(기존 하네스의 kbar 구동 헬퍼가 있으면 재사용, 없으면 `useMailStore` 노출 경로로 `toggleTheme` 직접 호출 — 기존 TC들이 스토어를 어떻게 조작하는지 먼저 확인).

- [ ] **Step 1: TC-LM 케이스 5건 추가**

TC.md(Goal 3 산출물)의 If-When-Then과 1:1 대응:

- TC-LM-A1: 초기 실행 시 `dataset.theme`이 미설정(light)이고 body 배경이 `rgb(255, 255, 255)`.
- TC-LM-A2: `toggleTheme()` 실행 시 `dataset.theme === 'dark'` + body 배경 `rgb(15, 15, 15)`.
- TC-LM-A3: dark로 토글 후 **앱 재시작** 시 dark 유지(기존 restart 검증 패턴 재사용 — F1 영속화 TC 참조).
- TC-LM-A4: 다시 토글 → light 복귀 + 재시작 후 light 유지(설정 파일 정리 겸함 — 이 TC가 마지막에 테마를 light로 되돌려 다른 TC에 영향 없게 한다).
- TC-LM-B1: 스레드 열린 상태에서 토글 시 iframe 본문 글자색이 즉시 바뀜(`iframe.contentDocument.body`의 computed color 비교).

- [ ] **Step 2: 전체 E2E + 단위 실행**

Run: `node e2e/run-tc.mjs` (전체) 및 `npm test && npx tsc --noEmit`
Expected: 기존 전 케이스 무회귀(직전 스냅샷: 294 PASS·0 FAIL·14 SKIP) + TC-LM 5건 PASS. 연속 2회 재실행 동일.

- [ ] **Step 3: TC.md 상태 갱신 + Commit**

`docs/features/light-mode/TC.md`의 체크박스를 실측으로 갱신 후:

```bash
git add e2e/run-tc.mjs ../docs/features/light-mode/TC.md
git commit -m "feat(light-mode): CP6 — E2E TC-LM 5건 + 전체 무회귀"
```
