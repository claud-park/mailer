# new-mail-alerts — TC (If-When-Then)

> E2E 프리픽스 `TC-ALT-*`(신규, e2e/run-tc.mjs). 디버그 훅 `mail:debug-inject-new-mail`(accountId, {from?, subject?}) → 기존 `mail:debug-tick`(`runDaemonTickNow`)으로 데몬 틱 강제 실행, 이후 배지/알림 관측.

## A. 배지

- **TC-ALT-A1 전체 계정 합산**: If 계정 2개(활성 X, 비활성 Y) 각각 unread 3/2건, When 앱 로드(로그인 직후), Then dock 배지 = 5(60s 데몬 틱을 기다리지 않고 즉시).
- **TC-ALT-A2 배지 즉시 증가**: If 배지가 N, When 비활성 계정에 신규 unread 1건 주입 + 데몬 틱, Then 배지 = N+1(포커스 여부 무관).
- **TC-ALT-A3 배지 감소**: If 배지가 N, When 스레드를 읽음 처리, Then 다음 틱에 배지가 실제 unread 수만큼 감소(알림은 없음 — B3와 연결).

## B. 새 메일 판정 및 알림 발화

- **TC-ALT-B1 단건 개별 알림**: If 계정 X에 신규 unread 스레드 정확히 1건 주입, When 데몬 틱(`mail:debug-tick`), Then 알림 1개 발화, 제목/본문에 해당 발신자·제목 노출.
- **TC-ALT-B2 그룹 알림**: If 같은 틱에 계정 X·Y 합쳐 신규 unread 2건 이상 주입, When 데몬 틱, Then 알림 **1개**(그룹, "OO 외 N건" 형태) — 계정별로 나뉘어 여러 개 뜨지 않음.
- **TC-ALT-B3 unread 비증가는 알림 없음**: If 스레드 읽음 처리/보관/라벨 변경(unread 순증 없음), When 데몬 틱, Then 알림 0건(배지만 갱신 또는 불변).
- **TC-ALT-B4 순감소만은 알림 없음**: If 이번 틱에 unread count가 순감소, When 데몬 틱, Then 알림 0건.

## C. 콜드스타트

- **TC-ALT-C1 로그인 직후 알림 폭발 없음**: If 계정에 기존 unread 다수(예: 10건), When 앱 최초 로드(로그인/데모 진입), Then 알림 0건, 배지는 즉시 10으로 정확히 표시.
- **TC-ALT-C2 baseline 이후 정상 감지**: If C1 직후 상태에서 신규 unread 1건 추가 주입, When 데몬 틱, Then 알림 1건 정상 발화(baseline 시딩 이후로는 정상 동작 확인).

## D. 포커스 억제

- **TC-ALT-D1 포커스 중 억제**: If ZenMail 창이 포커스 상태, When 신규 unread 주입 + 데몬 틱, Then 알림 0건이지만 배지는 갱신됨.
- **TC-ALT-D2 비포커스 정상 발화**: If 창이 비포커스(백그라운드), When 동일 상황, Then 알림 정상 발화.

## E. 클릭 동작

- **TC-ALT-E1 개별 클릭 — 같은 계정**: If 활성 계정에 신규 1건 → 알림 발화, When 알림 클릭, Then 앱 포커스 + 해당 스레드가 바로 열림(계정 전환 없음, 이미 활성 계정이므로).
- **TC-ALT-E2 개별 클릭 — 다른 계정**: If 비활성 계정에 신규 1건 → 알림 발화, When 알림 클릭, Then 해당 계정으로 자동 전환된 뒤 그 스레드가 열림.
- **TC-ALT-E3 그룹 클릭**: If 여러 계정에 걸쳐 신규 2건+ → 그룹 알림 발화, When 클릭, Then **활성 계정**의 Inbox로 이동(계정 자동전환 없음 — 신규분이 비활성 계정 것이어도 전환 안 함).

## F. 회귀 게이트

- **TC-ALT-G1**: `npx tsc --noEmit` exit 0.
- **TC-ALT-G2**: `npm test`(vitest) exit 0.
- **TC-ALT-G3**: 전체 스위트 무회귀 — 0 FAIL + SKIP ⊆ 캐논 집합 + 총 어서션 수 정합, ×2 연속 결정적.

## 유닛(vitest) 커버리지 맵

- `notify.test.ts`(신규): `diffNewUnread` 순수 함수 3케이스 — ① 최초 관측(`lastKnownIds===undefined`) → `newThreads=[]`이지만 `nextIds`는 현재 전체 집합, ② 증분(일부 ID 추가) → 추가분만 `newThreads`, ③ 무변화/감소(추가 ID 없음) → `newThreads=[]`.
- `notify.test.ts`: 그룹핑 임계값(1건=개별 포맷, 2건=그룹 포맷) 순수 로직 단위 테스트.
- 기존 `snooze.ts`/`ipc.ts` 관련 vitest(있다면)는 배지 루프 확장이 기존 `unreadCount` 갱신 동작을 안 깨는지 회귀 확인.
