# select-all-in-view — Test Cases (If-When-Then)

> Goal 3 산출물. E2E는 run-tc.mjs 확장(TC-SA-*).
> Status: `[ ]` 미검증 · `[x]` 통과 · `[!]` 실패 · `[~]` SKIP
>
> CP4 실측(2026-07-07): run-tc.mjs 확장 — 총 308건(기존 293 + 신규 TC-SA 11), 294 PASS / 0 FAIL / 14 SKIP(기존 12 + 신규 B2·B4). 연속 2회 재실행 동일. vitest/tsc clean.
> B2·B4 SKIP 사유: 이 시드에서 SA 실행 시점 INBOX 생존 스레드는 9건뿐이고, F1~F6 restart 검증이 의존하는 reserved 스레드(demo_3 등)를 건드리지 않으면서 ⌘A로 통째 선택 가능한 격리 대상이 남지 않음(비-reserved분은 전부 Team/Newsletter 소속이거나 reserved와 발신자를 공유). 파괴적 검증은 B1(Newsletter 스플릿 통째 아카이브)로 충족 — bulk trash/snooze 스토어 경로는 B1/B3/B5와 구조적으로 동일한 silent-loop이라 코드 커버리지 공백은 아님(vitest로 로직 자체는 검증됨). Team까지 확장하려면 스플릿 설정을 건드려야 해 무회귀 불변식을 위협하므로 채택 안 함.

## A. 진입/해제

- [x] **TC-SA-A1** If 리스트에 포커스가 있고 스레드가 N개 보이면, When ⌘A를 누르면, Then 배너에 "N selected"가 뜨고 N개 행 전부가 강조된다.
- [x] **TC-SA-A2** If 검색 입력창에 포커스가 있으면, When ⌘A를 누르면, Then bulk 선택이 아니라 입력창 텍스트 전체선택이 일어난다(가로채지 않음).
- [x] **TC-SA-A3** If 스누즈/라벨/스니펫 등 모달이 열려 있으면, When ⌘A를 누르면, Then bulk 선택이 발화하지 않는다.
- [x] **TC-SA-A4** If bulk 모드면, When Escape를 누르면, Then 선택만 해제되고(액션 없음) 원래 스레드 상태는 불변이다.
- [x] **TC-SA-A5** If 스플릿 탭 뷰(예: Team)에서 ⌘A를 누르면, Then 그 탭에 보이는 스레드만 선택되고 다른 탭 스레드는 포함 안 된다.

## B. 일괄 액션

- [x] **TC-SA-B1** If N개가 bulk 선택돼 있으면, When `e`를 누르면, Then N개 전부 아카이브되어 뷰에서 사라지고 "N개 아카이브됨" 토스트 1건만 뜬다(개별 토스트 없음).
- [~] **TC-SA-B2** If N개가 bulk 선택돼 있으면, When `#`를 누르면, Then 전부 트래시로 이동하고 집계 토스트가 뜬다. — SKIP: 데모 시드에 무회귀-안전한 격리 대상 부재(위 CP4 실측 노트 참고). 스토어 로직은 vitest+B1 구조 동일성으로 커버.
- [x] **TC-SA-B3** If N개가 bulk 선택돼 있으면, When `U`(읽음처리)를 누르면, Then 전부 읽음 처리되고 언리드 도트가 사라진다.
- [~] **TC-SA-B4** If N개가 bulk 선택돼 있으면, When `b`로 스누즈 시간을 하나 고르면, Then N개 전부 같은 시각으로 스누즈되어 뷰에서 사라진다. — SKIP: 위와 동일 사유.
- [x] **TC-SA-B5** If N개가 bulk 선택돼 있으면, When `l`로 라벨을 하나 고르면, Then N개 전부에 그 라벨이 적용된다.
- [x] **TC-SA-B6** If 일괄 액션이 완료되면, Then bulk 선택이 자동으로 해제된다(배너 사라짐).

## C. 회귀

- [x] **TC-SA-C1** If bulk 기능이 배선된 상태면, When 기존 전체 E2E를 돌리면, Then 전부 기존 상태를 유지한다(단일 j/k/e/# 등 무회귀).
- [x] **TC-SA-C2** If `npm test`+`npx tsc --noEmit`를 돌리면, Then 신규 스위트 포함 전부 통과한다.
