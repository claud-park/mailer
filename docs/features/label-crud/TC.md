# label-crud — TC (If-When-Then)

> E2E 프리픽스 `TC-LBL-*`.

## A. 생성

- **TC-LBL-A1 생성 UI 노출**: If 사이드바 "Labels" 헤더, When hover/기본 상태, Then `+` 버튼이 보임.
- **TC-LBL-A2 생성 성공**: If `+` 클릭 → 이름 입력("E2E-New-Label") → Enter, Then 사이드바 라벨 목록에 즉시 나타나고, 새로고침 후에도 유지.
- **TC-LBL-A3 생성한 라벨 스레드에 적용 가능**: If A2로 생성된 라벨, When 스레드에서 `l`(라벨 피커) 열어 선택, Then 스레드에 적용되고 칩 표시.
- **TC-LBL-A4 취소**: If 인라인 입력 중, When Esc, Then 입력이 닫히고 라벨은 생성되지 않음.
- **TC-LBL-A5 생성 실패 롤백**: If 실패 주입(`__debugFailNextModify`류 또는 전용 훅), When 생성 시도, Then 사이드바에 추가되지 않고 실패 토스트. — **SKIP (구현 중 발견한 divergence)**: `mail:create-label` IPC는 `__debugFailNextModify`가 감싸는 대상이 아니다(`maybeInjectDebugFailure`는 `mail:modify-labels`/`mail:snooze`/followup 3종 호출부에만 걸려 있음, `src/main/ipc.ts`), `MockGmailProvider.createLabel`도 자체적으로 절대 throw하지 않는다. `store.createLabel`은 실제 IPC 호출을 await한 뒤에야 로컬 상태를 건드리므로(낙관적 갱신 없음) 이 실패 경로 자체는 로직상 존재하나, 새 main-process 훅을 추가하지 않고는(이 작업 범위 밖) CDP로 트리거할 방법이 없다. E2E는 이 사유를 기록하고 SKIP.

## B. 삭제

- **TC-LBL-B1 삭제 아이콘 hover 노출**: If 임의 사용자 라벨 행, When hover, Then 삭제 아이콘이 보임(비-hover 시 안 보임).
- **TC-LBL-B2 확인 다이얼로그**: If 삭제 아이콘 클릭, Then 확인 다이얼로그가 뜨고 라벨은 아직 삭제되지 않음.
- **TC-LBL-B3 확정 삭제**: If 다이얼로그에서 확정, Then 사이드바에서 사라지고, 그 라벨이 붙어있던 스레드에서도 칩이 사라짐(새로고침 후에도 유지).
- **TC-LBL-B4 다이얼로그 취소**: If 다이얼로그에서 취소, Then 라벨이 그대로 남아있음.
- **TC-LBL-B5 보고 있던 라벨 삭제 시 Inbox 복귀**: If 어떤 라벨 뷰를 보고 있는 중, When 그 라벨을 삭제 확정, Then 뷰가 Inbox로 전환.

## C. 회귀

(원래 C1/C2로 명명 예정이었으나, 이 리포의 가장 최근 관례인 attachments TC.md의 "G. 회귀 게이트" 네이밍에 맞춰 G1/G2로 통일 — run-tc.mjs의 다른 모든 feature 회귀 게이트도 전부 `TC-<PREFIX>-G1/G2` 패턴.)

- **TC-LBL-G1**: If label-crud 전체가 배선된 상태면, When 기존 E2E 전건을 돌리면, Then 기존 캐논이 0 FAIL로 유지되고(신규 SKIP은 `TC-LBL-A5` 1건만 허용, 사유는 A절 참조) 총 어서션 = 기존 총계 + 신규(label-crud) 건수이다.
- **TC-LBL-G2**: `npx tsc --noEmit` + `npm test` exit 0.

> 실측(2026-07-16): E2E 전체 스위트 **250 PASS · 0 FAIL · 7 SKIP** (연속 2회 결정적으로 동일; SKIP 집합 = 캐논 5건 `{TC-A4, TC-D5, TC-D8, TC-SY-C3, TC-SY-B2}` + 신규 2건 `{TC-UNDO-B1, TC-LBL-A5}`), vitest 195/195, tsc clean.

## 구현 중 발견한 divergence
- **TC-LBL-B3의 "칩이 사라짐" 즉시성 검증은 스레드를 닫은 뒤 DOM으로 확인**: 리딩 페인이 열려 있는 동안 `ThreadList`가 전역적으로 "compact" 모드로 전환되어(`compact = !!activeThreadId`) 라벨 칩 자체가 렌더링되지 않는다 — A3에서 라벨을 적용하려면 스레드를 열어야 하므로, B1~B5 진입 전에 사이드바의 "Inbox" 항목(`store.setActiveLabel`, `activeThreadId`를 명시적으로 null로 리셋)을 클릭해 리딩 페인을 닫는다. (스플릿 탭바의 "Inbox" 탭 클릭 — `clickTab` 헬퍼 — 은 `store.switchTab`을 호출할 뿐이라 열린 스레드를 그대로 두므로 이 목적엔 쓸 수 없다.) 또한 즉시성 체크는 `fetchThread` ground-truth가 아니라 실제 DOM 텍스트로 검증한다 — `deleteLabel`의 IPC 핸들러는 캐시(cache.ts의 threads 테이블 `label_ids` 컬럼, `getCachedThreadDetail`이 이 값을 읽음)를 전혀 건드리지 않으므로(반면 `modifyLabels`는 낙관적 델타로 이 캐시 행을 동기적으로 패치한다), `fetchThread`를 통한 확인은 다음 리스트 레벨 SWR 리싱크 전까지 예측 불가능하게 stale하다(관찰됨: 3초 폴링으로도 수렴 안 함). 새로고침 후 재확인(`chipGoneAfterReload`)은 콜드 재초기화가 이 캐시를 다시 채우므로 ground-truth로도 안정적으로 확인된다.

## 유닛(vitest) 커버리지 맵
- Mock provider의 `createLabel`/`deleteLabel`(라벨 삭제 시 스레드 labelIds에서도 제거되는지) 순수 로직 테스트.
