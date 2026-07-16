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

- **TC-SNIP-C1**: `npx tsc --noEmit` + `npm test` exit 0.
- **TC-SNIP-C2**: 전체 스위트 무회귀(0 FAIL + SKIP ⊆ 캐논 집합) ×2.
