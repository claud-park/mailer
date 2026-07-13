# ZenMail UI/UX 개선 — Right Reading Pane + Light Mode (Design Spec)

> 2026-07-13 · 브레인스토밍 산출물. 사용자 요청: ① mail detail을 bottom split → right split으로, ② light mode 추가(기본값).
> 사용자 확정 2건: 패널 폭 = 고정 비율 40/60, 테마 = 수동 토글·light 기본.
> post-release 개선(F1~F6 완료 후). 두 개의 독립 feature로 분리 구현한다.

## Feature A — `right-reading-pane`

### 목적

스레드 상세(ThreadView)를 리스트 하단이 아니라 우측에 배치한다. 상하 분할은 리스트 가시 행 수를 40%로 줄이고 본문 폭이 과도하게 넓어지는 반면, 좌우 분할(Superhuman/Mail.app 계열)은 리스트 컨텍스트를 유지하면서 본문을 읽기 적절한 폭으로 제한한다.

### 설계

- **App.tsx** (`Shell`, 현행 34-37행): `main`은 `flex-col`(Toolbar 상단) 유지. Toolbar 아래에 `flex flex-row min-h-0 flex-1` 컨테이너를 두고 ThreadList(좌)·ThreadView(우)를 배치.
- **ThreadList.tsx** (현행 242행): 열림 분기 `h-2/5 border-b` → `w-2/5 shrink-0 border-r`(높이는 컨테이너 가득). 닫힘 시 기존대로 `flex-1` 전체 폭.
- **ThreadView.tsx**: 우측 잔여 60% 차지(`flex-1 min-w-0`). 내부 구조 무변경.
- **ThreadRow compact 변형**: 상세 열림(`activeThreadId` 존재) 시 리스트 폭이 좁아지므로 2줄 레이아웃(1줄: 발신자+날짜, 2줄: 제목·스니펫)으로 전환. 닫힘 시 기존 1행 레이아웃 유지.
- **무변경 불변식**: j/k/Enter/Esc/[/] 내비게이션은 store(`moveSelection`/`openThread`/`closeThread`) 로직이므로 무수정 동작. BulkActionBanner·Toolbar·가상화·선택 강조 로직 무변경. 리사이저는 도입하지 않음(YAGNI — 필요 시 후속).

### 리스크

- ThreadRow의 기존 1행 마크업이 40% 폭에서 뭉개지는 것이 본 작업의 실질 난점 — compact 변형이 핵심 구현.
- E2E가 상하 분할 기하(높이/스크롤)에 의존하는 셀렉터·어서션이 있으면 수정 필요.

## Feature B — `light-mode`

### 목적

라이트 테마를 추가하고 **기본값을 light**로 한다. 다크는 수동 토글로 유지.

### 설계

- **토큰 재정의** (`index.css`): 현행 `@theme`의 다크 팔레트 값을 라이트 팔레트로 교체(기본). 다크 팔레트는 `:root[data-theme='dark'] { --color-*: … }` 오버라이드 블록으로 이동. 컴포넌트 21개 파일은 시맨틱 토큰 클래스(`bg-bg`, `text-text-primary` 등)만 사용하므로 무수정 자동 대응.
- **상태**: `store/mail.ts`에 `theme: 'light' | 'dark'`(초기 `'light'`) + `toggleTheme()`. 전환 시 `document.documentElement.dataset.theme` 갱신 + `setSetting('theme', …)` persist(SQLite settings KV — 앱 영구 설정 표준 경로). 부트스트랩에서 `getSetting('theme')` 복원, 없으면 light.
- **kbar 액션**: CommandPalette 액션 배열에 "Toggle theme"(light/dark) 추가 — 기존 정적 배열 + `perform: () => useMailStore.getState().toggleTheme()` 패턴.
- **하드코딩 hex 처리** (탐색으로 확인된 3곳 + 1 점검):
  - `ThreadView.tsx` iframe `srcDoc` 인라인 스타일(`color:#ececec`, `a{color:#6366f1}`) — 테마 값을 받아 색을 조건 분기해 주입(iframe은 부모 CSS 변수 미상속).
  - `ThreadView.tsx` 라벨 칩 fallback `#2a2a2a`, `store/mail.ts` quoteHtml blockquote `#2a2a2a` — 테마 조건 분기 또는 CSS 변수화.
  - Electron `BrowserWindow` 배경색/`titleBarStyle` 하드코딩 여부 구현 시 점검(있으면 라이트 대응).
- **라이트 팔레트**: 기존 다크 토큰과 동일한 위계(배경 3단·텍스트 3단·accent·label 5색)를 라이트로 대칭 설계. accent(#6366f1 계열)는 유지하되 대비 검증.

### 리스크

- 라벨 색(`--color-label-*`)이 다크 배경 전제로 잡혀 있으면 라이트에서 대비 미달 가능 — 팔레트 설계 시 확인.
- iframe srcDoc은 테마 전환 시 재렌더 필요(activeThread 열린 채 토글하는 경우).

## 구현 순서·워크플로

- 각 feature는 DEV_WORKFLOW Goal 0~8 수행(`docs/features/right-reading-pane/`, `docs/features/light-mode/`).
- 겹침이 ThreadView.tsx 한 파일뿐이므로 worktree 2개 병렬 작업 → **light-mode 먼저 머지 → right-reading-pane rebase 후 머지**.
- 완료 기준: 각 feature TC 전부 통과(E2E run-tc.mjs 확장), tsc/vitest clean, /react-best-practices + /code-review, main push, Obsidian 기록.
