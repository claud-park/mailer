# snippets-inline-reply — TC (If-When-Then)

> E2E 프리픽스 `TC-SNIP-*`(기존 `TC-DD-*`의 Snippets 관련 케이스와 구분).

## A. 삽입

- **TC-SNIP-A1 피커 오픈**: If InlineReply 박스에 포커스, When `⌘;`, Then Snippets 피커가 열림.
- **TC-SNIP-A2 캐럿 위치 삽입**: If InlineReply에 "Hello world" 입력 후 "Hello " 뒤에 캐럿을 두고 `⌘;` → 스니펫 선택, Then 스니펫 본문이 정확히 그 위치에 삽입되고 "world"는 뒤에 그대로 남음.
- **TC-SNIP-A3 삽입 후 계속 타이핑 가능**: If A2 완료, When 추가로 문자 입력, Then 정상적으로 이어서 입력됨(에디터가 깨지지 않음).
- **TC-SNIP-A4 포커스 없을 때(예: 아무 캐럿도 저장 안 된 상태)**: If InlineReply가 비어있고 포커스만 있는 상태에서 `⌘;` → 선택, Then 에디터 끝(=시작)에 삽입됨(Compose의 "append at end" 폴백과 동일 동작).
- **TC-SNIP-A5 Esc로 피커 닫기**: If 피커가 열린 상태, When Esc, Then 피커가 닫히고 아무것도 삽입되지 않음.

## B. 독립성 회귀

- **TC-SNIP-B1**: 기존 Compose의 Snippets 동작(`TC-DD-B*`)이 무회귀.
- **TC-SNIP-B2**: SnippetsManager(CRUD)가 무회귀.

## C. 회귀 게이트

(run-tc.mjs 구현 시 이 리포의 가장 최근 관례인 attachments TC.md와 동일하게 G1/G2로 기록 — 다른 모든 feature 회귀 게이트도 전부 `TC-<PREFIX>-G1/G2` 패턴이라 C1/C2 대신 이 이름으로 통일.)

- **TC-SNIP-G1**: If snippets-inline-reply 전체가 배선된 상태면, When 기존 E2E 전건을 돌리면, Then 기존 캐논이 0 FAIL로 유지된다(B1/B2의 "무회귀"는 별도 신규 시나리오 없이 기존 `TC-DD-B*`/`TC-DD-C*` 어서션이 이 전체 재실행에서 그대로 PASS로 남는 것 자체로 검증됨).
- **TC-SNIP-G2**: `npx tsc --noEmit` + `npm test` exit 0.

> 실측(2026-07-16): E2E 전체 스위트 **250 PASS · 0 FAIL · 7 SKIP** (연속 2회 결정적으로 동일; SKIP 집합 = 캐논 5건 `{TC-A4, TC-D5, TC-D8, TC-SY-C3, TC-SY-B2}` + 다른 두 신규 feature의 SKIP 2건 `{TC-UNDO-B1, TC-LBL-A5}` — snippets-inline-reply 자체는 신규 SKIP 없음), vitest 195/195, tsc clean.

## 구현 중 발견한 divergence
- **TC-SNIP-A4 구현 메모**: "포커스만 있는 상태"를 재현하려면 InlineReply를 완전히 언마운트(스레드 닫기→재오픈)해 `savedRangeRef`/`body` state를 리셋해야 하는데, 일반 `Escape` 키 입력은 포커스가 여전히 그 `contentEditable` 안에 있으면 `useKeyboard`의 `isTyping(e.target)` 가드에 걸려 전역 "스레드 닫기"로 라우팅되지 않는다(SnippetPicker 자체의 Esc는 피커 컴포넌트가 `stopPropagation`으로 직접 처리하므로 A5는 영향 없음). E2E는 `Escape` 전에 `document.body.focus()`로 포커스를 이동시켜 우회.
