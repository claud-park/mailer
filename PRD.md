# ZenMail PRD — Mac Gmail Client

> Source spec: [docs/MAIL_APP_SPEC.md](docs/MAIL_APP_SPEC.md)
> Created: 2026-07-02 · Status: **In development**
> Progress tracking: [TODO.md](TODO.md) · Obsidian checkpoint: `_obsidian/Projects/ZenMail.md`

---

## 1. Overview

| | |
|---|---|
| Product | ZenMail — 미니멀 키보드 중심 macOS Gmail 클라이언트 |
| Target | 브라우저 탭에서 벗어나고 싶은 싱글 유저 (구독료 없이) |
| Feel | Linear의 밀도 + Superhuman의 커맨드 팔레트, AI 기능 없음 |
| Platform | macOS (.app via Electron) |

## 2. Goals / Non-Goals

**Goals (v1)**
- Gmail REST API 기반 완전한 메일 클라이언트 (읽기/보내기/라벨/스누즈)
- 모든 액션 키보드로 가능 (⌘K 팔레트에서 발견 가능)
- SQLite 오프라인 캐시 + 즉시 검색
- 다크모드 전용, 고밀도 UI (1440p에서 15+ 스레드)

**Non-Goals (v1)**
- AI 기능, iOS/iPadOS, 비-Gmail 계정(IMAP/Outlook/iCloud), 팀 기능, 라이트 모드, 플러그인

## 3. Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Electron 33 + Node 22 |
| Frontend | React 19 + TypeScript 5.5 |
| Styling | Tailwind CSS v4 |
| Email API | Gmail REST API v1 (googleapis) |
| Auth | Google OAuth 2.0 PKCE → macOS Keychain (keytar) |
| Build | Electron Forge + Vite |
| Palette | kbar |
| State | Zustand |
| Cache | better-sqlite3 |

## 4. Functional Requirements

### FR-1 OAuth 인증
- Google OAuth 2.0 Desktop-app flow, PKCE
- Redirect: `http://localhost` (로컬 HTTP 서버로 캐치)
- Scopes: `gmail.readonly`, `gmail.modify`, `gmail.send`, `gmail.labels`
- 토큰: `keytar.setPassword('zenmail', email, JSON.stringify(tokens))`
- 만료 시 refresh token으로 자동 갱신

### FR-2 Split Inbox
- Primary = INBOX 라벨 중 Social/Promotions/Updates/Forums 제외
- Other = 나머지 INBOX
- ⌘⇧I 로 Split ↔ Unified 토글

### FR-3 Label Sidebar
- `labels.list` 로 사용자 라벨 렌더 (labelShow만)
- 미읽음 뱃지 + Gmail 라벨 색상 dot
- 클릭 → 스레드 목록 필터, `g` `l` 라벨 피커 점프

### FR-4 Command Palette (⌘K)
- kbar 기반, 스펙 §4-3의 14개 액션 전부 등록
- 액션 옆에 단축키 표시 (발견 가능성)

### FR-5 Thread List
- @tanstack/react-virtual 가상화 (10k+ 스레드)
- Row: 발신자, 제목, 스니펫, 시각, 미읽음 dot, 라벨 칩 (56px)
- `j`/`k` 이동, `Enter` 열기, 트랙패드 스와이프 (우→아카이브, 좌→스누즈)

### FR-6 Thread View
- 샌드박스 렌더 (JS 실행 금지, 외부 이미지 기본 차단)
- 인용문 접기 (`...` 토글), 하단 인라인 답장 컴포저
- `]` 다음 / `[` 이전 스레드

### FR-7 Compose
- 풀윈도우 오버레이, To/CC/BCC 자동완성 (Gmail contacts)
- ⌘Enter 전송, ⌘⇧Enter 전송+아카이브
- 예약 전송 (draft + 로컬 리마인더), 10초 Undo send

### FR-8 Snooze
- INBOX 라벨 제거 + `zenmail/snoozed` 라벨 적용
- SQLite에 `{threadId, snoozeUntil}` 저장, 1분마다 타이머 체크 → 기한 도래 시 INBOX 복귀
- 프리셋: Later today · Tomorrow morning · Next week · Custom

### FR-9 Search
- Gmail `threads.list?q=` 패스스루 (전체 Gmail 검색 문법)
- SQLite FTS 로컬 즉시 검색, `/` 포커스, `Esc` 해제

## 5. Architecture

- **Main process**: OAuth, Gmail API 호출, SQLite 캐시, 스누즈 데몬, Keychain — 모든 권한 있는 작업
- **Renderer**: React + Zustand, contextBridge IPC로만 main과 통신 (nodeIntegration off, contextIsolation on)
- IPC 채널: `mail:threads-updated`, `mail:snooze-fired` (main→renderer) / `mail:fetch-threads`, `mail:send`, `mail:modify-labels`, `mail:snooze` (renderer→main)
- 프로젝트 구조: 스펙 §7 그대로 (`zenmail/src/{main,renderer,shared}`)

## 6. UI Spec

- 레이아웃: 좌 사이드바 / 우 스레드리스트 + 스레드뷰 (스펙 §5 다이어그램)
- 디자인 토큰: bg `#0f0f0f`/`#1a1a1a`/`#2a2a2a`, text `#ececec`/`#8a8a8a`/`#555`, accent indigo `#6366f1`
- 폰트 Inter/system, row 56px, unread weight 500

## 7. Milestones (스펙 §8 빌드 순서)

1. Electron shell → 2. OAuth → 3. Gmail wrapper → 4. SQLite cache → 5. Thread list → 6. Thread view → 7. Compose → 8. Split inbox → 9. Label sidebar → 10. ⌘K palette → 11. Snooze → 12. Polish

상세 진행 상황은 [TODO.md](TODO.md) 참조.

## 8. Risks / Open items

| # | Risk | Mitigation |
|---|---|---|
| R1 | Google OAuth Client ID 필요 (Cloud Console 수동 발급) | 발급 전까지 데모 모드(mock 데이터)로 UI 개발/검증 |
| R2 | 네이티브 모듈 (better-sqlite3, keytar) Electron ABI 리빌드 | Forge auto-unpack-natives 플러그인 + electron-rebuild |
| R3 | keytar deprecated | v1은 keytar 유지 (스펙 준수), v2에서 safeStorage 검토 |
| R4 | Gmail contacts API는 별도 People API scope 필요 | v1: 로컬 캐시된 발신자 기반 자동완성으로 대체 |
