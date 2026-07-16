# label-crud — TC (If-When-Then)

> E2E 프리픽스 `TC-LBL-*`.

## A. 생성

- **TC-LBL-A1 생성 UI 노출**: If 사이드바 "Labels" 헤더, When hover/기본 상태, Then `+` 버튼이 보임.
- **TC-LBL-A2 생성 성공**: If `+` 클릭 → 이름 입력("E2E-New-Label") → Enter, Then 사이드바 라벨 목록에 즉시 나타나고, 새로고침 후에도 유지.
- **TC-LBL-A3 생성한 라벨 스레드에 적용 가능**: If A2로 생성된 라벨, When 스레드에서 `l`(라벨 피커) 열어 선택, Then 스레드에 적용되고 칩 표시.
- **TC-LBL-A4 취소**: If 인라인 입력 중, When Esc, Then 입력이 닫히고 라벨은 생성되지 않음.
- **TC-LBL-A5 생성 실패 롤백**: If 실패 주입(`__debugFailNextModify`류 또는 전용 훅), When 생성 시도, Then 사이드바에 추가되지 않고 실패 토스트.

## B. 삭제

- **TC-LBL-B1 삭제 아이콘 hover 노출**: If 임의 사용자 라벨 행, When hover, Then 삭제 아이콘이 보임(비-hover 시 안 보임).
- **TC-LBL-B2 확인 다이얼로그**: If 삭제 아이콘 클릭, Then 확인 다이얼로그가 뜨고 라벨은 아직 삭제되지 않음.
- **TC-LBL-B3 확정 삭제**: If 다이얼로그에서 확정, Then 사이드바에서 사라지고, 그 라벨이 붙어있던 스레드에서도 칩이 사라짐(새로고침 후에도 유지).
- **TC-LBL-B4 다이얼로그 취소**: If 다이얼로그에서 취소, Then 라벨이 그대로 남아있음.
- **TC-LBL-B5 보고 있던 라벨 삭제 시 Inbox 복귀**: If 어떤 라벨 뷰를 보고 있는 중, When 그 라벨을 삭제 확정, Then 뷰가 Inbox로 전환.

## C. 회귀

- **TC-LBL-C1**: `npx tsc --noEmit` + `npm test` exit 0.
- **TC-LBL-C2**: 전체 스위트 무회귀(0 FAIL + SKIP ⊆ 캐논 집합) ×2.

## 유닛(vitest) 커버리지 맵
- Mock provider의 `createLabel`/`deleteLabel`(라벨 삭제 시 스레드 labelIds에서도 제거되는지) 순수 로직 테스트.
