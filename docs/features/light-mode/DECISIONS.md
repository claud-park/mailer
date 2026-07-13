# light-mode — DECISIONS

> Goal 4 산출물. D1~D7 전부 **사용자 확정 또는 설계 근거 명시** — ⚠️ 미확인 아님(select-all-in-view D1~D5 선례와 달리 이번 브레인스토밍에서 사용자가 직접 선택).

### D1. 기본 테마 = light, 수동 토글 (사용자 확정)
- **이유**: 사용자가 브레인스토밍 옵션 중 직접 선택. 시스템 테마 추종(`nativeTheme`)은 대안으로 검토됐으나 '기본 light' 요구와 어긋나고(사용자 OS가 dark면 앱도 dark로 시작해 기본값 요구를 충족 못함), `nativeTheme` 변경 이벤트를 구독하는 신규 IPC 채널이 필요해 범위가 늘어나 기각.

### D2. 토큰 재정의 방식 = `@theme` 라이트 기본 + `:root[data-theme='dark']` 오버라이드 (설계 근거)
- **이유**: 시맨틱 토큰 클래스(`bg-bg`, `text-text-primary` 등)만 쓰는 21개 컴포넌트 파일이 이미 존재 — 토큰 값만 교체하면 컴포넌트 무수정으로 라이트 전환이 끝난다. `dark:` variant를 전면 도입하는 대안은 21개 파일 전부에 diff가 생기므로 범위·리스크가 훨씬 큼. Tailwind v4가 `@theme` 값을 `:root` CSS 변수로 방출하고 유틸리티가 `var()`를 참조하는 구조라 `[data-theme='dark']` 오버라이드가 런타임에 즉시 반영됨.

### D3. persist = SQLite settings KV(`getSetting`/`setSetting`) (설계 근거)
- **이유**: `splitInbox`/`snippets` 등 기존 앱 영구 설정이 전부 이 경로를 쓰는 표준 패턴 — 신규 저장소·신규 IPC 채널 도입 없이 재사용. localStorage는 코드베이스에서 coach/latency 텔레메트리 전용 관례로 굳어 있어 앱 설정에 쓰면 관례를 깨뜨림.

### D4. accent/label 색은 두 테마 공통 (설계 근거)
- **이유**: `#6366f1`(accent)은 흰 배경(라이트) 대비도 충분히 확보됨. 라벨 5색(red/yellow/green/blue/purple)은 채도 중간대라 두 테마에서 공용으로 써도 무난 — 다만 라이트 배경에서 yellow의 대비가 다소 낮은 점은 확인됨. 라벨 칩이 `${hex}33`(알파 20%) 배경 + hex 텍스트 색 조합으로 렌더되는 구조라 배경 위 텍스트 대비 문제가 아니라 허용 범위로 판단.

### D5. quoteHtml blockquote 보더는 테마 무관 `#cccccc` 고정 (설계 근거)
- **이유**: 이 HTML은 앱 내부 렌더링용이 아니라 **발신 메일 본문**에 포함되어 수신자의 메일 클라이언트(Gmail 웹, 대부분 라이트 기준)에서 렌더된다. 발신 측 앱 테마와 무관해야 하므로 Gmail 표준 관례인 `#ccc` 계열로 고정. 기존 값 `#2a2a2a`(다크 전용 하드코딩)를 그대로 두면 라이트 테마 사용자가 보낸 메일도 어두운 보더로 나가는 게 오히려 버그.

### D6. kbar 액션에 단축키 미부여 (설계 근거)
- **이유**: 테마 전환은 저빈도 액션 — 단일 키 예산(CLAUDE.md 단축키 소유권 규약상 kbar 단일키 슬롯은 c/e/r/a/f/l/b/#/I/U 등으로 이미 조밀함)을 소비할 가치가 낮음. ⌘K → 이름 검색으로 실행 비용이 충분히 낮아 팔레트 검색으로 대체.

### D7. BrowserWindow backgroundColor를 main에서 동기 `getSetting`으로 결정 (설계 근거)
- **이유**: 렌더러가 부트되어 CSS를 적용하기 전에 창이 먼저 그려지므로, 저장된 테마와 다른 고정색(예: 항상 다크 배경 `#0f0f0f`)을 쓰면 라이트 사용자에게 시작 시 다크 플래시가 보인다. `better-sqlite3`는 동기 API이고 `main/index.ts`에서 `openCache()`가 `createWindow()`보다 먼저 호출되는 순서가 이미 보장돼 있어, 별도 비동기 대기 없이 `getSetting('theme')`을 그대로 `backgroundColor` 계산에 사용할 수 있다.
