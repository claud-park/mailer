# F5 detail-density — Checkpoint TODO

> Goal 2 산출물. 각 CP는 `npx tsc --noEmit` + `npm test` 통과, breaking change 시 리뷰 프로토콜(react-best-practices + code-review low → 커밋 → push).
> Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## CP0. 설계 (Goal 0~4)
- [x] 브레인스토밍 — 사용자 확정 3건(D1 read-status 기각·D2 ⌘; 피커·D3 Instant Intro 채택)
- [x] deep-reasoner(Opus) 독립 2인스턴스 병렬 설계 → 합성 (D4~D12)
- [x] PRD/TODO/TC/DECISIONS 작성

## CP1. Snippets 데이터층 (UI 없음)
- [x] `shared/types.ts` — `SnippetRecord { id; name; body; createdAt }` (ZenmailApi 무변경)
- [x] `lib/snippets.ts` — SNIPPETS_KEY, parse 가드(손상 JSON→[]), filterSnippets(검색), textToFragment(createTextNode+br, escape 불요 원리 주석)
- [x] `store/mail.ts` — `snippets` 상태 + loadSnippets(init 배선)/saveSnippets(setSetting)
- [x] `lib/snippets.test.ts` vitest (파싱 가드·필터·개행 변환·빈 목록)
- [x] tsc + npm test

## CP2. SnippetPicker + ⌘; 삽입 (커서 정합성 — 최대 불확실성 우선)
- [x] Compose 내부 onKeyDown에 ⌘; 분기 — Range 스냅샷 저장(editor 포함 여부 가드) + 피커 오픈
- [x] `components/SnippetPicker.tsx` — 검색 input autofocus·↑↓·Enter·Esc, 모달 stopPropagation 규약, 빈 상태 안내
- [x] 삽입: focus→addRange(saved)→execCommand('insertText') 1차→insertNode(textToFragment) 폴백→캐럿 끝→닫기 (D6 순서)
- [x] 본문 무포커스 폴백(끝 append+focus)
- [x] ⌘Z 1스텝 undo 수동 확인(D6 근거 실증), tsc + npm test

## CP3. SnippetsManager CRUD
- [x] `components/SnippetsManager.tsx` — textarea 기반 목록/추가/편집/삭제, SplitSettings 미러(store 플래그 `snippetsOpen` + App 마운트)
- [x] CommandPalette "Snippets…" 액션
- [x] tsc + npm test

## CP4. Instant Intro
- [x] `lib/intro.ts` — detectIntro(detail, me): D8 AND 게이트, 상수 노출(INTRO_MAX_MESSAGES, INTRO_SUBJECT_RE) + `lib/intro.test.ts`(양성·오탐 케이스: 일반 그룹 reply-all, 긴 스레드, 키워드 무, from=me)
- [x] `store/mail.ts` — ComposeInit.intro 확장, openReply(replyAll)에서 detectIntro 배선
- [x] Compose 상단 배너 + 원클릭(To/Bcc 재배치·제3자 승격·showCcBcc·감사 문구 prepend) + × 해제
- [x] 데모 mock에 인트로형 스레드 존재 확인 → 부재 시 `__debugSeedIntroThread` 훅(D11)
- [x] tsc + npm test

## CP5. E2E (run-tc.mjs 확장, TC-DD-*)
- [x] 스니펫 시드(setSetting) + 피커 전 키보드 흐름 + 커서 정합성 AXB/AXYB 어서션
- [x] 제목 필드 폴백, CRUD 반영, 빈 상태
- [x] 인트로 양성(Bcc 이동·To 승격·문구)·음성(일반 그룹 reply-all 배너 부재)
- [x] 기존 112건 무회귀, 연속 2회 안정, TC.md 갱신
- [x] 기존 npm test/tsc 게이트 앞 배선

## CP6. 마무리 (Goal 5~8)
- [x] /react-best-practices(위반 없음) + web-design-guidelines 감사 — 피커 검색 input aria-label·placeholder 말줄임 2건 수정
- [x] /code-review low (CP별 diff 리뷰, findings 없음) → 커밋 → push
- [x] DEV_WORKFLOW/TODO 스냅샷 + Obsidian 체크포인트
