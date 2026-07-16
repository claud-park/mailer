# undo-toast — TC (If-When-Then)

> E2E 프리픽스 `TC-UNDO-*`.

## A. 단건 Undo

- **TC-UNDO-A1 archive undo**: If 스레드를 `e`로 아카이브(토스트 "Archived" + Undo 버튼), When 5초 내 Undo 클릭, Then 스레드가 다시 Inbox에 나타나고 라벨에 INBOX 포함, 새로고침 후에도 유지.
- **TC-UNDO-A2 trash undo**: If 스레드를 `#`로 트래시, When Undo 클릭, Then 스레드가 Inbox로 복원(TRASH 제거·INBOX 재부여), 새로고침 후에도 유지.
- **TC-UNDO-A3 label-apply undo**: If 스레드에 라벨 적용(`l`), When Undo 클릭, Then 그 라벨만 제거되고 스레드의 다른 라벨은 무변경.
- **TC-UNDO-A4 snooze undo**: If 스레드를 스누즈(`b`), When Undo 클릭, Then 스누즈가 취소되고 스레드가 즉시 Inbox에 재등장(스누즈 데몬 tick을 기다리지 않고), 원래 라벨 복원.
- **TC-UNDO-A5 만료 후 영구 확정**: If 스레드를 아카이브, When 5초 초과 후 확인, Then Undo 버튼이 사라져 있고 스레드는 계속 아카이브 상태(복원 안 됨).

## B. 벌크 Undo

- **TC-UNDO-B1 벌크 archive undo**: If ⌘A로 여러 스레드 선택 후 아카이브(집계 토스트 "N개 아카이브됨"), When Undo 클릭, Then 전건이 Inbox로 복원.

## C. 회귀

- **TC-UNDO-C1**: 실패 주입(`__debugFailNextModify`) 상태에서 아카이브 시도 → 기존 실패-롤백 토스트("Archive failed — restored")가 그대로 뜨고 Undo 버튼은 없음(성공한 적이 없으므로 undo 대상이 아님) — 기존 TC-SP-C1류 회귀 없음. E2E 전용 신규 시나리오로 구현.
- **TC-UNDO-G1/G2**(원래 C2/C3로 명명 예정이었으나, 이 리포의 가장 최근 관례인 attachments TC.md의 "G. 회귀 게이트" 네이밍에 맞춰 G1/G2로 통일 — run-tc.mjs의 다른 모든 feature 회귀 게이트도 전부 `TC-<PREFIX>-G1/G2` 패턴): **G1** If undo-toast 전체가 배선된 상태면, When 기존 E2E 전건을 돌리면, Then 기존 캐논이 0 FAIL로 유지되고(신규 SKIP은 `TC-UNDO-B1` 1건만 허용, 사유는 B절 참조) 총 어서션 = 기존 총계 + 신규(undo-toast) 건수이다. **G2** `npm test`+`npx tsc --noEmit` 둘 다 exit 0.

> 실측(2026-07-16): E2E 전체 스위트 **250 PASS · 0 FAIL · 7 SKIP** (연속 2회 결정적으로 동일; SKIP 집합 = 캐논 5건 `{TC-A4, TC-D5, TC-D8, TC-SY-C3, TC-SY-B2}` + 신규 2건 `{TC-UNDO-B1, TC-LBL-A5}` — 각 SKIP 사유는 아래 참조), vitest 195/195, tsc clean.

## 구현 중 발견한 divergence
- **TC-UNDO-B1이 간헐적으로 SKIP**: 이 스위트는 매우 긴 단일 세션(F1~F6·CAL·ATT·FUP·KM·SP·DD·SY·SA 등 수십 개 시나리오)의 맨 뒤쪽에서 undo-toast를 실행한다. select-all-in-view 등 앞선 시나리오들이 이미 "예약되지 않은(non-reserved)" 발신자 스레드 상당수를 실제로 소진(영구 트래시/스누즈)해 놓아서, 벌크 undo 테스트가 격리용 throwaway split을 만들 "예약 안 된" 발신자를 못 찾는 경우가 생긴다. 실제로 이렇게 SKIP되는 것을 관찰함 — TC-SA-B2/B4도 동일한 이유로 이미 SKIP 폴백을 갖고 있어 이 스위트의 기존 관례와 일치한다.
- **TC-UNDO-A1~A5는 동일 스레드 하나를 재사용**: 최초 구현은 A1~A5마다 서로 다른 "예약 안 된" 행을 새로 골랐으나(5개 필요), 위와 같은 이유로 이 늦은 시점엔 예약-제외 후보가 5개는커녕 0개인 경우까지 관찰되어 A4가 실패했다. A1~A4는 각자 Undo로 완전히 원상복구되므로(A5만 고의로 미복구) 스레드 하나만 재사용하도록 재설계 — 전체 시나리오가 "예약 안 된 행 1개"만 있으면 충분해졌다.
- **TC-UNDO-A3의 "다른 라벨 무변경" 검증은 row DOM 텍스트가 아니라 `fetchThread` ground-truth labelIds로 검증**: 리딩 페인이 열려 있는 동안 `ThreadList`가 전역적으로 "compact" 모드로 전환되어(`compact = !!activeThreadId`, 스레드 하나만 열려도 리스트 전체 행이 칩을 전혀 렌더링하지 않음) 라벨 칩 자체가 DOM에 없다 — `l` 피커가 열려 있는(=스레드가 열려 있는) 스레드에 적용하는 이 테스트의 특성상 불가피.
