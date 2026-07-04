# F5 detail-density — Feature PRD

> 2026-07-05 · Goal 1 산출물. 설계: deep-reasoner(Opus) 독립 2인스턴스(A: 워크플로우 / B: 에디터·입력 시스템 관점) → 합성([DECISIONS.md](DECISIONS.md) D1~D12). Codex 사용량 한도 불참(F3 D4 선례).
> 상위: [DEV_WORKFLOW.md](../../DEV_WORKFLOW.md) · [RESEARCH_SUPERHUMAN.md](../../RESEARCH_SUPERHUMAN.md) wow #5 — "디테일의 밀도"

## 1. 목적

"이 앱은 나보다 이메일을 잘 안다"는 인상을 만드는 마이크로 기능 2종: **Snippets**(재사용 문구 즉시 삽입)와 **Instant Intro**(소개 메일 reply-all 시 소개자를 Bcc로 내리고 감사하는 에티켓 원클릭). read-status(픽셀 트래킹)는 **기각** — 스펙 §4-5(수신 외부 이미지 기본 차단)와 자기모순이고 프라이버시 포지셔닝("zen")을 훼손(✅ 사용자 확정, D1).

## 2. 범위

### In
- **Snippets**:
  - 저장: `settings` KV에 JSON 배열 단일 키 — **신규 IPC/테이블 0**(D4). 스키마 `{id, name, body, createdAt}`, body는 **plain text**(D5).
  - 삽입: Compose 본문에서 **⌘;** → 피커 모달(검색·↑↓·Enter 삽입·Esc, 모달 stopPropagation 규약). 커서 정합성: ⌘; 시점에 Range 스냅샷 저장 → 삽입 시 focus→복원→`execCommand('insertText')`(네이티브 ⌘Z 통합) → 실패 시 `Range.insertNode(textToFragment)` 폴백 → 캐럿을 삽입물 끝으로 → 피커 닫기(D6). 본문 무포커스(제목 필드 등)면 본문 끝 append 폴백.
  - 관리: kbar "Snippets…" → SnippetsManager 모달(`<textarea>` CRUD — contenteditable/IME 이슈 원천 회피). SplitSettings 패턴(store 플래그 + App 마운트).
- **Instant Intro**:
  - 감지: `openReply`(reply-all composeInit 빌더)에서 동기 순수함수 `detectIntro(detail, me)` — **구조(제3자 cc≥1 ∧ from≠me) ∧ 스레드 길이≤2 ∧ subject 키워드(en: intro/introduc/connect·ko: 소개)** AND 게이트(D8). 결과는 `composeInit.intro`로 첨부.
  - UX: Compose 상단 슬림 배너 "Introduced by {name}? Move to Bcc & thank" — **원클릭 적용 + × 해제, 자동 적용 절대 금지**. 적용 = 소개자 To→Bcc, 제3자 Cc→To 승격, showCcBcc, 감사 문구를 본문 최상단 prepend(내장 템플릿 상수, D9).
- vitest: `lib/snippets.ts`(파싱 가드·필터·textToFragment) + `lib/intro.ts`(감지 정밀도 — 오탐/미탐 케이스).
- E2E: 스니펫 시드는 기존 `setSetting`으로(디버그 훅 불요), **커서 정합성 어서션**(AB 사이 캐럿 → 삽입 → AXB), ⌘; 키보드 전 흐름, 폴백, 인트로 양성/음성(D11).

### Out
- read-status/픽셀 트래킹(D1, ✅ 사용자 확정 기각)
- 인라인 `;트리거`(D2 기각 — 한글 IME 조합 엣지)
- 리치텍스트/HTML 스니펫(D5 — 발신 경로 XSS 표면 신설, `format` seam만 유지), {firstName} 변수 치환(D7 defer — To가 bare email이라 오치환 위험)
- InlineReply(스레드 내 답장)로의 스니펫 확장(D12 — 제어형 에디터 재동기 필요, v1 범위 외)
- F4 latency 계측·coach bumpStat 연계(D10 — IPC 없는 로컬 편집이라 지표 오염/YAGNI)
- 감사 문구 설정 override(D9 defer)

## 3. 성공 기준

1. E2E: ⌘; 전 키보드 흐름으로 커서 위치에 스니펫 삽입(AXB 어서션), 제목 필드 폴백, CRUD 반영, 인트로 배너 양성(Bcc 이동+문구)·음성(일반 그룹 reply-all에 배너 없음) 전부 PASS.
2. 기존 E2E 112건 무회귀 + vitest 신규(snippets/intro) green + tsc green.
3. 신규 IPC 0(인트로 E2E fixture 훅 제외), main process 변경 최소.
4. 발신 본문에 마크업 주입 경로 없음(스니펫은 텍스트 노드로만 진입).

## 4. 아키텍처

```
Snippets: settings KV(JSON) ←getSetting/setSetting→ store(snippets, load/save)
  ├─ SnippetsManager(kbar "Snippets…", textarea CRUD)
  └─ Compose ⌘; → SnippetPicker → savedRange 복원 → insertText/insertNode → 캐럿 끝
Instant Intro: openReply(replyAll) → lib/intro.detectIntro → composeInit.intro
  └─ Compose 배너 → 원클릭: To/Bcc 재배치 + textToFragment prepend
```

신규: `lib/snippets.ts`(+test), `lib/intro.ts`(+test), `components/SnippetPicker.tsx`, `components/SnippetsManager.tsx`. 변경: `shared/types.ts`(SnippetRecord), `store/mail.ts`(snippets 상태·ComposeInit.intro·openReply), `Compose.tsx`(⌘;·배너·삽입), `CommandPalette.tsx`(관리 액션), `e2e/run-tc.mjs`(TC-DD-*). main은 인트로 E2E fixture 필요 시 debug 훅만.
