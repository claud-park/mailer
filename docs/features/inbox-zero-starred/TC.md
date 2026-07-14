# inbox-zero-starred — TC (If-When-Then)

> E2E 프리픽스 `TC-IZ-*` (e2e/run-tc.mjs). 데모 시드 규칙: 신규 스레드 date는 기존 최고령보다 뒤(120h+), 어떤 split 규칙에도 안 걸리는 발신자(F5 관례).

## A. 외부 아카이브 수렴 (버그 수정 본체)
- **TC-IZ-A1 외부 아카이브 1건 수렴**: If 인박스에 스레드 N개가 로드됨(웜캐시), When 그중 1개를 `__debugExternalArchive`(provider만 INBOX 제거, 캐시·modifyLabels 우회 = "Gmail 웹에서 아카이브" 재현) 후 refresh 1회, Then revalidate 후 리스트에서 사라지고 재로드(cold read)에도 부재.
- **TC-IZ-A2 전량 수렴(inbox zero)**: If 인박스 전 스레드가 외부 아카이브됨, When refresh, Then 리스트가 비고 inbox-zero empty state 도달, 재진입에도 유지(84행 자가치유의 축소 재현).
- **TC-IZ-A3 낙관 아카이브 비부활**: If 스레드를 앱 내에서 `e` 아카이브 직후, When 같은 tick의 revalidate가 도착, Then 부활 없음(가드: pending/로컬-델타 15s).
- **TC-IZ-A4 pending 뮤테이션 보호**: If 오프라인에서 아카이브(큐 대기), When revalidate(스테일 fresh가 그 스레드를 INBOX로 반환), Then 캐시·리스트 모두 낙관 상태 유지(upsert/removal/캐시쓰기 3중 스킵).

## B. Starred 시맨틱
- **TC-IZ-B1 starred-archived 표시**: If 시드에 `[STARRED]`(archived) 스레드 존재, When 인박스 로드, Then 리스트에 보이고 ★ 인디케이터 렌더.
- **TC-IZ-B2 archive-keeps-starred**: If `[INBOX,STARRED]` 스레드, When `e`, Then 행이 인박스에 잔존(★ 유지, INBOX 라벨만 소실), 비-starred 행은 `e`로 사라짐.
- **TC-IZ-B3 unstar-removes-archived**: If B2 상태(라벨=[STARRED]), When `s`(unstar), Then 리스트에서 즉시 사라지고 재로드에도 부재.
- **TC-IZ-B4 star 토글 왕복**: If `[INBOX]` 스레드, When `s` → `s`, Then ★ 표시 → 해제, 행은 INBOX라 계속 잔류.
- **TC-IZ-B5 trash-starred 배제**: If `[INBOX,STARRED]` 스레드, When `#`(trash), Then starred여도 인박스에서 사라짐.
- **TC-IZ-B6 snoozed-starred 숨김**: If `[INBOX,STARRED]` 스레드, When `b` snooze, Then 인박스에서 사라지고 refresh/tick 후에도 재출현 없음(D6 3중 배제).
- **TC-IZ-B7 split 탭 반영**: If starred-archived 스레드가 split 규칙에 매칭, When split inbox on, Then 해당 탭에 표시·카운트 포함(INBOX_TAB에도 포함).

## C. 회귀 게이트
- **TC-IZ-G1**: `npx tsc --noEmit` exit 0. **TC-IZ-G2**: `npm test`(vitest) exit 0. **TC-IZ-G3**: 기존 전 TC 무회귀(0 FAIL + SKIP ⊆ 캐논 집합 + 총 어서션 정합, D10 판정 기준).

## 유닛(vitest) 커버리지 맵
- `view.test.ts`: isInInboxView/inLabelView/viewMembershipLabels 진리표(INBOX·STARRED·TRASH·SPAM·snoozeId·빈 배열).
- `cache.test.ts` 확장: getThreads('INBOX')가 STARRED-only 포함, TRASH/SPAM/snoozes 배제, 타 라벨 뷰 불변; getViewRows 열거; applyLabelDelta strip 후 뷰 탈락; 로컬-델타 타임스탬프 기록(origin 구분).
- revalidate diff 순수 함수(`computeRevalidateDiff`): 빈 fresh(complete)→전량 removal, nextPageToken 있음→창 밖 보류, 가드 id 3중 스킵, upsert JSON-diff 기존 동작 보존.
- `optimistic/store` 확장: archiveThread starred 분기(유지+INBOX만 소실, capture 없음)와 실패 롤백(INBOX 재부여), toggleStar 낙관/롤백/뷰 탈락 제거.
- `splits.test.ts` 확장: starred-archived가 INBOX_TAB·매칭 탭에 포함.
