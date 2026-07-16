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

- **TC-UNDO-C1**: 실패 주입(`__debugFailNextModify`) 상태에서 아카이브 시도 → 기존 실패-롤백 토스트("Archive failed — restored")가 그대로 뜨고 Undo 버튼은 없음(성공한 적이 없으므로 undo 대상이 아님) — 기존 TC-SP-C1류 회귀 없음.
- **TC-UNDO-C2**: `npx tsc --noEmit` + `npm test` exit 0.
- **TC-UNDO-C3**: 전체 스위트 무회귀(0 FAIL + SKIP ⊆ 캐논 집합) ×2.

## 유닛(vitest) 커버리지 맵
- store의 undo 콜백 생성 로직이 순수 함수로 뽑히는 부분(캡처 스냅샷 구조 등)이 있다면 단위화 — DOM/IPC 의존이 짙은 부분은 E2E가 주 검증(기존 archiveThread/toggleStar 관례와 동일).
