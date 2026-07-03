# F2 follow-up-reminders — Test Cases (If-When-Then)

> Goal 3 산출물. 데모 모드 + 디버그 IPC(`__debugSimulateReply`/`__debugTick`) 기반 자동 E2E.
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP(사유 병기)

## A. 등록 (Compose)

- [ ] **TC-A1** If Compose에서 Remind 프리셋(3 days)을 선택하면, When 푸터를 보면, Then `Remind in 3d` pill이 표시되고 ✕로 해제할 수 있다.
- [ ] **TC-A2** If Remind를 설정하고 전송하면, When 10초 undo 윈도우가 경과하면, Then followup이 등록된다(listFollowups로 확인, ThreadView pending 배너 표시).
- [ ] **TC-A3** If Remind를 설정하고 전송한 뒤, When undo 윈도우 내에 Undo를 누르면, Then followup이 등록되지 않는다.
- [ ] **TC-A4** If Remind+Schedule을 함께 설정하면, When 예약 시각에 데몬이 발송하면(강제 틱), Then followup의 카운트다운이 실제 발송 시각부터 시작된다(due = 발송시각+N일).
- [ ] **TC-A5** If 새 컴포즈(threadId 없음)에 Remind를 설정해 전송하면, When 등록되면, Then 새로 생성된 스레드의 threadId로 followup이 걸린다(send()가 threadId를 반환).

## B. 등록 (기존 스레드)

- [ ] **TC-B1** If 스레드를 선택/열고 `h`를 누르면, When FollowupPicker가 열리면, Then 프리셋(2d/3d/1w)+커스텀으로 리마인드를 걸 수 있고 ThreadView에 pending 배너가 뜬다.
- [ ] **TC-B2** If 이미 pending인 스레드에서 `h`를 누르면, When picker가 열리면, Then "Cancel reminder"가 노출되고 실행 시 followup이 삭제된다.
- [ ] **TC-B3** If 같은 스레드에 리마인드를 다시 설정하면, When 저장되면, Then 기존 것을 대체한다(중복 없음 — thread_id PK upsert).
- [ ] **TC-B4** If ⌘K 팔레트에서 "remind"를 검색하면, When 실행하면, Then Remind me… 액션이 FollowupPicker를 연다.

## C. 해제 (답장 도착)

- [ ] **TC-C1** If pending followup이 있는 스레드에, When 답장이 도착하고(`__debugSimulateReply`) due 시점 틱이 돌면(`__debugTick`), Then followup이 조용히 삭제되고 재부상·toast가 없다.
- [ ] **TC-C2** If pending 스레드에 답장이 도착한 뒤, When 사용자가 그 스레드를 열면(fetch-thread), Then due 전이라도 followup이 기회적으로 해제된다(pending 배너 사라짐).
- [ ] **TC-C3** If 내가 같은 스레드에 추가 발신만 했을 때(답장 없음), When due 틱이 돌면, Then 답장으로 오판하지 않고 재부상한다.

## D. 재부상 (무답장)

- [ ] **TC-D1** If due가 지난 pending followup이 있고 답장이 없으면, When 틱이 돌면, Then 스레드가 UNREAD가 되고 fired 마커(칩)와 toast(`No reply yet…`)가 나타난다.
- [ ] **TC-D2** If send&archive로 INBOX에서 빠진 스레드가 fired되면, When 틱 후 INBOX를 보면, Then 스레드가 INBOX에 복귀해 있다.
- [ ] **TC-D3** If fired된 스레드가 있으면, When INBOX 리스트를 보면, Then date 순서와 무관하게 최상단에 핀 고정된다(모든 스플릿 탭에서 동일).
- [ ] **TC-D4** If fired 스레드가 핀된 상태에서, When j/k·Enter·archive를 쓰면, Then 선택·액션이 화면에 보이는 그 스레드에 정확히 적용된다(F1 재정박 불변식 유지).
- [ ] **TC-D5** If TRASH에 있는 스레드의 followup이 due되면, When 틱이 돌면, Then 재부상 없이 followup만 조용히 삭제된다.
- [ ] **TC-D6** If fired 스레드의 ThreadView 배너에서 Dismiss를 누르면, When 리스트로 돌아오면, Then 핀·칩이 사라진다.

## E. 영속화·위생

- [ ] **TC-E1** If pending/fired followup이 있는 상태에서, When 앱을 재시작하면, Then 배너·칩·핀 상태가 복원된다.
- [ ] **TC-E2** If 로그아웃하면, When followups를 보면, Then 정리되어 있다(다른 계정 stale thread_id 방지).

## F. 회귀

- [ ] **TC-F1** If F1 E2E 전체(run-tc.mjs)를 돌리면, When 완료되면, Then 기존 TC가 전부 그린(핀 로직이 스플릿·재정박을 깨지 않음).
- [ ] **TC-F2** If vitest를 돌리면, When 완료되면, Then 기존 13 + 핀 신규 케이스 전부 통과.
- [ ] **TC-F3** If 전체 typecheck를 돌리면, Then 에러 0.
