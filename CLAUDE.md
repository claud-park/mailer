# ZenMail — Claude Code Project Instructions

미니멀 키보드 중심 macOS Gmail 클라이언트. Electron 33 + React 19 + TypeScript + Tailwind v4.

## 필독 문서 (새 세션 시작 시 이 순서로)

1. `docs/DEV_WORKFLOW.md` — **개발 순서(F1~F6)와 feature별 필수 프로세스(Goal 0~8), 현재 상태 스냅샷, 재개 절차**
2. `TODO.md` — 전체 진행 상황 트래킹
3. `PRD.md` — 제품 요구사항 / `docs/MAIL_APP_SPEC.md` — 원본 스펙
4. `docs/RESEARCH_SUPERHUMAN.md` — 로드맵의 근거 리서치
5. 진행 중 feature가 있으면 `docs/features/<slug>/` (PRD/TODO/TC/DECISIONS)

## 핵심 규칙 (사용자 지시)

- **Feature 개발은 반드시 DEV_WORKFLOW.md의 Goal 0~8 순서를 따른다**: superpowers plan first → feature PRD → checkpoint TODO → If-When-Then TC → 결정 이유 문서화(DECISIONS.md) → /react-best-practices → /impeccable audit pass → TC 전부 통과하는 E2E → Obsidian 기록.
- **모든 breaking change마다**: `/react-best-practices` + `/code-review low` 리뷰 → 커밋 → `git@github.com:claud-park/mailer.git` main으로 push.
- **Obsidian 체크포인트**: 의미 있는 마일스톤마다 `/Users/claud_01/Documents/flo/_obsidian/Projects/ZenMail.md`에 추가 (vault index.md의 Active Projects 최근 업데이트 날짜도 갱신).
- v1은 **No AI** (스펙 §9). AI 제안 금지 — 오히려 차별화 포인트.

## 명령어

```bash
cd zenmail
npm start              # 개발 실행 (데모 모드; GOOGLE_CLIENT_ID env 있으면 실계정 로그인 가능)
npx tsc --noEmit       # typecheck
npm run make           # DMG/ZIP 패키징
```

## 아키텍처 요약

- `zenmail/src/main/` — Electron main: `auth.ts`(OAuth PKCE+keytar), `gmail.ts`(GmailProvider 인터페이스 + Real/Mock), `cache.ts`(better-sqlite3 + FTS5), `snooze.ts`(1분 데몬: 스누즈 복귀+예약전송), `ipc.ts`
- `zenmail/src/renderer/` — React: `store/mail.ts`(zustand 단일 스토어), `components/`(Sidebar·Toolbar·ThreadList·ThreadView·Compose·CommandPalette·SnoozePicker·LabelPicker), `hooks/`(useKeyboard·useThreads)
- `zenmail/src/shared/types.ts` — IPC 계약(`ZenmailApi`)의 단일 소스
- 단축키 소유권 분리: 단일 키 액션(c/e/r/a/f/l/b/#/I/U//, g-시퀀스)은 **kbar**가, j/k/Enter/[/]/Esc/⌘⇧I는 **useKeyboard**가 처리. 모달은 keydown stopPropagation으로 전역 단축키 차단.

## 빌드 함정 (반복 주의)

- vite config는 `.mts` 확장자 유지 (ESM 전용 플러그인)
- `@vitejs/plugin-react`는 **v4 고정** (v5+는 vite 6 요구, 현재 vite 5)
- npm install 시 peer 충돌은 `--legacy-peer-deps`, googleapis 타입 충돌은 `npm dedupe`
- 네이티브 모듈(better-sqlite3, keytar)은 forge가 자동 리빌드; keytar 실패 시 파일 폴백 내장
