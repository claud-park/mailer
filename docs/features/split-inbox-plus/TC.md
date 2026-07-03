# F1 split-inbox-plus — Test Cases (If-When-Then)

> Goal 3 산출물. Goal 7에서 전 케이스 E2E 통과해야 완료. 데모 모드(`npm start`) 기준, 실계정 케이스는 별도 표기.
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP(사유 병기)
> 2026-07-03 e2e/run-tc.mjs 자동 검증: 34 PASS · 3 SKIP · 0 FAIL

## A. 탭 바 표시·카운트

- [x] **TC-A1** If 데모 모드로 INBOX 뷰에 있고 splitInbox가 on일 때, When 앱을 실행하면, Then 리스트 상단에 [Inbox][VIP][Team][Newsletter][Other] 탭 바가 표시되고(Inbox 맨 앞 고정, 스플릿은 position 순) 각 탭에 unread 카운트가 보인다.
- [x] **TC-A6** If Inbox 탭을 열면, When 목록을 보면, Then 필터 없이 로드된 전체 INBOX 스레드가 보인다(매칭과 무관).
- [x] **TC-A2** If 스레드가 여러 규칙에 매칭될 수 있을 때(예: 팀 도메인 발신자가 VIP 목록에도 있음), When 탭별 목록을 확인하면, Then 그 스레드는 position이 빠른 스플릿 하나에만 나타난다(first-match 배타).
- [x] **TC-A3** If 모든 스플릿의 카운트를 합하면, When 통합 리스트(⌘⇧I off)와 비교했을 때, Then 합계가 전체 INBOX 로드분과 일치한다(누락/중복 없음).
- [~] **TC-A4** If `nextPageToken`이 남아 있을 때(추가 페이지 존재), When 탭 카운트를 보면, Then `N+` 형식으로 표시된다. _(SKIP: 데모 provider가 nextPageToken 미반환 — 실계정 E2E에서 검증 예정)_
- [x] **TC-A5** If 어떤 규칙에도 매칭되지 않는 스레드가 있을 때, When Other 탭을 열면, Then 그 스레드가 Other에 나타난다.

## B. 탭 전환·표시 조건

- [x] **TC-B1** If INBOX 뷰에서 탭 바가 보일 때, When 탭을 클릭하면, Then 해당 스플릿의 스레드만 표시되고 첫 스레드가 선택된다(selectedIndex=0).
- [x] **TC-B2** If 검색어를 입력했을 때(`/` 검색), When 검색 결과가 표시되면, Then 탭 바는 숨고 전체 검색 결과가 한 리스트로 보인다.
- [x] **TC-B3** If SENT 등 INBOX 외 라벨 뷰로 이동하면(g s), When 리스트가 로드되면, Then 탭 바가 표시되지 않는다.
- [x] **TC-B4** If 특정 스플릿에 매칭 스레드가 없을 때, When 그 탭을 열면, Then 탭은 카운트 0으로 유지되고 리스트에 탭 문맥 empty state가 보인다.
- [x] **TC-B5** If ⌘⇧I를 누르면, When 탭바가 off 되면, Then 통합 단일 리스트(전체 INBOX)가 보이고, 다시 누르면 마지막 활성 탭으로 복귀한다. Toolbar Split 버튼도 동일 동작.

## C. 키보드

- [x] **TC-C1** If 리스트 포커스 상태(비타이핑·비모달)일 때, When Tab/⇧Tab을 누르면, Then 다음/이전 탭으로 순환 이동한다(마지막→첫 탭 래핑 포함).
- [x] **TC-C2** If 탭이 n개 있을 때, When ⌘1~⌘n을 누르면, Then 해당 순번 탭으로 직접 이동한다. 범위 밖 ⌘k(k>n)는 no-op.
- [x] **TC-C3** If Compose가 열려 있을 때, When Tab을 누르면, Then 탭 전환이 아니라 To→CC→제목→본문 필드 포커스 이동이 일어난다.
- [x] **TC-C4** If 검색 입력 중일 때, When Tab을 누르면, Then 탭 전환이 일어나지 않는다.
- [x] **TC-C5** If 모달(SnoozePicker/LabelPicker/SplitSettings)이 열려 있을 때, When Tab/⌘1을 누르면, Then 탭 전환이 일어나지 않는다.
- [x] **TC-C6** If ⌘K 팔레트를 열면, When "split"을 검색하면, Then Next/Previous split·Configure splits·Toggle split inbox 액션이 보이고 실행된다.

## D. 탭 내 내비게이션·액션 (selectedIndex 재정박 회귀)

- [x] **TC-D1** If VIP 탭에 스레드 3개가 있을 때, When j/k로 이동하면, Then 선택이 그 탭에 보이는 3개 안에서만 움직인다(다른 스플릿 스레드로 건너뛰지 않음).
- [x] **TC-D2** If 탭 내 스레드를 선택하고 Enter로 열었을 때, When ]/[로 이동하면, Then 같은 탭의 다음/이전 스레드로 이동한다.
- [x] **TC-D3** If 탭 내 중간 스레드를 archive(e)하면, When 리스트가 갱신되면, Then 선택이 같은 탭의 다음 스레드로 자동 전진한다(auto-advance 보존).
- [x] **TC-D4** If 탭의 마지막 스레드를 archive하면, When 리스트가 갱신되면, Then selectedIndex가 클램프되어 새 마지막 스레드가 선택된다(빈 탭이면 empty state, 내비 no-op).
- [~] **TC-D5** If 트랙패드 스와이프로 archive/스누즈하면, When 탭 필터가 적용된 상태라면, Then 올바른(화면에 보이는 그) 스레드에 액션이 적용된다. _(SKIP: CDP로 트랙패드 스와이프 시뮬레이션 불가 — 수동 검증 필요)_
- [x] **TC-D6** If 스레드를 읽음 처리(mark read)하면, When 재파생되면, Then 스레드는 같은 탭에 남고 unread 카운트만 감소한다.
- [x] **TC-D7** If 스레드가 열린 채 탭을 전환하면, When 새 탭에서 j/k를 누르면, Then 열린 스레드는 유지되되 선택은 새 탭 목록 안에서만 움직인다.
- [~] **TC-D8** If 스크롤로 다음 페이지를 로드하면(loadMore), When 스레드가 추가되면, Then 활성 탭·선택이 유지되고 탭 카운트만 갱신된다. _(SKIP: 데모 provider가 loadMore 페이지네이션 미지원 — 실계정 E2E에서 검증 예정)_
- [x] **TC-D9** If 열린 스레드가 속한 스플릿의 규칙을 편집해 그 스레드가 활성 탭에서 빠지게 되면, When 저장하면, Then 열린 스레드는 닫히지 않고 유지되며 선택만 새 목록 기준으로 재정박된다.

## E. 설정 모달 (CRUD)

- [x] **TC-E1** If 탭바 gear(또는 kbar Configure splits)를 실행하면, When 모달이 열리면, Then 기본 3종이 position 순으로 보이고, Inbox/Other는 편집 행이 아니라 하단 "Unmatched mail goes to Other" 안내 텍스트로만 표시된다. (PRD §3-3, D13 — 2026-07-03 설계 확정에 맞게 문구 갱신)
- [x] **TC-E2** If 새 스플릿(예: labels 규칙)을 추가하고 저장하면, When 모달을 닫으면, Then 새 탭이 즉시 나타나고 매칭 스레드가 그 탭으로 이동한다(IPC 재로드 없이 즉시).
- [x] **TC-E3** If 스플릿 순서를 위/아래 버튼으로 바꾸고 저장하면, When 탭 바를 보면, Then 탭 순서·⌘N 매핑·first-match 우선순위가 모두 새 순서를 따른다.
- [x] **TC-E4** If 현재 활성 탭인 스플릿을 삭제하고 저장하면, When 모달을 닫으면, Then 활성 탭이 첫 탭(없으면 Other)으로 폴백하고 앱이 크래시하지 않는다.
- [x] **TC-E5** If 스플릿을 disabled로 토글하고 저장하면, When 탭 바를 보면, Then 그 탭이 사라지고 매칭 스레드는 Other(또는 다음 매칭 스플릿)로 재배치된다.
- [x] **TC-E6** If VIP 스플릿에 발신자 이메일을 chip으로 추가하면(대문자 포함 입력), When 저장하면, Then 소문자 정규화되어 해당 발신자 스레드가 VIP 탭에 나타난다.
- [x] **TC-E7** If 모달에서 Esc를 누르면, When 저장하지 않았다면, Then 변경이 폐기되고 기존 정의가 유지된다.

## F. 영속화

- [x] **TC-F1** If 스플릿을 수정·순서변경하고, When 앱을 완전히 재시작하면, Then 수정된 정의가 그대로 복원된다.
- [x] **TC-F2** If 탭바 off + Team 탭 활성 상태에서, When 앱을 재시작하면, Then 탭바 off 상태와 마지막 활성 탭이 복원된다.
- [x] **TC-F3** If 첫 실행(빈 splits 테이블)이면, When 로그인/데모 진입하면, Then 기본 3종이 시드되고 Team 도메인이 계정 이메일 도메인으로 채워진다.
- [x] **TC-F4** If 데모 모드에서 로그아웃 후 재로그인하면, When 스플릿을 보면, Then 정의가 유지된다(계정 무관 로컬 설정).

## G. 데모 데이터·시연

- [x] **TC-G1** If 데모 모드로 실행하면, When 각 기본 탭을 열면, Then VIP·Team·Newsletter 모두 1개 이상의 스레드가 있어 시연 가능하다.

## H. 회귀 (기존 기능 보존)

- [x] **TC-H1** If 탭 뷰 상태에서, When c(작성)/e/r/a/s/스누즈/라벨 등 기존 액션을 쓰면, Then MVP와 동일하게 동작한다.
- [x] **TC-H2** If 전체 typecheck를 돌리면(`npx tsc --noEmit`), When 완료되면, Then 에러 0.
