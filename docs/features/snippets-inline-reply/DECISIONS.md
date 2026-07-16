# snippets-inline-reply — DECISIONS

> 2026-07-16. 전건 구현 세부 추천안(사용자 확정 대상 결정 없음 — 순수 포팅 작업).

## D1. Compose의 삽입 로직을 그대로 포팅(재작성 아님) — 추천안
- **컨텍스트**: Compose의 `insertSnippet`은 `execCommand('insertText', ...)` 우선 시도 후 실패 시 `Range.insertNode(textToFragment(body))` 폴백 — 전자가 성공하면 ⌘Z가 그 삽입을 한 번에 되돌릴 수 있어(1-스텝 undo) 후자보다 우선한다는 이유가 이미 detail-density에서 검증됨.
- **선택**: InlineReply에도 동일한 이중 시도 순서를 그대로 복제.
- **이유**: 이미 검증된 패턴을 재작성하며 미묘하게 다르게 만들 이유가 없다 — 두 컴포넌트가 조금씩 다른 삽입 동작을 하면 사용자가 "왜 여기선 undo가 한 번에 안 되지"를 겪게 된다.

## D2. `SnippetsPicker` 컴포넌트 재사용, 신규 컴포넌트 없음 — 추천안
- **컨텍스트**: 피커 UI(스니펫 이름·미리보기 목록, `onInsert` prop으로 삽입 콜백만 주입)는 Compose 전용으로 만들어지지 않고 이미 제너릭하다(코드 확인).
- **선택**: InlineReply에서도 동일 컴포넌트를 import해 `onInsert={insertSnippetInline}`만 다르게 연결.
- **이유**: UI 중복 없음 — 스코프가 정확히 "삽입 로직을 어디서도 쓸 수 있게" 하는 것이지 새 UI를 만드는 게 아니다.

## D3. 캐럿 저장(`savedRangeRef`)은 InlineReply 로컬 state — 추천안
- **선택**: Compose와 마찬가지로 InlineReply 컴포넌트 내부의 `useRef`로 캐럿 위치를 저장(전역 store에 안 둠).
- **이유**: 캐럿 위치는 특정 에디터 DOM 노드에 강하게 결합된 순간적 상태라 컴포넌트 로컬이 맞다 — Compose도 동일한 이유로 로컬에 둔다(대칭).
