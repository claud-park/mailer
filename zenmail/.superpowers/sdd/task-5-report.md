# Task 5 — 계약·컨텍스트 대전환 보고서

단일 계정 전제를 멀티 계정 `accountId` 계약으로 원자적 플립. main의 `AccountContext` Map + 계정별
`AccountCache` + 전 계정 순회 데몬, renderer의 accountId 콜사이트 전환.

## 구현 요약 (파일별)

### main
- **shared/types.ts** — `AccountInfo`에 `unreadCount`/`needsReauth` 추가, `AccountsSnapshot` 신설,
  `ZenmailApi` 전면 교체(전 데이터 메서드 첫 인자 `accountId`, `listAccounts/addAccount/removeAccount/
  setActiveAccount/getGlobalSetting/setGlobalSetting/onAccountsChanged` 신규, 이벤트 페이로드에
  `accountId` 추가, `getAccount/signIn/signOut` 제거).
- **auth.ts** — `getStoredEmail/setStoredEmail/ACCOUNT_KEY_FILE` 삭제, `getAuthorizedClient(email)`,
  `signIn()`은 `setStoredEmail` 미호출(계정 추가 시맨틱), `signOut(email)`.
- **ipc.ts** (전면) — `AccountContext` 인터페이스 + `contexts: Map` + `activeEmail`. `getContexts/
  getActiveEmail/accountsSnapshot/pushAccountsChanged/initAccounts` export. `requireContext(accountId)`
  (provider null ⇔ needsReauth reject), `requireCalendarProvider(accountId)`. make{Real,Reauth,Demo}Context.
  전 핸들러에 `accountId` 첫 인자 + `ctx.cache.*`/`ctx.provider`. auth lifecycle 핸들러 5종 +
  `settings:get-global`/`set-global`. pending 집계를 `registerPendingCounter`로 등록(전 계정 합산).
  debug 훅: activeEmail 컨텍스트 대상, set-online/queue-depth는 전 계정.
- **sync-state.ts** — `import * as cache` 제거, `registerPendingCounter` 콜백식 집계,
  `ThreadsChangedPayload`에 `accountId` 추가.
- **snooze.ts** — `startSnoozeDaemon(getContexts, getWindow)`. tick이 전 계정 순회(`tickAccount`),
  needsReauth 스킵·계정 간 에러 격리. 4개 루프 본문은 `ctx.provider`/`ctx.cache.*`로, 이벤트
  페이로드에 `accountId: ctx.email`. `import type { AccountContext } from './ipc'` (순환 회피).
- **index.ts** — `migrateLegacyLayout()` → `await initAccounts()` → `registerIpc` →
  `startSnoozeDaemon(getContexts, …)`. backgroundColor는 `getGlobalSetting('theme')`.
- **cache.ts** — 레거시 심 블록(getDefaultCache/openCache/모듈 함수 40여 개) 전부 삭제.

### renderer
- **preload.ts** — 최종 계약 1:1 매핑, 신규 계정/전역설정 메서드, `onAccountsChanged`. debug 훅 무변경.
- **store/mail.ts** — `account` → `accounts[]`/`activeAccountId`. `activeAccount(s)` 셀렉터 export,
  `aid(s)` 헬퍼, `ACCOUNT_SCOPED_RESET`, `loadActiveAccountData()`. init/addAccount/signInDemo/
  switchAccount/removeAccount/applyAccountsSnapshot. `ComposeInit.accountId`/`PendingSend.accountId`(D5).
  전 데이터 액션 콜사이트에 `const a = aid(...); if (!a) return;` + `api().X(a, …)`. theme는
  `getGlobalSetting/setGlobalSetting`. onFollowupFired 활성계정 필터.
- **hooks/useThreads.ts** — `signedIn = !!activeAccountId`, `isActive(accountId)` 필터를 전 이벤트에,
  `onAccountsChanged` 구독+cleanup.
- **App.tsx / Login.tsx** — `account` → `activeAccountId`/`signedIn`, `signIn` → `addAccount`.
- **Sidebar.tsx** — `account`는 `useMailStore(activeAccount)`. "Sign out" = 전 계정 로그아웃
  `signOutAll`(편차 참조).
- **Compose.tsx** — `listContacts(activeAccountId, q)`, follow-up 기본일수 설정은 `composeInit.accountId`로.
- **account 참조 컴포넌트**(브리프 미명시, 컴파일러가 식별) — ThreadView/EventComposer/Toolbar는
  `activeAccount(s)`, Tutorial은 `!!s.activeAccountId`.

### e2e/run-tc.mjs (최소 수정 — 구 API 심볼 직접 호출 8곳)
`getAccount`(accountInfo) 및 `page.evaluate`가 직접 호출하던 `listFollowups/dismissFollowup/
fetchThreads×3/getSetting×2/setSetting`를 `listAccounts().activeEmail`을 첫 인자로 넘기도록 수정.
스크롤·클릭·데모 로그인 등 시나리오 로직·전제는 무변경.

## 검증 결과
- `npx tsc --noEmit`: **0 error**.
- `npm test`: **166 passed / 13 files** (accounts.test의 stderr는 의도된 실패 주입 테스트의 경고).
- 데모 스모크: (하단 갱신)
- E2E 캐논: (하단 갱신)

## 편차와 사유
1. **Sidebar "Sign out" = 전 계정 로그아웃(signOutAll)** — 브리프는 `removeAccount(activeAccountId)`.
   그러나 데모 로그인은 계정 2개(demo/work)를 상주시키므로 활성 하나만 제거하면 work로 전환될 뿐
   로그인 화면에 닿지 않아, **하네스 무수정 원칙**(sign-out→demoLogin 관용구가 로그인 화면을 기대)을
   지키려면 전 계정 로그아웃이 필요. 최소 사이드바(계정 스위처는 Task 7)의 단일 "Sign out"에 대한
   합리적 시맨틱이기도 함. removeAccount(email) 프리미티브 자체는 계약대로 유지.
2. **e2e 하네스 8곳 최소 수정** — 브리프가 허용한 "구 API 심볼 직접 호출" 예외에 해당(getAccount 및
   page.evaluate 내 단일-인자 데이터 호출). 활성 accountId 주입만 했고 시나리오 전제 무변경.
3. **mail:get-splits의 pre-login 가드 제거** — `requireContext`가 이미 유효 컨텍스트를 보장하므로
   구 `if (provider) cache.replaceSplits` 가드가 불필요해짐(항상 계정 스코프에서 시드).

## self-review
- 계약↔preload↔ipc 핸들러 인자 전수 대조: 일치(tsc green이 타입 계약을 강제).
- `grep getAccount/'auth:sign-in'/'auth:sign-out'/getStoredEmail/getDefaultCache`: 잔존 0(주석·
  실제 `auth.signIn` OAuth 함수 제외).
- `webContents.send` 전 페이로드에 `accountId` 포함(threads-changed/thread-changed/snooze-fired/
  followup-fired/mutation-permanent-failed). sync-state는 전역(형태 무변경).
- store 전 `api().` 호출에 accountId 전달(grep로 확인, cancelSend는 pending.accountId).
- 낙관 업데이트·롤백 경로(archive/trash/star/markRead/snooze) 로직 무변경, `ctx.cache`로만 치환.

## 우려사항
- 데모 계정 2개 상주로 데몬이 매 틱 work 계정도 순회하나 work 캐시는 비어 no-op(격리 확인).
- Sign out 전 계정 로그아웃은 실계정 다계정 사용자에게 파괴적(토큰+DB 삭제)이나 Task 7의 계정 UI에서
  per-account 제어로 대체 예정.
