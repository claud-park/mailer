# multi-account — DECISIONS

> 2026-07-14. 초기 결정 기록(Goal 1~4 산출물). 설계 근거의 상세는 `docs/superpowers/specs/2026-07-14-multi-account-design.md` 참조.

## D1. accountId = email
keytar 키를 재사용한다(별도 UUID 미도입). `accounts.json`·`AccountContext` Map·계정별 DB 파일명 등 모든 계정 식별에 email 문자열을 그대로 사용한다.

## D2. 계정별 DB 파일
단일 DB + account 컬럼 방식을 기각하고 계정마다 별도 DB 파일을 둔다 — 스키마 마이그레이션 0건, WHERE 절 누락으로 인한 계정 간 데이터 오염을 원천 차단한다. 통합 인박스는 v1 범위 밖이며, 필요해지면 read-only 머지 레이어로 별도 확장한다(각 계정 DB는 그대로 두고 조회 시점에만 머지).

## D3. 데모 계정 비영속
데모 계정은 재시작 시 영속되지 않는다(재시작하면 로그인 화면으로 복귀) — 기존 E2E 부트 시퀀스를 보존하기 위함이다.

## D4. needsReauth 복구 = addAccount 재사용
`needsReauth` 상태의 계정을 복구하는 전용 reauth 메서드는 두지 않는다. `signOut` → `signIn`(addAccount) 재사용 패턴을 그대로 쓴다 — calendar 연동 feature의 D7 선례(전용 메서드 대신 기존 signOut→signIn 조합 재사용)를 따른다.

## D5. Compose는 열린 시점의 accountId를 캡처
Compose 창은 열릴 때의 활성 계정 accountId를 캡처해 그 계정으로 발신한다 — 작성 중 사용자가 다른 계정으로 전환해도 From이 바뀌지 않도록 방지한다.

## D6. debug hook은 main의 activeEmail 컨텍스트 대상
`__debugTick`·`__debugSimulateReply` 등 기존 E2E debug hook들은 main 프로세스의 activeEmail 컨텍스트를 대상으로 동작한다 — 기존 하네스 시그니처를 보존한다.

## D7. 배지는 데몬 틱 주기(60s) 갱신
계정 배지(안읽음 수)는 실시간이 아니라 60초 데몬 틱마다 갱신한다 — 실계정에서 API 비용이 계정당 분당 1콜로 억제된다.

## D8. 사이드바 Sign out = 세션 종료 버튼
사이드바 Sign out = 세션 종료 버튼 — demo는 데모 세션 전체(2계정) 종료, real은 활성 계정만 제거(레거시 단일 계정 signOut의 파괴적 시맨틱 승계 — keytar 토큰+계정 DB 삭제). per-account 제거는 kbar "Sign out of <email>". 근거: 데모 2계정 상주로 "활성만 제거"는 로그인 화면에 도달 못해 기존 E2E 시맨틱과 충돌(Task 5 발견) → 최종 리뷰에서 real 계정까지 전체 파괴하는 중간 구현을 계정 단위로 교정.

## D9. E2E 하네스 최소 수정 8곳
E2E 하네스 최소 수정 8곳 — 구 단일 계정 API 직접 호출부(getAccount 등)에 활성 accountId 주입만(시나리오 시맨틱 무변경). 하네스 무수정 원칙의 허용된 예외.
