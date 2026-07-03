# F3 keyboard-mastery — Test Cases (If-When-Then)

> Goal 3 산출물. 데모 모드 자동 E2E(run-tc.mjs 확장). ground truth: DOM + `page.evaluate`로 localStorage(`zenmail-coach`) 판독 — 신규 디버그 IPC 없음.
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP(사유 병기)

## A. 치트시트 (`?`)

- [ ] **TC-A1** If 리스트에 포커스가 있으면, When `?`(Shift+/)를 누르면, Then 치트시트 오버레이가 열리고 Archive `e`·Compose `c` 등 전체 단축키가 보인다.
- [ ] **TC-A2** If 치트시트가 열려 있으면, When Esc를 누르면, Then 닫히고 전역 단축키가 즉시 복원된다.
- [ ] **TC-A3** If 검색 입력에 타이핑 중이면, When `?`를 입력하면, Then 치트시트가 열리지 않고 문자로 입력된다(isTyping 가드).
- [ ] **TC-A4** If ⌘K 팔레트에서 "shortcuts"를 검색하면, When 실행하면, Then 치트시트가 열린다.
- [ ] **TC-A5** If 치트시트가 열려 있으면, When `j`/`k`를 누르면, Then 리스트 선택이 움직이지 않는다(모달 keydown 차단 규약).

## B. 계측·통계

- [ ] **TC-B1** If 키보드로 아카이브(`e`)를 2회 하면, When Stats를 열면(팔레트 "Your stats"), Then 누적 아카이브 카운트에 2가 반영돼 있다.
- [ ] **TC-B2** If Compose를 마우스 버튼으로 열면, When localStorage를 판독하면, Then mouse 카운트가 증가하고 키보드 비율이 하락한다.
- [ ] **TC-B3** If Compose를 `c`로 열면, When localStorage를 판독하면, Then keyboard 카운트가 증가한다.
- [ ] **TC-B4** If 스와이프로 아카이브하면, When 카운트를 판독하면, Then 총계(archive)와 mouse(modality) 양쪽에 반영된다(D5 2층·D10 dual-modality).
- [ ] **TC-B5** If 마우스 등가물이 없는 액션(`b` 스누즈 등)만 쓰면, When 비율을 보면, Then 비율 계산에 산입되지 않는다(분모 불변 — 허수 방지).
- [ ] **TC-B6** If Stats 모달이 열려 있으면, When Esc를 누르면, Then 닫힌다.
- [ ] **TC-B7** If vitest(`lib/coach.test.ts`)를 돌리면, Then 비율·주간 리셋·힌트 게이팅·마일스톤 경계 순수함수가 전부 통과한다.

## C. 힌트

- [ ] **TC-C1** If 힌트 노출 이력이 없으면, When Toolbar Compose 버튼을 마우스로 클릭하면, Then "Press C" 힌트 토스트가 뜬다(액션 토스트와 독립 슬롯).
- [ ] **TC-C2** If 같은 힌트가 이 세션에 이미 노출됐으면, When 다시 클릭하면, Then 재노출되지 않는다(세션당 1회).
- [ ] **TC-C3** If 힌트 shownCount가 3이면(localStorage 사전 주입), When 새 세션에서 클릭하면, Then 노출되지 않는다(누적 3회 캡).
- [ ] **TC-C4** If 힌트 토스트의 "팁 그만 보기"를 클릭하면, When 이후 다른 마우스 어포던스를 클릭하면, Then 어떤 힌트도 나오지 않는다(전역 뮤트, 재시작 후에도 유지).
- [ ] **TC-C5** If 스레드 행을 마우스로 클릭해 열면, When 토스트를 보면, Then `j`/`k` + `↵` 힌트가 뜬다.
- [ ] **TC-C6** If 스와이프로 아카이브하면, When 토스트를 보면, Then `E` 힌트가 뜬다.

## D. 마일스톤

- [ ] **TC-D1** If 아카이브 이력이 없으면, When 첫 아카이브를 하면, Then 마일스톤 토스트가 1회 뜨고, 두 번째 아카이브에서는 뜨지 않는다.
- [ ] **TC-D2** If 스누즈 이력이 없으면, When 첫 스누즈를 하면, Then 마일스톤 토스트가 뜬다.
- [ ] **TC-D3** If 액션 토스트("Archived")와 마일스톤 토스트가 동시에 발생하면, When 화면을 보면, Then 서로 덮어쓰지 않고 함께 보인다(D9 독립 채널).
- [ ] **TC-D4** If milestonesShown에 기록된 상태로 재시작하면, When 같은 조건을 재현하면, Then 재발화하지 않는다(영속).

## E. 튜토리얼

- [ ] **TC-E1** If 신선한 프로필로 첫 실행하면, When 인박스 로드가 끝나면, Then 튜토리얼이 자동 시작된다(step 1 코치 버블 — `j`).
- [ ] **TC-E2** If 튜토리얼 step 1에서, When `j`를 누르면, Then 리스트 선택이 실제로 이동하고 다음 스텝으로 진행된다(비파괴 키 통과).
- [ ] **TC-E3** If 현재 스텝과 무관한 키를 누르면, When 스텝 상태를 보면, Then 진행되지 않는다.
- [ ] **TC-E4** If 아카이브 스텝(`e`)에서, When `e`를 누르면, Then 스텝은 진행되지만 실제 스레드는 아카이브되지 않는다(리스트 카운트 불변 — 인터셉트).
- [ ] **TC-E5** If 튜토리얼 중 어느 스텝에서든(예: step 1), When `e`를 누르면, Then 아카이브가 발생하지 않는다(파괴 키 상시 삼킴 — D7).
- [ ] **TC-E6** If 튜토리얼 중, When Esc를 누르면, Then 즉시 종료되고, 재시작해도 자동 시작되지 않는다(tutorialSeen 영속).
- [ ] **TC-E7** If 튜토리얼을 스킵했어도, When 팔레트 "Start tutorial"을 실행하면, Then step 1부터 재진입한다.
- [ ] **TC-E8** If 마지막 스텝까지 올바른 키를 누르면, When 완주하면, Then 완료 카드가 뜨고 닫으면 정상 상태로 복귀한다(전역 단축키 복원).

## F. 영속성

- [ ] **TC-F1** If 카운터·뮤트·tutorialSeen이 쌓인 상태에서, When 동일 user-data-dir로 재시작하면, Then 전부 유지된다(localStorage 파티션).

## G. 회귀

- [ ] **TC-G1** If F1+F2 E2E 전체(run-tc.mjs)를 돌리면, When 완료되면, Then 기존 58 시나리오가 전부 그린이다(perform 래핑·capture 리스너가 기존 단축키를 깨지 않음).
- [ ] **TC-G2** If vitest 전체를 돌리면, Then 기존 17 + 신규 케이스 전부 통과한다.
- [ ] **TC-G3** If `npx tsc --noEmit`을 돌리면, Then 에러 0.
