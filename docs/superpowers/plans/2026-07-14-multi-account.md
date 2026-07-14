# Multi-Account Gmail 지원 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ZenMail이 2개 이상의 Gmail 계정을 동시 로그인 유지하고, ⌃1~⌃9/사이드바/kbar로 즉시 전환하며, 비활성 계정에서도 스누즈·예약전송·팔로우업·배지가 정상 동작하게 한다.

**Architecture:** 계정 스위처 모델(통합 인박스 없음). accountId=email. main은 `Map<email, AccountContext>`(provider+계정별 SQLite 캐시), 데몬은 매 틱 전 계정 순회. IPC 전 데이터 메서드에 `accountId` 필수(첫 인자), push 이벤트 페이로드에 `accountId` 포함. 캐시는 계정별 DB 파일(`zenmail-<slug>.db`) — 레거시 `zenmail.db`는 rename으로 무마이그레이션 승계. 근거 스펙: `docs/superpowers/specs/2026-07-14-multi-account-design.md`.

**Tech Stack:** Electron 33 + React 19 + TypeScript + Tailwind v4 + zustand + kbar + better-sqlite3 + keytar(파일 폴백). 테스트: vitest(`npm test`), E2E `node e2e/run-tc.mjs`(playwright-core CDP).

## Global Constraints

- 작업 디렉터리: `zenmail/` (모든 명령은 `cd zenmail` 후 실행. 파일 경로는 리포 루트 기준 표기)
- typecheck: `npx tsc --noEmit` — 각 태스크 종료 시 0 error
- vite config `.mts` 유지, `@vitejs/plugin-react` v4 고정, peer 충돌 시 `--legacy-peer-deps`
- v1 No AI (스펙 §9) — AI 제안 금지
- **accountId는 옵셔널 금지** — 최종 계약에서 모든 데이터 IPC 메서드의 필수 첫 인자
- 데모 기본 활성 계정 = `demo@zenmail.app` (기존 E2E 스위트 호환의 전제)
- `demo@zenmail.app` 시드 데이터는 **한 글자도 변경 금지** (기존 E2E 189건의 카운트/순서 불변식)
- E2E 무회귀 캐논: **0 FAIL + SKIP 집합 ⊆ {A4, D5, D8, SY-C3, SA-B4, SY-B2} + 총계 정합** (DEV_WORKFLOW D10)
- 커밋 메시지 접두: `feat(multi-account):` / `test(multi-account):` / `docs(multi-account):`
- 코드 주석·스타일은 주변 코드 컨벤션(한국어 설계 주석 + 영어 코드) 유지

---

## 최종 계약 (모든 태스크의 참조 기준)

### shared/types.ts — 계정 타입

```ts
export interface AccountInfo {
  email: string;
  demo: boolean;
  /** calendar.events scope 보유 여부. false면 캘린더 기능만 비활성(메일 무영향). 데모는 항상 true. */
  calendarReady: boolean;
  /** INBOX 안읽음 스레드 수 — 사이드바 계정 배지. 데몬 틱/최초 스냅샷에서 갱신. */
  unreadCount: number;
  /** 토큰 복원/갱신 실패 — 이 계정의 mail IPC는 reject, 다른 계정 무영향. 재로그인(addAccount)으로 복구. */
  needsReauth: boolean;
}

export interface AccountsSnapshot {
  accounts: AccountInfo[];
  activeEmail: string | null;
}
```

### ZenmailApi — 최종 형태 (accountId는 항상 첫 인자, string 필수)

```ts
export interface ZenmailApi {
  listAccounts(): Promise<AccountsSnapshot>;
  /** real OAuth 플로우 기동 — 성공 시 계정 추가(동일 email 재로그인 = 토큰 갱신/reauth) */
  addAccount(): Promise<AccountsSnapshot>;
  /** 데모 세션 기동 — mock 계정 2개(demo@zenmail.app, work@zenmail.app) 생성, active=demo */
  signInDemo(): Promise<AccountsSnapshot>;
  /** 해당 계정만 제거: keytar 토큰 삭제 + accounts.json 제거 + 계정 DB 파일 삭제 */
  removeAccount(email: string): Promise<AccountsSnapshot>;
  /** accounts.json activeEmail 영속화(실계정 한정 — 데모 계정은 in-memory) */
  setActiveAccount(email: string): Promise<void>;

  fetchThreads(accountId: string, req: FetchThreadsRequest): Promise<FetchThreadsResponse>;
  fetchThread(accountId: string, threadId: string): Promise<ThreadDetail>;
  fetchLabels(accountId: string): Promise<Label[]>;
  send(accountId: string, req: SendRequest): Promise<SendReceipt>;
  cancelSend(accountId: string, sendId: string): Promise<boolean>;
  modifyLabels(accountId: string, req: ModifyLabelsRequest): Promise<void>;
  snooze(accountId: string, req: SnoozeRequest): Promise<void>;
  searchLocal(accountId: string, q: string): Promise<ThreadSummary[]>;
  listContacts(accountId: string, prefix: string): Promise<Contact[]>;
  getSplits(accountId: string): Promise<SplitDefinition[]>;
  setSplits(accountId: string, defs: SplitDefinition[]): Promise<void>;
  getSetting(accountId: string, key: string): Promise<string | null>;
  setSetting(accountId: string, key: string, value: string): Promise<void>;
  /** 앱 전역 설정(테마 등) — userData/settings.json. 계정 DB 아님. */
  getGlobalSetting(key: string): Promise<string | null>;
  setGlobalSetting(key: string, value: string): Promise<void>;

  addFollowup(accountId: string, threadId: string, remindDays: number): Promise<void>;
  cancelFollowup(accountId: string, threadId: string): Promise<void>;
  dismissFollowup(accountId: string, threadId: string): Promise<void>;
  listFollowups(accountId: string): Promise<FollowupInfo[]>;

  listEvents(accountId: string, timeMinISO: string, timeMaxISO: string): Promise<CalendarEvent[]>;
  respondToEvent(accountId: string, iCalUID: string, response: RsvpResponse): Promise<void>;
  createEvent(accountId: string, input: CreateEventInput): Promise<CalendarEvent>;

  notifyOnline(): Promise<void>; // 전역 — 변경 없음

  onThreadsChanged(cb: (p: { accountId: string; upserts: ThreadSummary[]; removals: string[]; needsRefetch?: boolean }) => void): () => void;
  onThreadChanged(cb: (p: { accountId: string; threadId: string; detail: ThreadDetail }) => void): () => void;
  onSnoozeFired(cb: (p: { accountId: string; threadId: string }) => void): () => void;
  onFollowupFired(cb: (p: { accountId: string; threadId: string }) => void): () => void;
  onSyncState(cb: (s: { online: boolean; pending: number }) => void): () => void; // 전역 합산 — 형태 무변경
  onMutationPermanentFailed(cb: (p: { accountId: string; threadId: string | null; kind: string }) => void): () => void;
  /** 배지/needsReauth/계정 목록 변화 push — 데몬 틱·addAccount·removeAccount에서 발화 */
  onAccountsChanged(cb: (snap: AccountsSnapshot) => void): () => void;

  // E2E-only debug hooks — 시그니처 무변경(내부적으로 main의 activeEmail 컨텍스트 대상).
  // __debugTick만 전 계정 순회 데몬을 그대로 실행. (기존 하네스 콜사이트 보존)
  __debugSimulateReply?(threadId: string): Promise<void>;
  __debugTick?(): Promise<void>;
  __debugAddFollowupDueNow?(threadId: string): Promise<void>;
  __debugFailNextModify?(): Promise<void>;
  __debugFailNextModifyForThread?(threadId: string): Promise<void>;
  __debugSetOnline?(v: boolean): Promise<void>; // 전 mock provider에 일괄 적용
  __debugQueueDepth?(): Promise<number>;        // 전 계정 합산
  __debugProviderCalls?(): Promise<Record<string, number>>;
  __debugExternalArchive?(threadId: string): Promise<void>;
  __debugCalendarState?(): Promise<{ events: CalendarEvent[]; responses: Record<string, string> }>;
  __debugFailNextCalendar?(): Promise<void>;
  __debugSetCalendarReady?(v: boolean): Promise<void>;
}
```

제거되는 기존 메서드: `getAccount`, `signIn`, `signOut` (구 `AccountInfo` 3필드 형태 포함).

### IPC 채널 매핑

| 채널 | 인자 | 반환 |
|---|---|---|
| `auth:list-accounts` | — | AccountsSnapshot |
| `auth:add-account` | — | AccountsSnapshot |
| `auth:sign-in-demo` | — | AccountsSnapshot |
| `auth:remove-account` | email | AccountsSnapshot |
| `auth:set-active-account` | email | void |
| `auth:accounts-changed` (push) | AccountsSnapshot | — |
| `mail:*`, `calendar:*` | (accountId, …기존 인자) | 기존과 동일 |
| `settings:get-global` / `settings:set-global` | key / key,value | string\|null / void |

제거: `auth:get-account`, `auth:sign-in`, `auth:sign-out`.

---

### Task 1: feature 문서 세트 (Goal 1~4 산출물)

**Files:**
- Create: `docs/features/multi-account/PRD.md`
- Create: `docs/features/multi-account/TODO.md`
- Create: `docs/features/multi-account/TC.md`
- Create: `docs/features/multi-account/DECISIONS.md`

**Interfaces:** 없음 (문서만). 이후 태스크가 TODO 체크포인트·TC ID(TC-MA-*)를 참조한다.

- [ ] **Step 1: PRD.md 작성** — 스펙(`docs/superpowers/specs/2026-07-14-multi-account-design.md`)을 feature PRD로 정리. 필수 섹션: 목적 / 사용자 확정 4건(스위처·풀 백그라운드·⌃숫자+사이드바+kbar·계정별 DB) / 범위(포함·제외: 통합 인박스 제외, From 선택 UI 제외, 비-Gmail 제외) / 성공 기준(TC-MA 전건 + 기존 스위트 캐논 무회귀).
- [ ] **Step 2: TODO.md 작성** — 본 플랜의 Task 2~9를 체크포인트로 매핑 (`[ ]` 상태로).
- [ ] **Step 3: TC.md 작성** — If-When-Then 구조. 최소 세트 (Task 8이 구현):
  - TC-MA-A1: If 데모 로그인, When 앱 진입, Then 사이드바에 계정 2개(demo·work), active=demo, 기존 데모 인박스 리스트 그대로.
  - TC-MA-A2: If demo 활성, When ⌃2, Then work 계정 리스트로 전환(고유 subject 표시)·demo 스레드 subject 미표시(격리).
  - TC-MA-A3: If work 활성, When ⌃1, Then demo 리스트 복귀·selectedIndex 0.
  - TC-MA-B1: If work에서 스레드 아카이브, When demo 전환 후 다시 work 전환, Then demo 리스트 무영향 + work 아카이브 유지(계정별 캐시 격리).
  - TC-MA-B2: If work 스레드를 과거 시각으로 스누즈 후 demo로 전환, When `__debugTick`, Then work 전환 시 해당 스레드 인박스 복귀(비활성 계정 데몬 발화).
  - TC-MA-C1: If work 전용 발신자 존재, When demo 계정에서 로컬 검색/연락처 자동완성, Then work 발신자 미노출.
  - TC-MA-D1: If demo 활성, When work에 `__debugSimulateReply`+데몬 틱, Then 사이드바 work 배지 증가.
  - TC-MA-E1: 레거시 마이그레이션(account.json+zenmail.db → accounts.json+계정 DB) — **vitest 단위 테스트로 검증**(Task 2), E2E에선 N/A 표기.
- [ ] **Step 4: DECISIONS.md 작성** — 초기 결정 기록: D1 accountId=email(keytar 키 재사용, UUID 미도입) / D2 계정별 DB 파일(스키마 마이그레이션 0건, WHERE 누락 원천 차단; 통합 인박스는 필요 시 read-only 머지) / D3 데모 계정 비영속(재시작 시 로그인 화면 — 기존 E2E 부트 시퀀스 보존) / D4 needsReauth 복구 = addAccount 재사용(전용 reauth 메서드 없음 — signOut→signIn 재사용한 calendar D7 선례) / D5 Compose는 열린 시점의 accountId를 캡처해 발신(전환 중 From 바뀜 방지) / D6 debug hook은 main의 activeEmail 컨텍스트 대상(기존 하네스 시그니처 보존) / D7 배지는 데몬 틱 주기(60s) 갱신 — 실계정 API 비용 1콜/계정/분.
- [ ] **Step 5: Commit**

```bash
git add docs/features/multi-account/
git commit -m "docs(multi-account): feature PRD/TODO/TC/DECISIONS (Goal 1~4)"
```

---

### Task 2: `src/main/accounts.ts` — 계정 레지스트리 + 전역 설정 + 레거시 마이그레이션

**Files:**
- Create: `zenmail/src/main/accounts.ts`
- Create: `zenmail/src/main/accounts.test.ts`

**Interfaces:**
- Produces (후속 태스크가 사용):
  - `emailSlug(email: string): string`
  - `accountDbPath(email: string): string`
  - `type StoredAccount = { email: string; demo: boolean }`
  - `type AccountsFile = { accounts: StoredAccount[]; activeEmail: string | null }`
  - `readAccounts(): AccountsFile` / `addStoredAccount(email: string): AccountsFile` / `removeStoredAccount(email: string): AccountsFile` / `setActiveEmail(email: string | null): void`
  - `getGlobalSetting(key: string): string | null` / `setGlobalSetting(key: string, value: string): void`
  - `migrateLegacyLayout(): void`
  - `__setUserDataDirForTests(dir: string | null): void` (vitest 전용 — electron `app` 부재 환경)
- Consumes: `electron.app.getPath('userData')`, `better-sqlite3`(마이그레이션의 테마 복사)

- [ ] **Step 1: 실패하는 테스트 작성** — `accounts.test.ts`. electron 불가 환경이므로 `__setUserDataDirForTests(tmpdir)` 사용 (cache.test.ts 상단 주석의 제약을 이 주입 시임으로 해소):

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  __setUserDataDirForTests, accountDbPath, addStoredAccount, emailSlug,
  getGlobalSetting, migrateLegacyLayout, readAccounts, removeStoredAccount,
  setActiveEmail, setGlobalSetting,
} from './accounts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zm-accounts-'));
  __setUserDataDirForTests(dir);
});
afterEach(() => {
  __setUserDataDirForTests(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('emailSlug', () => {
  it('keeps filename-safe chars and replaces the rest', () => {
    expect(emailSlug('a.b@c-d.io')).toBe('a.b@c-d.io');
    expect(emailSlug('a b/c@x.io')).toBe('a_b_c@x.io');
  });
});

describe('accounts registry', () => {
  it('starts empty and persists add/remove/active round-trips', () => {
    expect(readAccounts()).toEqual({ accounts: [], activeEmail: null });
    addStoredAccount('a@x.io');
    addStoredAccount('b@y.io');
    setActiveEmail('b@y.io');
    expect(readAccounts()).toEqual({
      accounts: [{ email: 'a@x.io', demo: false }, { email: 'b@y.io', demo: false }],
      activeEmail: 'b@y.io',
    });
    // 활성 계정을 제거하면 activeEmail은 남은 첫 계정으로 폴백
    expect(removeStoredAccount('b@y.io').activeEmail).toBe('a@x.io');
  });
  it('addStoredAccount is idempotent per email', () => {
    addStoredAccount('a@x.io');
    addStoredAccount('a@x.io');
    expect(readAccounts().accounts).toHaveLength(1);
  });
});

describe('global settings (settings.json)', () => {
  it('round-trips and returns null for missing keys', () => {
    expect(getGlobalSetting('theme')).toBeNull();
    setGlobalSetting('theme', 'dark');
    expect(getGlobalSetting('theme')).toBe('dark');
  });
});

describe('migrateLegacyLayout', () => {
  it('converts account.json + zenmail.db(+wal/shm) and copies the theme setting', () => {
    fs.writeFileSync(path.join(dir, 'account.json'), JSON.stringify({ email: 'me@x.io' }));
    const legacy = new Database(path.join(dir, 'zenmail.db'));
    legacy.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    legacy.prepare("INSERT INTO settings VALUES ('theme','dark')").run();
    legacy.close();
    fs.writeFileSync(path.join(dir, 'zenmail.db-wal'), '');

    migrateLegacyLayout();

    expect(readAccounts()).toEqual({ accounts: [{ email: 'me@x.io', demo: false }], activeEmail: 'me@x.io' });
    expect(fs.existsSync(accountDbPath('me@x.io'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'zenmail.db'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'account.json'))).toBe(false);
    expect(getGlobalSetting('theme')).toBe('dark');
  });
  it('is a no-op when accounts.json already exists', () => {
    addStoredAccount('a@x.io');
    fs.writeFileSync(path.join(dir, 'account.json'), JSON.stringify({ email: 'other@x.io' }));
    migrateLegacyLayout();
    expect(readAccounts().accounts).toEqual([{ email: 'a@x.io', demo: false }]);
  });
  it('creates an empty registry when no legacy files exist', () => {
    migrateLegacyLayout();
    expect(readAccounts()).toEqual({ accounts: [], activeEmail: null });
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- accounts` / Expected: FAIL ("Cannot find module './accounts'")
- [ ] **Step 3: 구현** — `src/main/accounts.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// electron은 main 프로세스 밖(vitest)에서 바이너리 경로 문자열로 해석된다 — 지연 로드 + 테스트 오버라이드.
let userDataDirOverride: string | null = null;
export function __setUserDataDirForTests(dir: string | null): void {
  userDataDirOverride = dir;
}
function userDataDir(): string {
  if (userDataDirOverride) return userDataDirOverride;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { app } = require('electron') as typeof import('electron');
  return app.getPath('userData');
}

export interface StoredAccount { email: string; demo: boolean }
export interface AccountsFile { accounts: StoredAccount[]; activeEmail: string | null }

const ACCOUNTS_FILE = () => path.join(userDataDir(), 'accounts.json');
const GLOBAL_SETTINGS_FILE = () => path.join(userDataDir(), 'settings.json');
const LEGACY_ACCOUNT_FILE = () => path.join(userDataDir(), 'account.json');
const LEGACY_DB_FILE = () => path.join(userDataDir(), 'zenmail.db');

/** 파일명 안전 슬러그 — 이메일 규격 문자 중 [A-Za-z0-9.@_-]만 보존, 나머지는 '_'. */
export function emailSlug(email: string): string {
  return email.replace(/[^A-Za-z0-9.@_-]/g, '_');
}

export function accountDbPath(email: string): string {
  return path.join(userDataDir(), `zenmail-${emailSlug(email)}.db`);
}

export function readAccounts(): AccountsFile {
  try {
    const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE(), 'utf8')) as AccountsFile;
    return { accounts: raw.accounts ?? [], activeEmail: raw.activeEmail ?? null };
  } catch {
    return { accounts: [], activeEmail: null };
  }
}

function writeAccounts(file: AccountsFile): void {
  fs.writeFileSync(ACCOUNTS_FILE(), JSON.stringify(file), { mode: 0o600 });
}

/** 실계정 추가(중복 email은 no-op). 첫 계정이면 activeEmail로 지정. 데모 계정은 영속하지 않는다(D3). */
export function addStoredAccount(email: string): AccountsFile {
  const file = readAccounts();
  if (!file.accounts.some((a) => a.email === email)) {
    file.accounts.push({ email, demo: false });
  }
  if (!file.activeEmail) file.activeEmail = email;
  writeAccounts(file);
  return file;
}

export function removeStoredAccount(email: string): AccountsFile {
  const file = readAccounts();
  file.accounts = file.accounts.filter((a) => a.email !== email);
  if (file.activeEmail === email) file.activeEmail = file.accounts[0]?.email ?? null;
  writeAccounts(file);
  return file;
}

export function setActiveEmail(email: string | null): void {
  const file = readAccounts();
  // 데모 등 미등록 email이면 영속하지 않는다 — 재시작 시 등록 계정 기준으로만 복원.
  if (email !== null && !file.accounts.some((a) => a.email === email)) return;
  file.activeEmail = email;
  writeAccounts(file);
}

// --- 앱 전역 설정 KV (테마 등 — 계정 스코프가 아닌 설정) ---

function readGlobalSettings(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(GLOBAL_SETTINGS_FILE(), 'utf8'));
  } catch {
    return {};
  }
}

export function getGlobalSetting(key: string): string | null {
  return readGlobalSettings()[key] ?? null;
}

export function setGlobalSetting(key: string, value: string): void {
  const d = readGlobalSettings();
  d[key] = value;
  fs.writeFileSync(GLOBAL_SETTINGS_FILE(), JSON.stringify(d), { mode: 0o600 });
}

/**
 * 레거시 단일 계정 레이아웃 → 멀티 계정 레이아웃 1회 변환. 앱 시작 시(윈도우 생성 전) 호출.
 *  - accounts.json이 이미 있으면 no-op (이미 마이그레이션됨).
 *  - account.json이 있으면: 그 email을 첫 실계정으로 등록하고, zenmail.db(+-wal/-shm)를
 *    계정 스코프 파일명으로 rename, settings.theme를 전역 settings.json으로 복사, account.json 삭제.
 *  - 어느 쪽도 없으면 빈 레지스트리 생성.
 * 실패 시 원본 보존(파괴적 삭제 없음) — rename 실패는 콘솔 경고 후 원본 유지.
 */
export function migrateLegacyLayout(): void {
  if (fs.existsSync(ACCOUNTS_FILE())) return;
  let legacyEmail: string | null = null;
  try {
    legacyEmail = (JSON.parse(fs.readFileSync(LEGACY_ACCOUNT_FILE(), 'utf8')) as { email?: string }).email ?? null;
  } catch {
    /* no legacy account */
  }
  if (!legacyEmail) {
    writeAccounts({ accounts: [], activeEmail: null });
    return;
  }
  writeAccounts({ accounts: [{ email: legacyEmail, demo: false }], activeEmail: legacyEmail });
  const target = accountDbPath(legacyEmail);
  try {
    if (fs.existsSync(LEGACY_DB_FILE()) && !fs.existsSync(target)) {
      for (const ext of ['', '-wal', '-shm']) {
        const src = LEGACY_DB_FILE() + ext;
        if (fs.existsSync(src)) fs.renameSync(src, target + ext);
      }
    }
    // 테마는 앱 전역 설정으로 승계 — index.ts의 BrowserWindow backgroundColor가 계정 DB 없이 읽어야 한다.
    if (fs.existsSync(target)) {
      const db = new Database(target, { readonly: true });
      try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'theme'").get() as { value: string } | undefined;
        if (row) setGlobalSetting('theme', row.value);
      } finally {
        db.close();
      }
    }
    fs.rmSync(LEGACY_ACCOUNT_FILE(), { force: true });
  } catch (err) {
    console.warn('[accounts] legacy migration incomplete (originals preserved):', err);
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test -- accounts` / Expected: PASS 전건. Run: `npx tsc --noEmit` / Expected: 0 error.
- [ ] **Step 5: Commit**

```bash
git add src/main/accounts.ts src/main/accounts.test.ts
git commit -m "feat(multi-account): accounts.json 레지스트리 + 전역 설정 KV + 레거시 1회 마이그레이션"
```

---

### Task 3: `cache.ts` → `AccountCache` 클래스 (계정별 DB 핸들)

**Files:**
- Modify: `zenmail/src/main/cache.ts` (전면 — 모듈 전역 `db`/`localDeltaAt` 제거)
- Modify: `zenmail/src/main/cache.test.ts` (DB-level 테스트 추가)

**Interfaces:**
- Produces:
  - `class AccountCache` — 생성자 `new AccountCache(dbFile: string)`. 기존 모듈 함수 전부가 동일 이름·동일 시그니처의 **메서드**가 된다(아래 목록). `localDeltaAt`은 인스턴스 필드. 추가 메서드 `close(): void` (`this.db.close()`).
  - 메서드 목록(시그니처 무변경, `openCache()` 호출부만 `this.db`로): `upsertThreads`, `getThreads`, `getViewRows`, `isSnoozed`, `getThreadSummary`, `cacheThreadDetail`, `getCachedThreadDetail`, `applyLabelDelta`, `searchLocal`, `listContacts`, `addSnooze`, `dueSnoozes`, `removeSnooze`, `addScheduledSend`, `dueScheduledSends`, `removeScheduledSend`, `bumpScheduledSendAttempt`, `getSplits`, `replaceSplits`, `getSetting`, `setSetting`, `addFollowup`, `dueFollowups`, `setFollowupFired`, `removeFollowup`, `listFollowups`, `getFollowup`, `clearFollowups`, `enqueueMutation`, `listDrainableMutations`, `bumpMutationAttempt`, `removeMutation`, `hasPendingMutations`, `mutationQueueDepth`, `overdueScheduledSendCount`, `localDeltaSince`, `clearLocalDeltaTracking`
  - `mergeLabelIds`는 순수 모듈 함수로 유지(기존 테스트 보존). `QueuedMutation` export 유지.
  - **임시 레거시 심**(Task 5에서 삭제): 기존 모듈 함수 export를 전부 유지하되, `getDefaultCache()`(레거시 경로 `userData/zenmail.db`의 지연 싱글턴 AccountCache)로 위임. `export function openCache(): void`은 `getDefaultCache()` 호출로 대체. 이 심 덕분에 ipc.ts/snooze.ts/index.ts는 이 태스크에서 무수정 컴파일된다.
- Consumes: 없음 (accounts.ts와는 아직 미연결 — dbFile은 문자열 인자)

- [ ] **Step 1: 실패하는 테스트 작성** — `cache.test.ts`에 DB-level describe 추가(파일 상단의 "unit-test 불가" 주석은 "AccountCache가 경로 주입식이 되어 해소됨"으로 갱신):

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AccountCache, mergeLabelIds } from './cache';
// (기존 mergeLabelIds describe 블록은 그대로 유지)

describe('AccountCache — per-account isolation', () => {
  let dir: string;
  let a: AccountCache;
  let b: AccountCache;
  const t = (id: string, from = 'x@a.io'): import('../shared/types').ThreadSummary => ({
    id, subject: `s-${id}`, from: { name: from, email: from }, snippet: '',
    date: 1, unread: false, labelIds: ['INBOX'], messageCount: 1,
  });
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zm-cache-'));
    a = new AccountCache(path.join(dir, 'a.db'));
    b = new AccountCache(path.join(dir, 'b.db'));
  });
  afterEach(() => {
    a.close(); b.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('threads written to one cache are invisible to the other', () => {
    a.upsertThreads([t('t1')]);
    expect(a.getThreads('INBOX').map((x) => x.id)).toEqual(['t1']);
    expect(b.getThreads('INBOX')).toEqual([]);
  });

  it('contacts/search stay scoped per cache (TC-MA-C1 unit twin)', () => {
    a.upsertThreads([t('t1', 'only-in-a@a.io')]);
    expect(a.listContacts('only-in-a')).toHaveLength(1);
    expect(b.listContacts('only-in-a')).toEqual([]);
    expect(b.searchLocal('s-t1')).toEqual([]);
  });

  it('localDeltaSince is per-instance state', () => {
    a.upsertThreads([t('t1')]);
    b.upsertThreads([t('t1')]);
    a.applyLabelDelta('t1', [], ['INBOX']);
    expect(a.localDeltaSince('t1', 0)).toBe(true);
    expect(b.localDeltaSince('t1', 0)).toBe(false);
  });

  it('applyLabelDelta + settings round-trip on a real db file', () => {
    a.upsertThreads([t('t1')]);
    a.applyLabelDelta('t1', ['UNREAD'], []);
    expect(a.getThreadSummary('t1')!.unread).toBe(true);
    a.setSetting('k', 'v');
    expect(a.getSetting('k')).toBe('v');
  });
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm test -- cache` / Expected: FAIL ("AccountCache is not exported" 계열)
- [ ] **Step 3: 클래스 전환 구현** — 기계적 변환 규칙:
  1. `let db`/`const localDeltaAt`/`openCache()` 모듈 상태 제거 → 클래스로:

```ts
export class AccountCache {
  private db: Database.Database;
  /** inbox-zero-starred D3 로컬-델타 가드 — 계정(인스턴스) 스코프. 기존 모듈 전역 주석 근거 동일. */
  private localDeltaAt = new Map<string, number>();

  constructor(dbFile: string) {
    this.db = new Database(dbFile);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`…기존 openCache의 CREATE TABLE 블록 그대로…`);
    for (const stmt of [/* 기존 ALTER TABLE 2건 그대로 */]) { /* 기존 duplicate column 스월로 그대로 */ }
  }

  close(): void {
    this.db.close();
  }
  // …이하 기존 함수 본문을 메서드로 이동: `const d = openCache();` → `const d = this.db;`,
  // `openCache().prepare(…)` → `this.db.prepare(…)`, `localDeltaAt` → `this.localDeltaAt` …
}
```

  2. 파일 하단에 임시 레거시 심(전부 한 블록, `// TODO(multi-account Task 5): remove legacy shim` 표시):

```ts
// ---------------------------------------------------------------------------
// LEGACY SHIM — 단일 계정 시절 모듈 함수 API. Task 5(계약 대전환)에서 콜사이트와 함께 제거.
// ---------------------------------------------------------------------------
let defaultCache: AccountCache | null = null;
function getDefaultCache(): AccountCache {
  if (!defaultCache) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron') as typeof import('electron');
    const p = require('node:path') as typeof import('node:path');
    defaultCache = new AccountCache(p.join(app.getPath('userData'), 'zenmail.db'));
  }
  return defaultCache;
}
export function openCache(): void { getDefaultCache(); }
export const upsertThreads: AccountCache['upsertThreads'] = (...a) => getDefaultCache().upsertThreads(...a);
// …기존 export 함수 전부 같은 패턴으로 1줄 위임 (getThreads, getViewRows, isSnoozed, getThreadSummary,
// cacheThreadDetail, getCachedThreadDetail, applyLabelDelta, searchLocal, listContacts, addSnooze,
// dueSnoozes, removeSnooze, addScheduledSend, dueScheduledSends, removeScheduledSend,
// bumpScheduledSendAttempt, getSplits, replaceSplits, getSetting, setSetting, addFollowup, dueFollowups,
// setFollowupFired, removeFollowup, listFollowups, getFollowup, clearFollowups, enqueueMutation,
// listDrainableMutations, bumpMutationAttempt, removeMutation, hasPendingMutations, mutationQueueDepth,
// overdueScheduledSendCount, localDeltaSince, clearLocalDeltaTracking)
```

  주의: 기존 `openCache()`는 `Database.Database`를 반환했지만 유일한 외부 사용처는 `index.ts:64`의 부팅 호출(반환값 미사용)과 `index.ts:23`의 `getSetting`(별도 export) — 반환형을 void로 좁혀도 컴파일에 영향 없음(확인 후 진행).
- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: 전건 PASS (기존 mergeLabelIds 포함). Run: `npx tsc --noEmit` / Expected: 0 error.
- [ ] **Step 5: 데모 스모크** — Run: `npm start` 후 데모 로그인·인박스 렌더 확인(레거시 심 경유 무회귀), 종료.
- [ ] **Step 6: Commit**

```bash
git add src/main/cache.ts src/main/cache.test.ts
git commit -m "feat(multi-account): cache를 AccountCache 클래스로 — 계정별 DB 핸들·인스턴스 스코프 localDelta (레거시 심 유지)"
```

---

### Task 4: Mock provider 파라미터화 + work 데모 시드 + `inboxUnreadCount`

**Files:**
- Modify: `zenmail/src/main/gmail.ts`

**Interfaces:**
- Produces:
  - `GmailProvider`에 `inboxUnreadCount(): Promise<number>` 추가 (배지용 — Task 6 데몬이 사용)
  - `MockGmailProvider` 생성자: `constructor(email: string = 'demo@zenmail.app')` — email별 시드 분기
  - `export const DEMO_ACCOUNT_EMAILS = ['demo@zenmail.app', 'work@zenmail.app'] as const;`
  - work 시드 스레드 id 접두 `work_`, 발신자 도메인 `*.example` (demo 시드와 절대 미교차)
- Consumes: 없음

- [ ] **Step 1: `GmailProvider` 인터페이스에 추가** (gmail.ts:18-28):

```ts
export interface GmailProvider {
  readonly email: string;
  readonly demo: boolean;
  // …기존 메서드…
  /** INBOX 안읽음 스레드 수 — 사이드바 계정 배지(60s 데몬 틱 갱신). Real은 labels.get 1콜. */
  inboxUnreadCount(): Promise<number>;
}
```

- [ ] **Step 2: RealGmailProvider 구현** (클래스 말미에 추가):

```ts
  async inboxUnreadCount(): Promise<number> {
    const res = await this.gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
    return res.data.threadsUnread ?? 0;
  }
```

- [ ] **Step 3: buildDemoData 파라미터화 + work 시드** — `buildDemoData()` → `buildDemoData(email: string)`. 기존 본문 내 하드코딩 `'demo@zenmail.app'` 7곳(mk의 You from/to, intro/cal/starred 시드의 to)을 `email` 참조로 치환하되, **`demo@zenmail.app`로 호출되면 결과가 기존과 바이트 동일해야 한다**(치환만, 로직 무변경). 이어서 분기 추가:

```ts
export const DEMO_ACCOUNT_EMAILS = ['demo@zenmail.app', 'work@zenmail.app'] as const;

/** 두 번째 데모 계정 시드 — demo 시드와 발신자·id·subject가 전혀 겹치지 않는 소형 세트(TC-MA 격리 검증용). */
function buildWorkDemoData(email: string): { threads: MockThread[]; labels: Label[]; senders: Contact[] } {
  const labels: Label[] = [
    { id: 'INBOX', name: 'Inbox', type: 'system', unreadCount: 0, visible: true },
    { id: 'SENT', name: 'Sent', type: 'system', unreadCount: 0, visible: true },
    { id: 'DRAFT', name: 'Drafts', type: 'system', unreadCount: 0, visible: true },
    { id: 'TRASH', name: 'Trash', type: 'system', unreadCount: 0, visible: false },
    { id: 'UNREAD', name: 'Unread', type: 'system', unreadCount: 0, visible: false },
    ...CATEGORY_LABELS.map((id) => ({
      id, name: id.replace('CATEGORY_', '').toLowerCase(), type: 'system' as const, unreadCount: 0, visible: false,
    })),
    { id: DEMO_SNOOZE_LABEL_ID, name: SNOOZE_LABEL_NAME, type: 'user', unreadCount: 0, visible: false },
  ];
  const now = Date.now();
  const h = 3600_000;
  const senders: Contact[] = [
    { name: 'Acme Client', email: 'client@acme.example' },
    { name: 'Legal Team', email: 'legal@acme.example' },
    { name: 'Billing Bot', email: 'billing@vendor.example' },
  ];
  const mkW = (i: number, from: Contact, subject: string, snippet: string, labelIds: string[], ageHours: number): MockThread => {
    const id = `work_${i}`;
    const date = now - ageHours * h;
    const msg = {
      id: `${id}_m0`, threadId: id, from, to: [{ name: 'You', email }], cc: [] as Contact[],
      date, snippet, bodyHtml: demoBody([snippet]), bodyText: snippet, labelIds,
    };
    return {
      summary: { id, subject, from, snippet, date, unread: labelIds.includes('UNREAD'), labelIds, messageCount: 1 },
      detail: { id, subject, labelIds, messages: [msg] },
    };
  };
  const threads = [
    mkW(1, senders[0], 'W: Acme renewal contract', 'Renewal terms attached — need your sign-off by Friday.', ['INBOX', 'UNREAD'], 2),
    mkW(2, senders[1], 'W: NDA redlines round 2', 'Two remaining clauses flagged by legal.', ['INBOX', 'UNREAD'], 6),
    mkW(3, senders[0], 'W: Kickoff notes', 'Scope locked, timeline draft inside.', ['INBOX'], 24),
    mkW(4, senders[2], 'W: Invoice #88 due', 'Net-30 reminder for invoice #88.', ['INBOX'], 48),
    mkW(5, senders[1], 'W: Archived reference doc', 'Old policy doc for reference.', ['SENT'], 72),
  ];
  return { threads, labels, senders };
}
```

- [ ] **Step 4: MockGmailProvider 생성자 파라미터화**:

```ts
export class MockGmailProvider implements GmailProvider {
  readonly demo = true;
  readonly email: string;
  // …기존 필드…

  constructor(email: string = 'demo@zenmail.app') {
    this.email = email;
    const data = email === 'work@zenmail.app' ? buildWorkDemoData(email) : buildDemoData(email);
    this.threads = data.threads;
    this.labels = data.labels;
    this.senders = data.senders;
  }
```

  본문 내 `'demo@zenmail.app'`/`this.email` 혼용 3곳(send의 from, simulateReply의 meEmail — 이미 this.email 사용 확인)을 점검해 전부 `this.email` 기준으로 통일. `inboxUnreadCount` 구현 추가:

```ts
  async inboxUnreadCount(): Promise<number> {
    return this.threads.filter((t) => t.summary.unread && t.summary.labelIds.includes('INBOX')).length;
  }
```

- [ ] **Step 5: 검증** — Run: `npx tsc --noEmit` → 0 error. Run: `npm test` → PASS. Run: `node e2e/run-tc.mjs` → **캐논 무회귀**(0 FAIL, SKIP ⊆ 캐논 집합) — demo 시드 바이트 동일성의 실증.
- [ ] **Step 6: Commit**

```bash
git add src/main/gmail.ts
git commit -m "feat(multi-account): Mock provider email 파라미터화 + work@zenmail.app 시드 + inboxUnreadCount"
```

---

### Task 5: 계약·컨텍스트 대전환 (auth/types/preload/ipc/sync-state/snooze/index + renderer 콜사이트)

> 이 태스크는 단일 계정 전제의 원자적 플립이다 — main과 renderer 계약이 맞물려 있어 중간 커밋은 tsc red일 수 있으나, **태스크 종료 시점에는 tsc 0 error + vitest PASS + 데모 스모크까지** 반드시 통과한다. 커밋은 (a) main측, (b) renderer측 2회로 나누되 push는 태스크 완료 후.

**Files:**
- Modify: `zenmail/src/shared/types.ts` (계약 — 문서 상단 "최종 계약" 그대로)
- Modify: `zenmail/src/main/auth.ts`
- Modify: `zenmail/src/main/preload.ts`
- Modify: `zenmail/src/main/ipc.ts` (전면)
- Modify: `zenmail/src/main/sync-state.ts`
- Modify: `zenmail/src/main/snooze.ts`
- Modify: `zenmail/src/main/index.ts`
- Modify: `zenmail/src/main/cache.ts` (레거시 심 블록 삭제)
- Modify: `zenmail/src/renderer/store/mail.ts`
- Modify: `zenmail/src/renderer/hooks/useThreads.ts`
- Modify: `zenmail/src/renderer/components/Compose.tsx` (콜사이트 3곳)
- Modify: `zenmail/src/renderer/components/Sidebar.tsx` (account 참조 최소 수정 — UI 신설은 Task 7)
- Modify: `zenmail/src/renderer/App.tsx`, `zenmail/src/renderer/components/Login.tsx` (account→accounts 참조)

**Interfaces:**
- Consumes: Task 2 `accounts.ts` 전부, Task 3 `AccountCache`/`openAccountCache 부재 — 생성자 직접 사용`, Task 4 `MockGmailProvider(email)`/`DEMO_ACCOUNT_EMAILS`
- Produces (Task 6~8이 사용):
  - ipc.ts: `interface AccountContext { email: string; demo: boolean; provider: GmailProvider | null; calendarProvider: CalendarProvider | null; calendarReady: boolean; cache: AccountCache; needsReauth: boolean; unreadCount: number }` — `provider === null ⇔ needsReauth`
  - ipc.ts: `getContexts(): AccountContext[]`, `getActiveEmail(): string | null`, `accountsSnapshot(): AccountsSnapshot`, `pushAccountsChanged(getWindow): void`, `initAccounts(): Promise<void>`
  - sync-state.ts: `registerPendingCounter(fn: () => number): void`; `notifyThreadsChanged(getWindow, payload)` — payload 타입에 `accountId: string` 추가
  - snooze.ts: `startSnoozeDaemon(getContexts: () => AccountContext[], getWindow): void`
  - store: `accounts: AccountInfo[]`, `activeAccountId: string | null`, `switchAccount(email): Promise<void>`, `addAccount(): Promise<void>`, `removeAccount(email): Promise<void>`, export `function activeAccount(s: MailState): AccountInfo | null`
  - store: `ComposeInit.accountId: string`, `PendingSend.accountId: string`

- [ ] **Step 1: auth.ts 멀티 계정화**

```ts
// getStoredEmail/setStoredEmail/ACCOUNT_KEY_FILE 3개 심볼 삭제 (레거시 account.json은 accounts.migrateLegacyLayout 소관)

/** 특정 계정의 authorized client. 토큰 부재/파손 시 null (호출측이 needsReauth 처리). */
export async function getAuthorizedClient(email: string): Promise<{
  client: OAuth2Client;
  email: string;
  calendarReady: boolean;
} | null> {
  const raw = await store.get(email);
  if (!raw) return null;
  const client = newOAuthClient();
  let current = JSON.parse(raw) as Credentials;
  const calendarReady = typeof current.scope === 'string' && current.scope.includes('calendar.events');
  client.setCredentials(current);
  client.on('tokens', (tokens) => {
    current = { ...current, ...tokens };
    void store.set(email, JSON.stringify(current));
  });
  return { client, email, calendarReady };
}

/** signIn(): 기존 PKCE 플로우 그대로, 단 setStoredEmail 호출만 삭제(계정 추가 시맨틱) — store.set(email, tokens) 후 email 반환. */

export async function signOut(email: string): Promise<void> {
  await store.del(email);
}
```

- [ ] **Step 2: types.ts를 "최종 계약"으로 교체** — 문서 상단 계약 블록 그대로. `AccountInfo` 확장, `AccountsSnapshot` 신설, `ZenmailApi` 전면 교체(구 `getAccount/signIn/signOut` 삭제).
- [ ] **Step 3: sync-state.ts** — pending 집계를 콜백 등록식으로:

```ts
let pendingCounter: () => number = () => 0;
/** ipc.ts가 컨텍스트 합산 집계를 등록한다 — sync-state는 cache를 직접 알지 않는다. */
export function registerPendingCounter(fn: () => number): void {
  pendingCounter = fn;
}
export function emitSyncState(getWindow: () => BrowserWindow | null): void {
  getWindow()?.webContents.send('mail:sync-state', { online, pending: pendingCounter() });
}
export interface ThreadsChangedPayload {
  accountId: string;
  upserts: ThreadSummary[];
  removals: string[];
  needsRefetch?: boolean;
}
```
  (`import * as cache` 제거.)
- [ ] **Step 4: ipc.ts 전면 개편** — 골격:

```ts
import * as accounts from './accounts';
import { AccountCache } from './cache';
import { DEMO_ACCOUNT_EMAILS, MockGmailProvider, RealGmailProvider, type GmailProvider } from './gmail';

export interface AccountContext {
  email: string;
  demo: boolean;
  provider: GmailProvider | null; // null ⇔ needsReauth
  calendarProvider: CalendarProvider | null;
  calendarReady: boolean;
  cache: AccountCache;
  needsReauth: boolean;
  unreadCount: number;
}

const contexts = new Map<string, AccountContext>();
/** main측 활성 계정 — debug hook 기본 대상 + accounts.json activeEmail 미러(실계정 한정 영속). */
let activeEmail: string | null = null;

export function getContexts(): AccountContext[] { return [...contexts.values()]; }
export function getActiveEmail(): string | null { return activeEmail; }

function requireContext(accountId: string): AccountContext & { provider: GmailProvider } {
  const ctx = contexts.get(accountId);
  if (!ctx) throw new Error(`Unknown account ${accountId}`);
  if (!ctx.provider) throw new Error(`Account needs re-auth: ${accountId}`);
  return ctx as AccountContext & { provider: GmailProvider };
}

function requireCalendarProvider(accountId: string): CalendarProvider {
  const ctx = requireContext(accountId);
  if (!ctx.calendarProvider) throw new Error('Not signed in (calendar)');
  return ctx.calendarProvider;
}

export function accountsSnapshot(): AccountsSnapshot {
  return {
    accounts: getContexts().map((c) => ({
      email: c.email, demo: c.demo,
      calendarReady: c.demo ? (debugCalendarReady ?? true) : c.calendarReady,
      unreadCount: c.unreadCount, needsReauth: c.needsReauth,
    })),
    activeEmail,
  };
}

export function pushAccountsChanged(getWindow: () => BrowserWindow | null): void {
  getWindow()?.webContents.send('auth:accounts-changed', accountsSnapshot());
}

function makeRealContext(session: { client: Auth.OAuth2Client; email: string; calendarReady: boolean }): AccountContext {
  return {
    email: session.email, demo: false,
    provider: new RealGmailProvider(session.client, session.email),
    calendarProvider: new RealCalendarProvider(session.client, session.email),
    calendarReady: session.calendarReady,
    cache: new AccountCache(accounts.accountDbPath(session.email)),
    needsReauth: false, unreadCount: 0,
  };
}

function makeReauthContext(email: string): AccountContext {
  return {
    email, demo: false, provider: null, calendarProvider: null, calendarReady: false,
    cache: new AccountCache(accounts.accountDbPath(email)), needsReauth: true, unreadCount: 0,
  };
}

function makeDemoContext(email: string): AccountContext {
  return {
    email, demo: true,
    provider: new MockGmailProvider(email),
    calendarProvider: new MockCalendarProvider(),
    calendarReady: true,
    cache: new AccountCache(accounts.accountDbPath(email)),
    needsReauth: false, unreadCount: 0,
  };
}

/** 앱 부팅: accounts.json의 전 실계정 컨텍스트 복원. 토큰 실패 계정은 needsReauth로 격리(부분 실패 허용). */
export async function initAccounts(): Promise<void> {
  const file = accounts.readAccounts();
  for (const a of file.accounts) {
    if (a.demo) continue; // 데모는 비영속(D3) — 방어적 스킵
    try {
      const session = await auth.getAuthorizedClient(a.email);
      contexts.set(a.email, session ? makeRealContext(session) : makeReauthContext(a.email));
    } catch (err) {
      console.warn('[accounts] restore failed, marking needsReauth:', a.email, err);
      contexts.set(a.email, makeReauthContext(a.email));
    }
  }
  activeEmail = file.activeEmail && contexts.has(file.activeEmail)
    ? file.activeEmail
    : (getContexts()[0]?.email ?? null);
}
```

  핸들러 변환 규칙(전건 공통):
  - 모든 `mail:*`/`calendar:*` 핸들러 첫 인자에 `accountId: string` 추가, `requireProvider()` → `requireContext(accountId)`, `cache.X(…)` → `ctx.cache.X(…)`, `provider` → `ctx.provider`.
  - `pushThreadUpsert(threadId)` → `pushThreadUpsert(ctx, threadId)`; `notifyThreadsChanged(getWindow, { accountId: ctx.email, upserts, removals })`.
  - `attemptOrEnqueue(...)` 첫 인자에 `ctx: AccountContext & { provider: GmailProvider }` 추가 — 내부의 `cache.*` 5곳을 `ctx.cache.*`로.
  - `mail:fetch-threads`의 SWR 블록: `cache.getThreads/getViewRows/upsertThreads/applyLabelDelta/hasPendingMutations/localDeltaSince/isSnoozed` 전부 `ctx.cache.*`. `GRACE_MS = ctx.provider.demo ? 0 : 15_000` 로직 보존. `computeRevalidateDiff`의 `isSnoozed` 콜백은 `(id) => ctx.cache.isSnoozed(id)`로 바인딩.
  - `mail:fetch-thread`의 `resolveFollowup`: `ctx.cache.getFollowup/removeFollowup`, `meEmail = ctx.provider.email`.
  - `mail:send`: `pendingSends` 항목이 `{ timer, accountId }`를 저장; 타이머 콜백 내 `cache.*` 4곳(`addScheduledSend`, `addFollowup`, `applyLabelDelta`) → `ctx.cache.*`; `notifyThreadsChanged`에 `accountId: ctx.email`; `mail:mutation-permanent-failed` 페이로드에 `accountId: ctx.email` 추가.
  - `mail:cancel-send(accountId, sendId)`: 타이머 경로는 기존과 동일, 스케줄 경로는 `requireContext(accountId).cache.removeScheduledSend(sendId)`.
  - `mail:get-splits(accountId)`: `provider?.email` → `ctx.provider.email`; `vipEmails = ctx.demo && ctx.email === 'demo@zenmail.app' ? [DEMO_VIP_EMAIL] : []` (work 계정에 demo VIP 시드가 새지 않게).
  - `mail:get-setting`/`set-setting`(accountId, …) → `ctx.cache`; 신규 `settings:get-global`/`settings:set-global` → `accounts.getGlobalSetting/setGlobalSetting`.
  - followup 4종, `mail:search-local`, `mail:contacts` → `ctx.cache`.
  - `mail:renderer-online` 무변경(전역).

  auth 핸들러 신규:

```ts
  ipcMain.handle('auth:list-accounts', async (): Promise<AccountsSnapshot> => accountsSnapshot());

  ipcMain.handle('auth:add-account', async (): Promise<AccountsSnapshot> => {
    const email = await auth.signIn();
    const session = await auth.getAuthorizedClient(email);
    if (!session) throw new Error('Sign-in did not persist a session');
    contexts.get(email)?.cache.close(); // 재로그인(reauth)이면 기존 핸들 교체
    contexts.set(email, makeRealContext(session));
    accounts.addStoredAccount(email);
    if (!activeEmail) { activeEmail = email; accounts.setActiveEmail(email); }
    pushAccountsChanged(getWindow);
    return accountsSnapshot();
  });

  ipcMain.handle('auth:sign-in-demo', async (): Promise<AccountsSnapshot> => {
    for (const email of DEMO_ACCOUNT_EMAILS) {
      if (!contexts.has(email)) contexts.set(email, makeDemoContext(email));
    }
    activeEmail = DEMO_ACCOUNT_EMAILS[0]; // demo@zenmail.app — accounts.json엔 미영속(D3)
    debugCalendarReady = null;            // 새 데모 세션은 게이트 오버라이드 초기화(기존 E3 시맨틱 보존)
    pushAccountsChanged(getWindow);
    return accountsSnapshot();
  });

  ipcMain.handle('auth:remove-account', async (_e, email: string): Promise<AccountsSnapshot> => {
    const ctx = contexts.get(email);
    if (ctx) {
      if (!ctx.demo) await auth.signOut(email);
      ctx.cache.close();
      contexts.delete(email);
      // 계정 DB 파일 정리(원본 파괴는 명시적 제거 의도가 있는 이 경로에서만)
      for (const ext of ['', '-wal', '-shm']) {
        fs.rmSync(accounts.accountDbPath(email) + ext, { force: true });
      }
    }
    const file = accounts.removeStoredAccount(email);
    if (activeEmail === email) activeEmail = file.activeEmail ?? getContexts()[0]?.email ?? null;
    pushAccountsChanged(getWindow);
    return accountsSnapshot();
  });

  ipcMain.handle('auth:set-active-account', async (_e, email: string) => {
    if (!contexts.has(email)) throw new Error(`Unknown account ${email}`);
    activeEmail = email;
    accounts.setActiveEmail(email); // 미등록(데모) email이면 내부에서 no-op
  });
```

  debug 핸들러: 기존 `provider instanceof MockGmailProvider` 가드를 `const ctx = activeEmail ? contexts.get(activeEmail) : undefined;` + `ctx?.provider instanceof MockGmailProvider` 패턴으로. `mail:debug-set-online`은 **전 컨텍스트**의 mock provider에 `setOffline(!v)`; `mail:debug-queue-depth`는 `getContexts().reduce((n, c) => n + c.cache.mutationQueueDepth(), 0)`; `mail:debug-add-followup-due-now`는 active ctx의 cache. `mail:debug-simulate-reply`의 `notifyThreadsChanged`에 `accountId: ctx.email`.

  마지막으로 pending 집계 등록(registerIpc 진입부):

```ts
  registerPendingCounter(() =>
    getContexts().reduce(
      (n, c) => n + c.cache.mutationQueueDepth() + c.cache.overdueScheduledSendCount(Date.now()),
      0
    )
  );
```

  삭제: `let provider/calendarProvider/calendarReady`, `restoreSession`, `getProvider`, `requireProvider`, `auth:get-account`/`auth:sign-in`/`auth:sign-out` 핸들러, `cache.clearFollowups()/clearLocalDeltaTracking()` sign-out 호출(계정 제거가 캐시 파일 자체를 정리).
- [ ] **Step 5: snooze.ts 전 계정 순회** — 시그니처 교체 + 계정 루프(기존 4개 루프 본문은 `provider`→`ctx.provider`, cache 함수→`ctx.cache.*` 치환 외 무변경):

```ts
export function startSnoozeDaemon(
  getContexts: () => AccountContext[],
  getWindow: () => BrowserWindow | null
): void {
  stopSnoozeDaemon();
  const tick = async () => {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      const now = Date.now();
      for (const ctx of getContexts()) {
        if (!ctx.provider) continue; // needsReauth 계정은 스킵 — 다른 계정 순회 계속
        try {
          await tickAccount(ctx as AccountContext & { provider: GmailProvider }, getWindow, now);
        } catch (err) {
          console.error('[daemon] account tick failed', ctx.email, err); // 계정 간 격리
        }
      }
    } finally {
      tickInFlight = false;
    }
  };
  // …timer/onReconnect/tickFn 부기 기존 그대로…
}

async function tickAccount(ctx: AccountContext & { provider: GmailProvider }, getWindow: () => BrowserWindow | null, now: number): Promise<void> {
  const provider = ctx.provider;
  const c = ctx.cache;
  let changed = false;
  // 기존 4개 루프 이동: dueSnoozes → c.dueSnoozes(now), removeSnooze → c.removeSnooze, …
  // 이벤트 페이로드 변경:
  //   'mail:snooze-fired'  → { accountId: ctx.email, threadId }
  //   'mail:followup-fired' → { accountId: ctx.email, threadId }
  //   'mail:mutation-permanent-failed' → { accountId: ctx.email, threadId, kind }
  // depthBefore/emitSyncState, needsRefetch notifyThreadsChanged({ accountId: ctx.email, … }) 동일 위치 유지
}
```

  import를 `cache` 개별 함수 → `type { AccountContext } from './ipc'`로 교체(순환 주의: ipc가 snooze의 `runDaemonTickNow`를 import하는 기존 구조 유지 — type-only import는 순환 무해).
- [ ] **Step 6: index.ts 부팅 시퀀스**:

```ts
import { getGlobalSetting, migrateLegacyLayout } from './accounts';
import { registerIpc, getContexts, initAccounts } from './ipc';
import { startSnoozeDaemon, stopSnoozeDaemon } from './snooze';
// (openCache/getSetting import 삭제)

// createWindow 내: backgroundColor: getGlobalSetting('theme') === 'dark' ? '#0f0f0f' : '#ffffff'

app.whenReady().then(async () => {
  migrateLegacyLayout();
  await initAccounts();
  registerIpc(() => mainWindow);
  startSnoozeDaemon(getContexts, () => mainWindow);
  createWindow();
  // …activate 기존 그대로…
});
```

- [ ] **Step 7: cache.ts 레거시 심 삭제** — Task 3에서 넣은 `LEGACY SHIM` 블록 전체 제거. `grep -n "getDefaultCache\|openCache" src/main` 으로 잔존 참조 0 확인.
- [ ] **Step 8: preload.ts 재작성** — 최종 계약 1:1 매핑(전 데이터 메서드 `(accountId, …) => ipcRenderer.invoke(channel, accountId, …)`), 신규 `listAccounts/addAccount/removeAccount/setActiveAccount/getGlobalSetting/setGlobalSetting/onAccountsChanged` 추가, `getAccount/signIn/signOut` 제거. 이벤트 리스너 페이로드 타입을 계약대로(객체+accountId). debug 훅 블록 무변경.
- [ ] **Step 9: store/mail.ts 전환** — 상태·액션:

```ts
interface MailState {
  accounts: AccountInfo[];
  activeAccountId: string | null;
  accountLoading: boolean;
  authError: string | null;
  // …(account: AccountInfo | null 삭제, 나머지 기존 유지)…
  init(): Promise<void>;
  addAccount(): Promise<void>;      // 구 signIn 대체 (Login 버튼·계정 추가 공용)
  signInDemo(): Promise<void>;
  removeAccount(email: string): Promise<void>; // 구 signOut 대체
  switchAccount(email: string): Promise<void>;
  applyAccountsSnapshot(snap: AccountsSnapshot): void;
  // …
}

/** 활성 계정 셀렉터 — 구 `s.account` 참조처의 대체. */
export function activeAccount(s: Pick<MailState, 'accounts' | 'activeAccountId'>): AccountInfo | null {
  return s.accounts.find((a) => a.email === s.activeAccountId) ?? null;
}

/** 데이터 액션 진입 시점의 활성 계정 id — 없으면 로그인 전이므로 액션은 조용히 반환. */
function aid(s: MailState): string | null {
  return s.activeAccountId;
}
```

  핵심 액션 구현:

```ts
    /** 계정 종속 슬라이스 리셋 — 전환·제거 공용. threads/선택/상세/스플릿/검색/팔로우업/캘린더/벌크. */
    // (모듈 스코프 상수로) 
    const ACCOUNT_SCOPED_RESET = {
      labels: [] as Label[], threads: [] as ThreadSummary[], nextPageToken: undefined,
      activeThreadId: null, activeThread: null, threadLoading: false, selectedIndex: 0,
      splitDefs: [] as SplitDefinition[], activeSplitTab: INBOX_TAB,
      searchQuery: '', bulkSelectedIds: new Set<string>(),
      followups: new Map<string, FollowupInfo>(), rsvpStatus: new Map<string, RsvpResponse>(),
      snippets: [] as SnippetRecord[],
      agendaOpen: false, agendaEvents: [] as CalendarEvent[], agendaLoading: false, agendaError: null,
      composeInit: null, snoozePickerOpen: false, labelPickerOpen: false, followupPickerOpen: false,
      eventComposerOpen: false, splitSettingsOpen: false, snippetsOpen: false,
    };

    async loadActiveAccountData() { // private helper (스토어 내부 함수로)
      await Promise.all([get().loadLabels(), get().loadThreads(), loadSplitState(), get().refreshFollowups(), get().loadSnippets()]);
    }

    async init() {
      try {
        if ((await api().getGlobalSetting('theme')) === 'dark') get().setTheme('dark', { persist: false });
      } catch { /* default light */ }
      api().onFollowupFired((p) => {
        if (p.accountId !== get().activeAccountId) return; // 비활성 계정 발화는 배지(accounts-changed)로만
        const thread = get().threads.find((t) => t.id === p.threadId);
        get().showToast(thread ? `No reply yet — "${thread.subject}" is back` : 'No reply yet — thread is back in your inbox');
        void get().refreshFollowups();
      });
      try {
        const snap = await api().listAccounts();
        set({ accounts: snap.accounts, activeAccountId: snap.activeEmail, accountLoading: false });
        if (snap.activeEmail) await loadActiveAccountData();
      } catch (err) {
        set({ accountLoading: false, authError: String(err) });
      }
    },

    applyAccountsSnapshot(snap) {
      set((st) => ({
        accounts: snap.accounts,
        // 활성 계정이 제거된 스냅샷이면 main이 정한 activeEmail로 따라간다(switchAccount가 후속 로드)
        activeAccountId: snap.accounts.some((a) => a.email === st.activeAccountId)
          ? st.activeAccountId
          : snap.activeEmail,
      }));
    },

    async switchAccount(email) {
      const s = get();
      if (email === s.activeAccountId || !s.accounts.some((a) => a.email === email)) return;
      set({ activeAccountId: email, ...ACCOUNT_SCOPED_RESET });
      void api().setActiveAccount(email);
      await loadActiveAccountData(); // 계정별 캐시 SWR — 첫 페인트는 로컬에서 즉시
    },

    async addAccount() {
      set({ authError: null });
      try {
        const snap = await api().addAccount();
        get().applyAccountsSnapshot(snap);
        // 첫 로그인(이전에 계정 0)이면 새 계정으로 진입
        if (!get().activeAccountId && snap.activeEmail) {
          set({ activeAccountId: snap.activeEmail });
        }
        if (get().activeAccountId) await loadActiveAccountData();
      } catch (err) {
        set({ authError: err instanceof Error ? err.message : String(err) });
      }
    },

    async signInDemo() {
      const snap = await api().signInDemo();
      set({ accounts: snap.accounts, activeAccountId: snap.activeEmail, authError: null });
      await loadActiveAccountData();
    },

    async removeAccount(email) {
      const snap = await api().removeAccount(email);
      if (snap.accounts.length === 0) {
        set({ accounts: [], activeAccountId: null, ...ACCOUNT_SCOPED_RESET });
        return;
      }
      const wasActive = get().activeAccountId === email;
      set({ accounts: snap.accounts });
      if (wasActive) {
        set({ activeAccountId: snap.activeEmail, ...ACCOUNT_SCOPED_RESET });
        await loadActiveAccountData();
      }
    },
```

  콜사이트 치환(전건 — `api().X(…)` → `api().X(a, …)` 패턴, `const a = aid(get()); if (!a) return;` 가드):
  - `loadSplitState`: `getSplits(a)`, `getSetting(a, 'splitInbox')`, `getSetting(a, 'activeSplitTab')`
  - `loadLabels`/`loadThreads`/`loadMore`: `fetchLabels(a)` / `fetchThreads(a, {…})`
  - `toggleSplit`/`switchTab`: `setSetting(a, 'splitInbox' | 'activeSplitTab', …)`
  - `saveSplits`: `setSplits(a, defs)`
  - `openThread`: `fetchThread(a, id)`
  - `archiveThread`/`trashThread`/`toggleStar`(3분기)/`markRead`/`applyLabel`: `modifyLabels(a, req)`
  - `snoozeThread`: `snooze(a, req)`
  - `send(req)`: `const a = get().composeInit?.accountId ?? aid(get()); …api().send(a, req)` + `pendingSend: { sendId, accountId: a, expiresAt }` (D5 — 열림 시점 계정으로 발신)
  - `openCompose(init)`: `accountId: get().activeAccountId!` 채움 (`ComposeInit`에 `accountId: string` 추가)
  - `undoSend`: `cancelSend(pending.accountId, pending.sendId)`
  - followup 4곳: `addFollowup(a, id, days)` 등; `refreshFollowups`: `listFollowups(a)`
  - 캘린더 3곳: `respondToInvite`→`respondToEvent(a, …)`, `openAgenda`→`listEvents(a, …)`, `createCalendarEvent`→`createEvent(a, input)`
  - `loadSnippets`/`saveSnippets`: `getSetting(a, SNIPPETS_KEY)` / `setSetting(a, SNIPPETS_KEY, …)`
  - `setTheme`: `setSetting('theme')` → `setGlobalSetting('theme', theme)`
  - `openReply`의 `const me = get().account?.email` → `activeAccount(get())?.email`
  - calendarReady 게이트 4곳(`respondToInvite`/`openAgenda`/`openEventComposer`/`createCalendarEvent`): `get().account?.calendarReady` → `activeAccount(get())?.calendarReady`
  - 구 `signIn`/`signOut` 액션 삭제(위 신규로 대체)
- [ ] **Step 10: useThreads.ts** — accountId 필터 + accounts-changed 구독:

```ts
export function useThreads(): void {
  const signedIn = useMailStore((s) => !!s.activeAccountId);

  useEffect(() => {
    if (!signedIn) return;
    const { refresh, showToast, refreshFollowups } = useMailStore.getState();
    const isActive = (accountId: string) => useMailStore.getState().activeAccountId === accountId;

    const offChanged = window.zenmail.onThreadsChanged((p) => {
      if (!isActive(p.accountId)) return; // 비활성 계정 diff/refetch는 무시 — 배지는 accounts-changed가 담당
      // …기존 needsRefetch/diff 분기 그대로…
    });
    const offSnooze = window.zenmail.onSnoozeFired((p) => {
      if (isActive(p.accountId)) showToast('A snoozed thread is back');
    });
    const offAccounts = window.zenmail.onAccountsChanged((snap) => {
      useMailStore.getState().applyAccountsSnapshot(snap);
    });
    const offMutationPermanentFailed = window.zenmail.onMutationPermanentFailed((p) => {
      if (!isActive(p.accountId)) return;
      showToast('Sync failed — changes reverted');
      void refresh();
    });
    const offThreadChanged = window.zenmail.onThreadChanged((p) => {
      if (!isActive(p.accountId)) return;
      if (useMailStore.getState().activeThreadId === p.threadId) {
        useMailStore.setState({ activeThread: p.detail });
      }
    });
    // …poll/online/cleanup 기존 그대로 (+ offAccounts cleanup 추가)…
  }, [signedIn]);
}
```

- [ ] **Step 11: 나머지 renderer 참조** —
  - `App.tsx`: `const account = useMailStore((s) => s.account)` → `const signedIn = useMailStore((s) => !!s.activeAccountId)`; `if (!signedIn) return <Login />`.
  - `Login.tsx`: `signIn` → `addAccount` (구조 동일).
  - `Sidebar.tsx`: `account` 참조 2곳 → `const account = useMailStore(activeAccount)` (import한 셀렉터 사용, zustand 셀렉터로 직접 전달 가능: `useMailStore((s) => activeAccount(s))`); `signOut` 버튼 → `removeAccount(activeAccountId)` 호출로 교체(계정 UI 본격 신설은 Task 7).
  - `Compose.tsx`: `window.zenmail.listContacts(q)` → `window.zenmail.listContacts(useMailStore.getState().activeAccountId!, q)` (컴포넌트에서 `activeAccountId` 구독 후 전달), `getSetting/setSetting(FOLLOWUP_DEFAULT_DAYS_KEY)` 2곳도 동일하게 accountId 전달.
- [ ] **Step 12: 검증** — Run: `npx tsc --noEmit` → 0 error. Run: `npm test` → PASS. Run: `grep -rn "getAccount\|'auth:sign-in'\|'auth:sign-out'\|getStoredEmail" src/` → 0건.
- [ ] **Step 13: 데모 스모크** — `npm start` → 데모 로그인 → 인박스 렌더·아카이브·스누즈 픽커 동작 확인(단일 활성 계정 경로 무회귀), 종료.
- [ ] **Step 14: E2E 회귀** — Run: `node e2e/run-tc.mjs` → **캐논 무회귀 필수**(0 FAIL, SKIP ⊆ {A4,D5,D8,SY-C3,SA-B4,SY-B2}). FAIL 시 이 태스크에서 수습(최상류 FAIL부터 — DEV_WORKFLOW 교훈).
- [ ] **Step 15: Commit + push**

```bash
git add -A && git commit -m "feat(multi-account): AccountContext Map·계정별 캐시·IPC accountId 계약 대전환 (데몬 전 계정 순회 포함)"
git push origin main
```

---

### Task 6: 배지·accounts-changed 데몬 push

**Files:**
- Modify: `zenmail/src/main/snooze.ts`
- Modify: `zenmail/src/main/ipc.ts` (배지 시딩 헬퍼)
- Modify: `zenmail/src/main/index.ts` (`startSnoozeDaemon` 콜백 인자 추가 반영)

**Interfaces:**
- Consumes: Task 4 `GmailProvider.inboxUnreadCount()`, Task 5 `AccountContext.unreadCount`/`pushAccountsChanged`
- Produces: 데몬 틱마다 배지 최신화 — `auth:accounts-changed` push (renderer 구독은 Task 5에서 이미 연결됨)

- [ ] **Step 1: 데몬 틱 말미에 배지 갱신 루프 추가** — `startSnoozeDaemon`의 tick에서 계정 순회 후:

```ts
      // 배지: 전 계정 INBOX 안읽음 수 갱신(1콜/계정/분, D7) — 값이 하나라도 바뀌면 스냅샷 push
      let badgeChanged = false;
      for (const ctx of getContexts()) {
        if (!ctx.provider) continue;
        try {
          const n = await ctx.provider.inboxUnreadCount();
          if (n !== ctx.unreadCount) {
            ctx.unreadCount = n;
            badgeChanged = true;
          }
        } catch {
          /* transient — 다음 틱에 재시도, 배지는 이전 값 유지 */
        }
      }
      if (badgeChanged) pushAccountsChanged(getWindow);
```

  (ipc.ts에서 `pushAccountsChanged`·`getContexts` import — snooze는 이미 ipc의 type을 쓰므로 순환은 runtime import 1방향(snooze→ipc)이 되지 않게, `startSnoozeDaemon` 시그니처에 `pushAccounts: () => void` 콜백을 추가로 받아 index.ts에서 `() => pushAccountsChanged(() => mainWindow)`로 주입한다. **콜백 주입이 정본** — 직접 import 금지.)
- [ ] **Step 2: 로그인/데모 진입 직후 1회 배지 시딩** — `auth:add-account`/`auth:sign-in-demo` 핸들러 말미에 `void refreshBadges()` (ipc.ts 내부 헬퍼: Step 1과 동일 루프 + pushAccountsChanged). 데몬 첫 틱을 기다리지 않고 초기 배지 표시.
- [ ] **Step 3: 검증** — `npx tsc --noEmit` 0 error. `npm start` 데모: 로그인 직후 사이드바(Task 7 전이므로 콘솔로) — `getContexts()` 로그 대신, 데모에서 `window.zenmail.listAccounts()`를 DevTools로 호출해 `unreadCount > 0` 확인(demo 시드 안읽음 7건, work 시드 2건).
- [ ] **Step 4: Commit**

```bash
git add src/main/snooze.ts src/main/ipc.ts src/main/index.ts
git commit -m "feat(multi-account): 데몬 틱 배지 갱신 + accounts-changed push (로그인 직후 1회 시딩 포함)"
```

---

### Task 7: 전환 UI — 사이드바 계정 섹션 + ⌃1~⌃9 + kbar

**Files:**
- Modify: `zenmail/src/renderer/components/Sidebar.tsx`
- Modify: `zenmail/src/renderer/hooks/useKeyboard.ts`
- Modify: `zenmail/src/renderer/components/CommandPalette.tsx`
- Modify: `zenmail/src/renderer/components/CheatSheet.tsx` (단축키 표 1행 추가)

**Interfaces:**
- Consumes: store `accounts`/`activeAccountId`/`switchAccount`/`addAccount`/`removeAccount`, `activeAccount` 셀렉터

- [ ] **Step 1: Sidebar 계정 섹션** — drag region 바로 아래(`<nav>` 위)에 삽입. 기존 하단 account/signOut 블록의 email 표기는 유지하되 Sign out 버튼은 활성 계정 제거로 동작(이미 Task 5에서 교체됨):

```tsx
function AccountAvatar({ acct, index, active, onClick }: {
  acct: AccountInfo; index: number; active: boolean; onClick: () => void;
}) {
  const initial = (acct.demo ? acct.email.split('@')[0] : acct.email)[0]?.toUpperCase() ?? '?';
  return (
    <button
      onClick={onClick}
      title={`${acct.email} (⌃${index + 1})${acct.needsReauth ? ' — 재로그인 필요' : ''}`}
      aria-label={`Switch to ${acct.email}`}
      className={`relative flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition-colors ${
        active ? 'bg-accent text-white' : 'bg-bg-border text-text-secondary hover:text-text-primary'
      }`}
    >
      {acct.needsReauth ? '!' : initial}
      {acct.unreadCount > 0 && !active && (
        <span className="absolute -top-1 -right-1 min-w-[16px] rounded-full bg-accent px-1 text-center text-[9px] leading-4 text-white">
          {acct.unreadCount > 99 ? '99+' : acct.unreadCount}
        </span>
      )}
    </button>
  );
}
```

  `Sidebar()` 본문:

```tsx
  const accounts = useMailStore((s) => s.accounts);
  const activeAccountId = useMailStore((s) => s.activeAccountId);
  const switchAccount = useMailStore((s) => s.switchAccount);
  const addAccount = useMailStore((s) => s.addAccount);
  // …기존 구독 유지…

  {/* 계정 스위처 — drag region 아래 */}
  {accounts.length > 0 && (
    <div className="flex items-center gap-1.5 px-3 pb-2">
      {accounts.map((a, i) => (
        <AccountAvatar
          key={a.email} acct={a} index={i} active={a.email === activeAccountId}
          onClick={() => {
            if (a.needsReauth) void addAccount(); // D4: reauth = OAuth 재실행
            else void switchAccount(a.email);
          }}
        />
      ))}
      <button
        onClick={() => void addAccount()}
        title="Add account"
        aria-label="Add account"
        className="flex h-7 w-7 items-center justify-center rounded-full text-[13px] text-text-muted hover:bg-bg-border hover:text-text-primary"
      >
        +
      </button>
    </div>
  )}
```

- [ ] **Step 2: useKeyboard ⌃1~⌃9** — 기존 ⌘1~⌘9 블록(useKeyboard.ts:48) 바로 아래에(동일 배치 규칙 — isTyping 가드보다 위):

```ts
      // ⌃1~⌃9 — 계정 전환 (kbar 미등록: Tab 주석과 동일한 이중발화 회피. ⌘digit=스플릿과 수식키로 구분)
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
        const target = s.accounts[Number(e.code.slice(5)) - 1];
        if (target && target.email !== s.activeAccountId && !target.needsReauth) {
          e.preventDefault();
          void s.switchAccount(target.email);
          useCoachStore.getState().recordEfficient('switchAccount');
        }
        return;
      }
```

- [ ] **Step 3: kbar 동적 계정 액션** — CommandPalette.tsx에 `useRegisterActions` 컴포넌트 추가(정적 배열은 무수정):

```tsx
import { useRegisterActions } from 'kbar';

/** 계정 목록은 런타임 가변 — 정적 actions 배열 대신 useRegisterActions로 등록/갱신 */
function AccountActions() {
  const accounts = useMailStore((s) => s.accounts);
  const activeAccountId = useMailStore((s) => s.activeAccountId);
  const actions = useMemo<Action[]>(() => {
    const s = useMailStore.getState;
    return [
      ...accounts.map((a, i) => ({
        id: `switchAccount:${a.email}`,
        name: `Switch to ${a.email}${a.email === activeAccountId ? ' (current)' : ''}`,
        section: 'Accounts',
        // 단축키는 useKeyboard 소유(⌃N) — kbar shortcut 등록 금지(이중발화)
        perform: () => {
          if (a.needsReauth) void s().addAccount();
          else void s().switchAccount(a.email);
        },
      })),
      { id: 'addAccount', name: 'Add account…', section: 'Accounts', perform: () => void s().addAccount() },
      ...(activeAccountId
        ? [{
            id: 'removeAccount',
            name: `Sign out of ${activeAccountId}`,
            section: 'Accounts',
            perform: () => void s().removeAccount(activeAccountId),
          }]
        : []),
    ];
  }, [accounts, activeAccountId]);
  useRegisterActions(actions, [actions]);
  return null;
}
```

  `KBarProvider` 자식 최상단에 `<AccountActions />` 배치(`<KBarPortal>` 앞).
- [ ] **Step 4: CheatSheet 갱신** — 단축키 표에 `⌃1–9 · Switch account` 1행 추가(파일 내 기존 표기 관례를 따름 — 구현 시 CheatSheet.tsx를 읽고 동일 구조로).
- [ ] **Step 5: 검증** — `npx tsc --noEmit` 0 error. `npm start` 데모 스모크: 아바타 2개+배지, ⌃2 전환 시 work 리스트(`W:` subjects), ⌃1 복귀, kbar에서 "Switch to work@zenmail.app" 동작, `+` 클릭 시 real OAuth 미설정 환경이면 authError 노출(크래시 없음) 확인.
- [ ] **Step 6: Commit + push**

```bash
git add src/renderer/
git commit -m "feat(multi-account): 사이드바 계정 스위처(아바타·배지·reauth) + ⌃1~9 + kbar 계정 액션"
git push origin main
```

---

### Task 8: E2E — TC-MA 스위트 + 전체 회귀

**Files:**
- Modify: `zenmail/e2e/run-tc.mjs` (TC-MA 섹션 추가 — 기존 시나리오 함수·record 관례 준수)
- Modify: `docs/features/multi-account/TC.md` (결과 반영)

**Interfaces:**
- Consumes: ⌃1/⌃2 키 전환(CDP `keyboard.down('Control')` + `press('2')`), work 시드(`W:` subject 접두), `__debugTick`, `__debugSimulateReply`(active ctx 대상 — work 계정 시나리오는 **work로 전환한 상태에서** 호출), 사이드바 aria-label(`Switch to <email>`, `Add account`)

- [ ] **Step 1: 하네스에 계정 전환 헬퍼 추가** — 기존 헬퍼 구역에:

```js
async function switchAccount(page, n) {
  await page.keyboard.down('Control');
  await page.keyboard.press(`Digit${n}`);
  await page.keyboard.up('Control');
  // 전환 리셋 후 리스트 재로드 — 행이 그려질 때까지 폴링
  await waitFor(async () => (await threadRowCount(page)) > 0, 8000);
}
```

  (`threadRowCount`/`waitFor`는 기존 하네스 유틸 재사용 — 실제 이름은 구현 시 run-tc.mjs 상단에서 확인해 맞춘다.)
- [ ] **Step 2: TC-MA 시나리오 구현** — Task 1 TC.md의 7건(A1~A3, B1~B2, C1, D1). 각 TC의 판정 원칙:
  - A1: `listAccounts` debug 우회 없이 **사이드바 aria-label 2건**(demo·work) + 기존 인박스 첫 행 subject가 데모 시드와 일치.
  - A2: ⌃2 후 `bodyText`에 `W: Acme renewal contract` 포함 ∧ 데모 고유 subject(`Q3 roadmap review`) 미포함.
  - A3: ⌃1 후 그 역.
  - B1: work에서 `W: Kickoff notes` 행에 j/k 선택→`e` 아카이브 → ⌃1 → demo 리스트 카운트 불변 → ⌃2 → work 리스트에서 해당 subject 부재(계정별 캐시 유지 확인은 재전환로 충분 — 재시작까지는 요구하지 않음).
  - B2: work에서 스레드 스누즈(SnoozePicker의 커스텀/최단 옵션 사용 — 기존 TC-SN 시나리오의 픽커 조작 코드 재사용) 후 ⌃1(demo) → `__debugTick`(전 계정 데몬) → ⌃2 → 해당 스레드 인박스 복귀. **스누즈 due를 과거로 만들기 위해 기존 스위트가 쓰는 방법(TC-SN·TC-SY의 due 조작 관례)을 그대로 따른다** — 구현 시 run-tc.mjs의 기존 스누즈 TC를 먼저 읽고 동일 기법 사용.
  - C1: demo 활성에서 검색(`/` → `W:` 입력) 결과 0건 ∧ Compose to-필드 자동완성에 `client@acme.example` 미노출(기존 연락처 자동완성 TC 조작 코드 재사용).
  - D1: demo 활성 → ⌃2 → `__debugSimulateReply('work_3')` → ⌃1 → `__debugTick` → 사이드바 work 아바타 배지 텍스트 증가 확인(aria-label/`title` 셀렉터).
- [ ] **Step 3: 전체 스위트 2연속 실행** — Run: `node e2e/run-tc.mjs` ×2 / Expected: TC-MA 7건 PASS 포함 **0 FAIL, SKIP ⊆ {A4,D5,D8,SY-C3,SA-B4,SY-B2}, 총계 정합** ×2. FAIL 시 최상류부터 수습(mid-abort 하류 오염 주의 — DEV_WORKFLOW 교훈).
- [ ] **Step 4: TC.md에 결과 기록 + Commit + push**

```bash
git add e2e/run-tc.mjs ../docs/features/multi-account/TC.md
git commit -m "test(multi-account): TC-MA E2E 7건(전환·격리·비활성 데몬·배지) + 전체 스위트 무회귀"
git push origin main
```

---

### Task 9: 마무리 — 리뷰 게이트·문서·Obsidian

**Files:**
- Modify: `docs/features/multi-account/TODO.md`, `DECISIONS.md` (전건 체크·결정 최종화)
- Modify: `docs/DEV_WORKFLOW.md` (현재 상태 스냅샷 추가)
- Modify: `TODO.md` (루트)
- Modify: `PRD.md` §Non-Goals 인접, `docs/MAIL_APP_SPEC.md` §6 — 단일 계정 전제 문구에 multi-account 반영 각주
- Modify: `/Users/claud_01/Documents/flo/_obsidian/Projects/ZenMail.md` + vault `index.md` Active Projects 날짜

- [ ] **Step 1: 리뷰 게이트 실행** — `/react-best-practices` (renderer 변경분: store/mail.ts, Sidebar, CommandPalette, useKeyboard, useThreads, Compose) + `/code-review low` (전체 diff). 지적사항 수정 후 재실행. (/impeccable 미설치 시 F1 D14 선례대로 react-best-practices+code-review+E2E 실측으로 대체.)
- [ ] **Step 2: 문서 갱신** — DEV_WORKFLOW 스냅샷(E2E 캐논 총계 갱신: 기존 189 + TC-MA 7), 루트 TODO.md, PRD/SPEC 각주, feature TODO 전건 체크.
- [ ] **Step 3: Obsidian 체크포인트** — ZenMail.md에 multi-account 마일스톤 추가 + index.md 날짜 갱신.
- [ ] **Step 4: 최종 커밋 + push**

```bash
git add -A && git commit -m "docs(multi-account): Goal 8 완료 — 스냅샷·TODO·Obsidian 체크포인트"
git push origin main
```

---

## Self-Review 결과 (플랜 작성 시 수행)

1. **스펙 커버리지**: 계정 모델·인증(T2/T5) / AccountContext Map(T5) / 계정별 캐시(T3/T5) / 데몬 순회+배지(T5/T6) / IPC 계약(T5) / store·전환(T5) / UI(T7) / 데모 2계정·E2E(T4/T8) / 마이그레이션·에러 격리(T2/T5) / 문서 갱신(T1/T9) — 전 섹션 태스크 매핑 확인.
2. **플레이스홀더**: 기존 코드 "그대로 이동" 지시는 원본 파일·행이 특정된 기계적 치환(치환 규칙 명시)으로 한정 — 신규 로직은 전부 코드 제시.
3. **타입 일관성**: `AccountsSnapshot`/`AccountContext`/`activeAccount`/`aid`/`switchAccount` 명칭을 태스크 간 교차 확인. 이벤트 페이로드 형태(객체+accountId)는 최종 계약 블록이 단일 진실 소스.
