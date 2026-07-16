# snippets-inline-reply — PRD

> 2026-07-16 · 오케스트레이터 도출 UX 개선 3건 중 3번. `detail-density` DECISIONS D12에서 "out of scope for v1, backlog"로 명시적으로 남겨졌던 항목. 브레인스토밍 설계 스펙: `docs/superpowers/specs/2026-07-16-ux-improvements-design.md`.

## 문제

Snippets(`⌘;` 재사용 문구 삽입)는 F5/detail-density에서 Compose(새 메일 작성) 창에만 구현됐다. 실제로는 스레드를 열어 바로 답장하는 InlineReply 경로가 훨씬 빈번한 사용 패턴인데, 그곳엔 Snippets가 없어 자주 쓰는 문구를 매번 손으로 타이핑해야 한다.

## 요구사항

### R1. InlineReply에서 `⌘;`로 Snippets 피커 오픈
- Compose와 동일한 `SnippetsPicker` 컴포넌트를 재사용.
- 캐럿 위치에 삽입(Compose와 동일 — 삽입 전 위치 저장 → 삽입 후 그 자리로 커서 이동).
- 삽입은 `execCommand('insertText', ...)` 우선 시도(1-스텝 undo 호환) 후 실패 시 Range 기반 수동 삽입 폴백 — Compose의 기존 로직을 그대로 포팅.

### R2. 기존 Snippets 관리(CRUD)와 완전히 독립적
- SnippetsManager(⌘K 팔레트에서 여는 관리 UI)는 무변경 — 이 feature는 "어디서 삽입 가능한가"만 확장한다.

## 논스코프
- Snippets 자체의 신규 필드/기능.
- InlineReply의 다른 단축키·UI 변경.

## 성공 기준
- 데모: 스레드를 열고 InlineReply 박스에 포커스한 채 `⌘;` → 피커 오픈 → 스니펫 선택 → 캐럿 위치에 정확히 삽입되고 이후 계속 타이핑 가능.
- E2E `TC-SNIP-*` 전건 PASS + 전체 스위트 무회귀.
