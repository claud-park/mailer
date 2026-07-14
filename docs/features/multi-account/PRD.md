# multi-account — PRD

> 2026-07-14 · 사용자 요청: 2개 이상의 Gmail 계정 연동. 설계 산출물: `docs/superpowers/specs/2026-07-14-multi-account-design.md`(브레인스토밍 → 사용자 확정).

## 목적

ZenMail을 "프로세스당 계정 1개" 전제에서 벗어나 여러 Gmail 계정을 동시에 로그인 유지하고, 키보드로 즉시 전환하며, 보고 있지 않은 계정에서도 스누즈 복귀·예약전송·팔로우업이 정시에 발화되게 한다.

## 현재 구조의 단일 계정 전제

1. `auth.ts` — `account.json`에 활성 이메일 하나만 저장. `signIn()`이 포인터를 덮어써 두 번째 로그인 시 첫 계정 접근 불가.
2. `ipc.ts` — 모듈 전역 `provider`/`calendarProvider`/`calendarReady` 싱글턴. 모든 핸들러가 `requireProvider()`로 이 전역을 사용.
3. `cache.ts` — 단일 `zenmail.db` + 모듈 전역 `db`. 전 테이블에 계정 컬럼 없음. in-memory `localDeltaAt`도 전역.
4. `snooze.ts` — 60초 데몬이 단일 `getProvider` 콜백 대상. due 스캔이 전역 테이블 기준.
5. `shared/types.ts` — `AccountInfo`에 accountId 없음(email이 곧 단일 계정), 데이터 IPC·push 이벤트에 계정 파라미터 전무.

단, keytar `TokenStore`는 이미 email 키 기반이라 토큰 저장 계층은 무변경으로 다중 계정 수용 가능. `RealGmailProvider`도 인스턴스당 1계정 설계라 멀티 인스턴스화에 문제 없음.

## 사용자 확정 4건

1. **뷰 모델 = 계정 스위처**(통합 인박스 아님, Superhuman 방식) — 계정마다 완전히 분리된 인박스/리스트/검색 뷰.
2. **비활성 계정도 백그라운드 풀 동작** — 데몬(스누즈 복귀·예약전송·팔로우업) 발화 + 안읽음 배지 갱신이 활성 계정 여부와 무관하게 정시 수행.
3. **전환 UX = ⌃1~⌃9 단축키 + 사이드바 계정 섹션 + kbar** 3중 진입점.
4. **아키텍처 = A안: 계정별 DB 파일 분리**(단일 DB + account 컬럼 방식은 스키마 마이그레이션·WHERE 누락 리스크로 기각).

## 요구사항

### R1. 계정 모델 & 인증
- `accountId = email`(keytar 키 재사용, 별도 UUID 미도입).
- `account.json` → `accounts.json`(`{ accounts: [{ email, demo }], activeEmail }`). 레거시 `account.json` 존재 시 앱 시작 시 1회 자동 변환.
- `signIn()`은 계정을 추가(포인터 덮어쓰기 제거), `signOut(email)`은 해당 계정만 정리(토큰+accounts.json+계정 DB 파일). 마지막 계정 제거 시 로그인 화면.

### R2. 컨텍스트 격리
- 전역 싱글턴(provider/db/calendar 등) → `Map<email, AccountContext>`로 전환. 앱 시작 시 accounts.json의 전 계정에 컨텍스트 생성.
- 토큰 복원 실패 계정은 `needsReauth: true`로 표시하되 다른 계정은 정상 기동(부분 실패 격리).

### R3. 계정별 DB
- `openCache(email)`이 계정별 핸들 반환. DB 파일 `zenmail-<sanitized-email>.db`.
- 레거시 `zenmail.db`는 첫 계정 스코프 파일명으로 rename(스키마 변경 0건). rename 실패 시 원본 보존.
- 테마 등 앱 전역 설정은 계정 DB가 아닌 accounts.json 옆 전역 KV로 분리(마이그레이션 시 첫 계정 DB 값 승계).

### R4. 백그라운드 데몬
- 단일 60초 틱, 틱마다 전 AccountContext 순회 — 계정별 due 스누즈/예약전송/팔로우업/mutation 드레인. 한 계정 실패가 다른 계정 순회를 중단시키지 않음(계정별 try/catch).
- 틱에서 배경 계정 안읽음 수 갱신 → `accounts-changed` push로 배지 반영.

### R5. IPC 계약
- 모든 데이터 메서드에 `accountId: string` 파라미터 추가(옵셔널 금지, 타입으로 누락 강제).
- push 이벤트 페이로드에 `accountId` 포함 — renderer는 활성 계정 것만 리스트 반영, 비활성 계정 것은 배지만 갱신.
- 신규 메서드: `listAccounts()`, `addAccount()`, `removeAccount(email)`, `setActiveAccount(email)`.

### R6. Renderer/UI
- store `account` → `accounts: AccountInfo[]` + `activeAccountId`. 계정 전환 시 계정 종속 슬라이스 리셋 → 로컬 캐시 즉시 첫 페인트 → 백그라운드 refresh.
- 사이드바 상단 계정 섹션(아바타+배지+전환+추가), `⌃1`~`⌃9`(useKeyboard 소유), kbar 액션("Switch to <email>", "Add account", "Sign out of <email>").
- Compose는 항상 활성 계정에서 발신(From 선택 UI 없음, YAGNI). 단, 열린 시점의 accountId를 캡처해 전환 중에도 From이 바뀌지 않게 한다.

### R7. 데모 모드 & E2E 하네스
- `MockGmailProvider` 멀티 인스턴스화(email 파라미터화). 데모 모드는 `demo@zenmail.app` + `work@zenmail.app` 2계정으로 기동해 멀티계정 E2E의 하네스가 된다.
- 기본 활성 계정 = `demo@zenmail.app` 유지(기존 E2E 호환).

## 범위

### 포함
- 계정 스위처(계정별 완전 분리 뷰), 계정별 DB 파일, 비활성 계정 백그라운드 데몬 발화, 배지 갱신, 3중 전환 UX(사이드바/⌃숫자/kbar), needsReauth 부분 실패 격리, 레거시 단일 계정 자동 마이그레이션, 계정 제거 시 DB·토큰 정리.

### 제외 (논스코프)
- **통합 인박스** — 여러 계정을 한 리스트로 머지하는 뷰는 v1 대상 아님(필요 시 추후 read-only 머지 레이어로 확장).
- **Compose From 선택 UI** — 항상 열린 시점의 활성 계정에서만 발신(YAGNI).
- **비-Gmail 계정 지원** — Gmail(OAuth) 계정만 대상, 타 프로바이더 연동 없음.

## 성공 기준

- TC-MA 전건(A1~E1) PASS.
- 기존 스위트 캐논 무회귀(0 FAIL + SKIP ⊆ 캐논 집합) ×2연속.
- `npx tsc --noEmit` + `npm test`(vitest) clean.
