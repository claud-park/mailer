# ZenMail TODO — 진행 상황 트래킹

> PRD: [PRD.md](PRD.md) · Spec: [docs/MAIL_APP_SPEC.md](docs/MAIL_APP_SPEC.md)
> Obsidian checkpoint: `_obsidian/Projects/ZenMail.md`
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

Last updated: 2026-07-02

## 0. 프로젝트 셋업
- [x] PRD.md / TODO.md 작성
- [x] Obsidian 체크포인트 노트 생성
- [x] Electron Forge + Vite + TS 스캐폴드 (`zenmail/`)
- [x] 의존성 설치 (react, zustand, kbar, react-virtual, googleapis, keytar, better-sqlite3, tailwind v4)
- [x] Tailwind v4 + 디자인 토큰 설정

## 1. Electron shell
- [x] BrowserWindow 생성 (main/index.ts), 다크 배경, hiddenInset 타이틀바
- [x] preload + contextBridge (`window.zenmail` API)
- [x] contextIsolation on / nodeIntegration off 확인

## 2. OAuth flow
- [x] PKCE code verifier/challenge 생성 (auth.ts)
- [x] localhost redirect 서버 + 브라우저 오픈
- [x] 토큰 교환 + keytar Keychain 저장
- [x] refresh token 자동 갱신
- [!] Google Cloud Console OAuth Client ID 발급 — **사용자 액션 필요** (전까지 데모 모드)

## 3. Gmail API wrapper
- [x] gmail.ts: threads.list / threads.get / messages.send / labels.list
- [x] threads.modify (addLabels/removeLabels)
- [x] MIME 메시지 빌더 (RFC 2822, base64url)
- [x] 데모 모드 mock provider (Client ID 없이 UI 개발용)

## 4. SQLite cache
- [x] cache.ts: threads/messages/snoozes 스키마
- [x] FTS5 full-text 인덱스
- [x] read/write 헬퍼 + upsert 동기화

## 5. Thread list
- [x] 가상화 리스트 (@tanstack/react-virtual)
- [x] Row UI: 발신자/제목/스니펫/시각/unread dot/라벨 칩 (56px)
- [x] j/k 내비, Enter 열기
- [x] 트랙패드 스와이프 (우: 아카이브, 좌: 스누즈)

## 6. Thread view
- [x] 샌드박스 HTML 렌더 (iframe sandbox, JS 차단, 외부 이미지 기본 차단)
- [x] 인용문 접기/펼치기
- [x] 인라인 답장 컴포저
- [x] ] / [ 스레드 이동

## 7. Compose
- [x] 풀윈도우 오버레이 UI (To/CC/BCC/제목/본문 contenteditable)
- [x] 수신자 자동완성 (캐시된 발신자 기반)
- [x] ⌘Enter 전송 / ⌘⇧Enter 전송+아카이브
- [x] 10초 undo send
- [x] 예약 전송 (draft + 로컬 리마인더)

## 8. Split inbox
- [x] Primary/Other 필터 로직 (CATEGORY_* 라벨 제외)
- [x] 섹션 UI + ⌘⇧I 토글

## 9. Label sidebar
- [x] labels.list 렌더 + 색상 dot + unread 뱃지
- [x] 클릭 필터, g→l 라벨 피커

## 10. Command palette
- [x] kbar 셋업 + 스펙 §4-3 액션 14개 등록
- [x] 단축키 표시

## 11. Snooze
- [x] SnoozePicker (Later today / Tomorrow morning / Next week / Custom)
- [x] 라벨 스왑 (INBOX 제거 + zenmail/snoozed)
- [x] main 프로세스 1분 타이머 데몬 → 기한 도래 시 INBOX 복귀 + `mail:snooze-fired`

## 12. Polish & 검증
- [x] 포커스 링, empty state, 트랜지션
- [x] TypeScript 전체 typecheck 통과
- [x] `npm start` 앱 구동 확인 (데모 모드)
- [x] TODO/PRD/Obsidian 체크포인트 최종 업데이트

## 사용자 후속 액션 (릴리즈 전)
- [ ] Google Cloud Console에서 Desktop-app OAuth Client 생성 → `GOOGLE_CLIENT_ID` 설정
- [ ] 실계정 OAuth 플로우 E2E 확인
- [ ] `npm run make` 로 DMG/ZIP 패키징
