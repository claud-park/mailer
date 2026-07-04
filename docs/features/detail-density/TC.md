# F5 detail-density — Test Cases (If-When-Then)

> Goal 3 산출물. 데모 모드 자동 E2E(run-tc.mjs 확장, TC-DD-*). ground truth: DOM(compose 오버레이 스코핑 — InlineReply와 `[contenteditable]` 공유 주의) + `getSetting` 판독. vitest는 lib 순수 로직.
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP(사유 병기)

## A. 순수 로직 (vitest)

- [ ] **TC-A1** If settings에 손상된 JSON이 있으면, When loadSnippets 파싱하면, Then 빈 배열로 복구된다(크래시 없음).
- [ ] **TC-A2** If body에 개행 2연속이 있으면, When textToFragment로 변환하면, Then `<br>` 기반 fragment가 되고 마크업 문자는 텍스트 노드로만 존재한다(`<img>` 문자열이 요소로 승격되지 않음).
- [ ] **TC-A3** If 스니펫 5개가 있으면, When "sig"로 필터하면, Then name/body 매칭만 남는다(대소문자 무시).
- [ ] **TC-A4** If 소개 스레드(2메시지·제3자 cc·subject "Intro: …")면, When detectIntro하면, Then IntroSuggestion(소개자·제3자 목록)을 반환한다.
- [ ] **TC-A5** If (a) 키워드 없는 그룹 스레드 (b) 3+메시지 스레드 (c) from=나 (d) 제3자 0이면, When detectIntro하면, Then 각각 null(오탐 방지 4축).

## B. Snippets 삽입 (E2E)

- [ ] **TC-B1** If 스니펫이 시드돼 있고 Compose 본문에 "AB" 입력 후 캐럿을 A|B 사이로 옮기면, When ⌘; → 검색 타이핑 → Enter, Then 본문이 "A{body}B"가 된다(커서 위치 삽입 — append 아님).
- [ ] **TC-B2** If TC-B1 직후면, When "Y"를 타이핑하면, Then "A{body}YB"가 된다(캐럿이 삽입물 끝).
- [ ] **TC-B3** If 제목 필드에 포커스가 있으면, When ⌘; → 선택, Then 본문 끝에 append되고 본문으로 포커스가 이동한다(폴백).
- [ ] **TC-B4** If 피커가 열려 있으면, When Esc, Then 피커만 닫히고 Compose는 유지된다(이중 Esc로 Compose 닫힘 — 기존 규약).
- [ ] **TC-B5** If 스니펫 0개면, When ⌘;, Then 빈 상태 안내가 보인다.
- [ ] **TC-B6** If 피커가 열려 있으면, When j/k/c 등을 타이핑하면, Then 전역 단축키가 발화하지 않고 검색어로만 소비된다(stopPropagation 규약).

## C. Snippets 관리 (E2E)

- [ ] **TC-C1** If ⌘K 팔레트에서 "Snippets"를 실행하면, When 새 스니펫(name/body)을 추가하면, Then 목록에 반영되고 `getSetting`에 JSON으로 저장된다.
- [ ] **TC-C2** If 스니펫을 삭제하면, Then 목록·저장소에서 제거되고 피커에도 안 보인다.
- [ ] **TC-C3** If 매니저가 열려 있으면, When Esc, Then 닫히고 전역 단축키가 복원된다(모달 규약).

## D. Instant Intro (E2E)

- [ ] **TC-D1** If 인트로형 스레드(2메시지 이내·제3자 포함·subject 키워드)를 열고, When reply-all 하면, Then Compose 상단에 인트로 배너가 보인다.
- [ ] **TC-D2** If 배너에서 원클릭을 실행하면, Then 소개자가 To에서 사라져 Bcc 칩에 있고, 제3자가 To에 있고, 본문 최상단에 감사 문구가 있다.
- [ ] **TC-D3** If 배너를 ×로 해제하면, Then 배너가 사라지고 To/Cc는 불변이다.
- [ ] **TC-D4(음성)** If 키워드 없는 일반 그룹 스레드면, When reply-all 하면, Then 배너가 나타나지 않는다(오탐 회귀 방지).
- [ ] **TC-D5(음성)** If 단독 수신(제3자 0) 스레드면, When reply-all 하면, Then 배너가 나타나지 않는다.

## E. 회귀 게이트

- [ ] **TC-E1** If F5 전체가 배선된 상태면, When 기존 E2E 112건을 돌리면, Then 전부 기존 상태(109 PASS·3 SKIP)를 유지한다 — 특히 Compose 관련(F1/F2 compose·send·schedule) 및 Esc 처리.
- [ ] **TC-E2** If `npm test`+`npx tsc --noEmit`를 돌리면, Then 신규 snippets/intro 스위트 포함 전부 통과한다.
- [ ] **TC-E3** If ⌘;를 Compose 밖(리스트)에서 누르면, Then 아무 일도 일어나지 않는다(전역 미등록 확인).
