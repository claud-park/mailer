# starred-view — TC (If-When-Then)

> E2E 프리픽스 `TC-STAR-*`(신규, e2e/run-tc.mjs) + 기존 `TC-IZ-*`(9건) 재작성. 데모 시드 규칙: 신규 스레드 date는 기존 최고령보다 뒤(120h+), 어떤 split 규칙에도 안 걸리는 발신자(기존 관례).

## A. TC-IZ-* 재작성 매핑 (Inbox = 순수 INBOX로 복귀)

기존 9건 중 외부 수렴(A1~A4)은 STARRED 유니온과 무관한 일반 메커니즘이라 **무변경**. Starred 시맨틱군(B1~B3, B7)은 이제 잘못된 어서션이라 재작성, 순수 INBOX 배제 관련(B4~B6)은 어서션 유지(우연히도 순수 INBOX에서도 여전히 참).

- **TC-IZ-A1~A4**: 무변경(외부 아카이브 수렴·낙관 비부활·pending 보호 — INBOX 라벨 자체의 removal 메커니즘, STARRED 무관).
- **TC-IZ-B1 (재작성)** archived-starred는 Inbox에 없음: If 시드에 라벨=`[STARRED]`(INBOX 없음) 스레드 존재, When Inbox 로드, Then 목록에 **없음**(과거엔 "보이고 ★ 렌더"였으나 R1으로 역전).
- **TC-IZ-B2 (재작성)** archive는 Inbox에서 무조건 제거: If `[INBOX,STARRED]` 스레드, When `e`, Then Inbox 목록에서 **사라짐**(과거엔 "잔존"이었으나 R1으로 역전 — 대신 TC-STAR-B2가 Starred 쪽 잔존을 검증).
- **TC-IZ-B3 (폐기 → TC-STAR-B3로 이관)**: "unstar-removes-archived"는 애초에 archived-starred가 Inbox에 없으므로(B1) 무의미 — Starred 뷰의 동등 시나리오로 이동.
- **TC-IZ-B4 (유지)** star 토글 왕복: If `[INBOX]` 스레드, When `s`→`s`, Then ★ 표시→해제, 행은 INBOX라 계속 잔류(불변).
- **TC-IZ-B5 (유지)** trash-starred 배제: If `[INBOX,STARRED]`, When `#`(trash), Then starred여도 Inbox에서 사라짐(불변 — TRASH 배제는 R1에서도 그대로).
- **TC-IZ-B6 (유지)** snoozed-starred 숨김: If `[INBOX,STARRED]`, When `b` snooze, Then Inbox에서 사라지고 재출현 없음(불변 — snooze가 INBOX 라벨 자체를 제거하므로 순수 INBOX 술어에서도 자동 성립).
- **TC-IZ-B7 (재작성)** split 탭도 archived-starred 미노출: If archived-starred 스레드가 어느 split 규칙에 매칭, When split inbox on, Then **어느 탭에도 없음**(Inbox 자체가 그 스레드를 안 실어오므로 — 과거엔 "포함"이었으나 역전).
- **TC-IZ-C1~C3(회귀 게이트)**: 무변경, 프리픽스만 유지.

## B. Starred 뷰 (신규)

- **TC-STAR-B1 내비게이션+배지**: If 시드에 STARRED 스레드 N건(INBOX+STARRED 일부·archived+STARRED 일부 혼합), When 사이드바 "Starred" 클릭, Then 목록에 N건 전부 표시되고 사이드바 배지 수가 그 안의 unread 수와 일치.
- **TC-STAR-B2 archive-유지**: If Starred 뷰에서 `[INBOX,STARRED]` 스레드를 `e`, Then 행이 Starred 뷰에 **잔존**(★ 유지, INBOX만 소실) — 이어서 Inbox 뷰로 전환하면 그 스레드는 없음(TC-IZ-B2와 대칭 확인).
- **TC-STAR-B3 unstar-제거**: If Starred 뷰에서 스레드를 `s`(unstar), Then 리스트에서 즉시 사라지고 재로드에도 부재(舊 TC-IZ-B3 이관).
- **TC-STAR-B4 archived-only 표시**: If 라벨=`[STARRED]`(INBOX 없음) 스레드, When Starred 로드, Then 보임 — 동시에 Inbox 로드시 부재 확인(TC-IZ-B1과 상호 배타 확인).
- **TC-STAR-B5 trash/spam 배제**: If `[STARRED,TRASH]` 또는 `[STARRED,SPAM]`, When Starred 로드, Then 안 보임.
- **TC-STAR-B6 snoozed 배제**: If `[STARRED]` 스레드를 스누즈, When Starred 로드, Then 안 보이고, 스누즈 데몬 틱으로 깨어나면 재출현.
- **TC-STAR-C1 외부 unstar 수렴**: If 스레드가 STARRED로 로드됨(웜캐시), When `__debugExternalUnstar`(provider만 STARRED 라벨 제거, 캐시·modifyLabels 우회 — "Gmail 웹에서 별표 해제" 재현) 후 refresh, Then Starred 목록에서 사라지고 cold read에도 부재.
- **TC-STAR-D1 단축키**: If 아무 뷰에서, When `g` `t` 순차 입력, Then activeLabelId가 STARRED로 전환되고 목록이 Starred 뷰로 전환.
- **TC-STAR-D2 flat list**: If Starred 뷰 활성(splitInbox on이어도), When 확인, Then SplitTabBar 미노출.

## C. 회귀 게이트

- **TC-STAR-G1**: `npx tsc --noEmit` exit 0.
- **TC-STAR-G2**: `npm test`(vitest) exit 0.
- **TC-STAR-G3**: 전체 스위트 무회귀 — 0 FAIL + SKIP ⊆ 캐논 집합 + 총 어서션 수 정합, ×2 연속 결정적.

## 유닛(vitest) 커버리지 맵

- `view.test.ts`: `isInInboxView`가 STARRED 유니온 없이 순수 INBOX 진리표로 축소됐는지(회귀 확인 — 과거 "STARRED만 있어도 true"였던 케이스가 이제 false), 신규 `isInStarredView` 진리표(STARRED·TRASH·SPAM·snoozeId·빈 배열 조합), `inLabelView`의 두 분기, `viewMembershipLabels('INBOX')===['INBOX']`/`('STARRED')===['STARRED']`(유니온 제거로 배열 길이 1로 축소).
- `cache.test.ts` 확장: `getThreads('STARRED')`/`getViewRows('STARRED')` SQL 프리필터가 JS 필터(`isInStarredView`)와 일치, TRASH/SPAM/snoozes 배제. `getThreads('INBOX')`가 이제 STARRED-only 행을 **배제**하는지(기존 "포함" 테스트를 뒤집는 회귀 케이스로 명시).
- `gmail.test.ts`(신규 또는 attachments.test.ts류 확장): `RealGmailProvider`의 STARRED q 번역(`is:starred -in:trash -in:spam -label:zenmail/snoozed`), `MockGmailProvider`의 STARRED 필터 분기 + 시드 라벨(`{id:'STARRED', type:'system'}`) 존재.
- store 순수 로직: `archiveThread`/`toggleStar`의 게이트 조건표(PRD R3 4칸 매트릭스)를 그대로 유닛화 — Inbox/Starred × archive/unstar 조합.
- `splits.test.ts`: 무변경(순수 함수 자체는 STARRED 무관 — 상위에서 넘기는 `threads`가 이제 Starred를 안 포함한다는 사실은 E2E(TC-IZ-B7 재작성)에서 커버).
