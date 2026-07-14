# ZenMail — Multi-Account Gmail 지원 (Design Spec)

> 2026-07-14 · 브레인스토밍 산출물. 사용자 요청: 2개 이상의 Gmail 계정 연동.
> 사용자 확정 4건: ① 뷰 모델 = **계정 스위처**(통합 인박스 아님, Superhuman 방식), ② 비활성 계정도 **백그라운드 풀 동작**(데몬 발화 + 안읽음 배지), ③ 전환 UX = **⌃1~⌃9 단축키 + 사이드바 계정 섹션 + kbar**, ④ 아키텍처 = **A안: 계정별 DB 파일 분리**(단일 DB+account 컬럼 방식 기각).
> feature slug: `multi-account` (DEV_WORKFLOW Goal 0~8 대상).

## 목적

ZenMail을 "프로세스당 계정 1개" 전제에서 벗어나 여러 Gmail 계정을 동시에 로그인 유지하고, 키보드로 즉시 전환하며, 보고 있지 않은 계정에서도 스누즈 복귀·예약전송·팔로우업이 정시에 발화되게 한다. v1은 통합 받은편지함 없이 계정별 완전 분리 뷰만 제공한다(필요 시 추후 read-only 머지 레이어로 확장).

## 현재 구조의 단일 계정 전제 (5중)

1. `auth.ts` — `account.json`에 활성 이메일 하나만 저장. `signIn()`이 포인터를 덮어써 두 번째 로그인 시 첫 계정 접근 불가. `signOut()`은 keytar 토큰을 삭제.
2. `ipc.ts:30-33` — 모듈 전역 `provider`/`calendarProvider`/`calendarReady` 싱글턴. 모든 핸들러가 `requireProvider()`로 이 전역을 사용.
3. `cache.ts` — 단일 `zenmail.db` + 모듈 전역 `db`. 전 테이블(threads/messages/snoozes/scheduled_sends/contacts/threads_fts/splits/settings/followups/mutations)에 계정 컬럼 없음. in-memory `localDeltaAt`도 전역.
4. `snooze.ts` — 60초 데몬이 단일 `getProvider` 콜백 대상. due 스캔이 전역 테이블 기준.
5. `shared/types.ts` — `AccountInfo`에 accountId 없음(email이 곧 단일 계정), 데이터 IPC·push 이벤트에 계정 파라미터 전무.

단, keytar `TokenStore`는 이미 email 키 기반(`findCredentials`로 `list()` 가능)이라 토큰 저장 계층은 무변경으로 다중 계정 수용 가능. `RealGmailProvider`도 인스턴스당 1계정 설계라 멀티 인스턴스화에 문제 없음.

## 설계

### 계정 모델 & 인증 (auth.ts)

- **accountId = email** (keytar 계정 키와 동일 — 별도 UUID 도입하지 않음).
- `account.json` → **`accounts.json`** `{ accounts: [{ email, demo }], activeEmail }`. 앱 시작 시 레거시 `account.json` 존재하면 1회 자동 변환.
- `signIn()`: 계정 **추가**(포인터 덮어쓰기 제거). 이미 있는 email로 재로그인하면 토큰 갱신(재인증 플로우).
- `signOut(email)`: **해당 계정만** keytar 토큰 삭제 + accounts.json에서 제거 + 계정 DB 파일 삭제. 마지막 계정 제거 시 로그인 화면으로.
- `getAuthorizedClient(email)`: 특정 계정의 OAuth 클라이언트 반환(현행 무인자 버전 대체).

### AccountContext Map (ipc.ts)

- 전역 싱글턴 → `Map<email, AccountContext>`, `AccountContext = { provider, db, calendarProvider, calendarReady, localDeltaAt }`.
- 앱 시작 시 accounts.json의 전 계정에 대해 컨텍스트 생성. 토큰 복원 실패 계정은 `needsReauth: true`로 표시하되 **다른 계정은 정상 기동**(부분 실패 격리).
- `requireProvider()` → `requireContext(accountId)`.

### 캐시 (cache.ts)

- 모듈 전역 `db` → `openCache(email)`이 계정별 핸들(인스턴스)을 반환. 모든 캐시 함수는 핸들 메서드가 되거나 핸들을 첫 인자로 받는다.
- DB 파일: `zenmail-<sanitized-email>.db` (email을 파일명 안전 문자로 정규화; 정규화 충돌 시 뒤에 짧은 해시 suffix).
- **마이그레이션**: 레거시 `zenmail.db`는 첫 계정의 스코프 파일명으로 **rename** — 스키마 변경 0건, FTS5 무변경. rename 실패 시 원본 보존(파괴적 삭제 없음).
- `settings`/`splits`는 계정별 DB 소속이 되므로 자연히 계정 스코프(split-inbox 도메인 시딩도 계정별 email 기준으로 동작). 테마 등 **앱 전역 설정**은 계정 DB가 아닌 accounts.json 옆의 전역 KV(파일)로 이전 — 마이그레이션 시 첫 계정 DB의 값을 승계.
- `localDeltaAt`은 AccountContext로 이동(계정 간 스레드 ID 충돌 가능성 차단).

### 데몬 (snooze.ts)

- 단일 60초 틱 유지, 틱마다 **전 AccountContext 순회**: 계정별로 due 스누즈 복귀·예약전송·팔로우업·mutation 드레인 실행. 비활성 계정도 동일 발화.
- 한 계정의 API 실패가 다른 계정 순회를 중단시키지 않는다(계정별 try/catch).
- 틱에서 백그라운드 계정의 INBOX 안읽음 수를 갱신해 `accounts-changed` push로 배지 반영.

### IPC 계약 (shared/types.ts, preload.ts)

- 모든 데이터 메서드(`fetchThreads`, `send`, `modifyLabels`, `snooze` 등)에 `accountId: string` 파라미터 추가.
- push 이벤트(`onThreadsChanged`/`onThreadChanged`/`onSnoozeFired`/`onFollowupFired`/`onSyncState`) 페이로드에 `accountId` 포함 — renderer는 활성 계정 것만 리스트에 반영, 비활성 계정 것은 배지만 갱신.
- 신규 메서드: `listAccounts(): AccountInfo[]`, `addAccount()`(OAuth 플로우 기동), `removeAccount(email)`, `setActiveAccount(email)`(accounts.json `activeEmail` 영속화).
- `AccountInfo` 확장: `{ email, demo, calendarReady, unreadCount, needsReauth }`.
- 기존 `getAccount/signIn/signInDemo/signOut`은 신규 계약으로 대체·정리.

### Renderer (store/mail.ts)

- `account` 단일 필드 → `accounts: AccountInfo[]` + `activeAccountId: string | null`. 기존 `account.email` 참조처(발신자 판별 885행, calendarReady 게이트 4곳)는 `activeAccount` 셀렉터로 치환.
- **계정 전환**: `threads`, `activeThreadId`, `splitDefs`, 검색/선택 상태 등 계정 종속 슬라이스 리셋 → 새 계정 로컬 캐시에서 즉시 첫 페인트(전환 체감 속도가 핵심 품질 목표) → 백그라운드 refresh.
- 모든 API 호출에 `activeAccountId` 전달. push 수신 시 `accountId !== activeAccountId`면 배지 외 무시.

### UI

- **사이드바 상단 계정 섹션**: 계정별 아바타(이니셜) + 안읽음 배지, 클릭 전환, `+` 계정 추가. `needsReauth` 계정은 경고 아이콘 + 클릭 시 재인증 플로우.
- **단축키**: `⌃1`~`⌃9` 즉시 전환 — **useKeyboard 소유**(모달 keydown stopPropagation 규칙 준수, kbar 단일 키와 비충돌).
- **kbar**: "Switch to <email>", "Add account", "Sign out of <email>" 액션 추가.
- **Compose**: 항상 활성 계정에서 발신. From 선택 UI 없음(YAGNI).

### 데모 모드 & E2E 하네스

- `MockGmailProvider` 멀티 인스턴스화(email 파라미터화). 데모 모드는 **mock 계정 2개**(`demo@zenmail.app`, `work@zenmail.app`)로 기동해 멀티계정 E2E의 하네스가 된다.
- 핵심 TC 축: ① 전환 시 데이터 격리(A 스레드가 B 뷰·검색·연락처 자동완성에 안 섞임), ② 비활성 계정 스누즈/예약전송 정시 발화, ③ 배지 갱신, ④ needsReauth 부분 실패 격리, ⑤ 레거시 단일 계정 자동 마이그레이션, ⑥ 계정 제거 시 해당 DB·토큰 정리.

## 에러 처리

- 특정 계정 토큰 만료/취소 → 그 계정만 `needsReauth`, 나머지 계정·데몬 무영향.
- 계정 DB open 실패 → 해당 계정만 오류 상태, 앱 전체는 기동.
- 데몬 순회 중 계정별 실패는 로그 + 다음 틱 재시도(기존 mutation 백오프 체계 재사용).

## 리스크

- **가장 넓은 접점은 cache.ts 전역 `db` 해체** — 호출처(ipc.ts·snooze.ts) 전면 수정. 기계적이지만 누락 시 계정 간 데이터 오염이므로 전역 변수 자체를 제거해 컴파일 타임에 강제한다.
- IPC 시그니처 전면 변경으로 renderer 호출처가 많다 — `accountId` 누락을 타입으로 강제(옵셔널 금지).
- 기존 E2E(run-tc.mjs) 전부가 단일 데모 계정 전제 — 데모 2계정 기동으로 바뀌면 기존 TC의 기본 활성 계정 가정을 점검해야 한다(기본 활성 = `demo@zenmail.app` 유지로 호환).
- snooze 데몬 틱이 계정 수에 비례해 길어짐 — 계정 수 소수(2~4) 전제라 허용, 계정 간 순차 실행 유지(동시 실행 복잡도 회피).

## 구현 순서·워크플로

- `docs/features/multi-account/`에 DEV_WORKFLOW Goal 0~8 수행(PRD/TODO/TC/DECISIONS).
- 구현 순서: ① auth/accounts.json + 마이그레이션 → ② cache 핸들화 → ③ AccountContext Map + IPC 계약 → ④ 데몬 순회 → ⑤ store/UI → ⑥ 데모 2계정 + E2E.
- 완료 기준: feature TC 전부 통과(E2E run-tc.mjs 확장), tsc/vitest clean, /react-best-practices + /impeccable + /code-review, main push, Obsidian 기록.
- PRD.md·MAIL_APP_SPEC.md의 암묵적 단일 계정 전제(상태 모델 예시 등)는 feature PRD에서 명시 갱신.
