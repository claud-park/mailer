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
 *  - account.json이 있으면: zenmail.db(+-wal/-shm)를 계정 스코프 파일명으로 rename(all-or-nothing) →
 *    성공 시에만 그 email을 첫 실계정으로 등록(accounts.json 커밋) → settings.theme를 전역
 *    settings.json으로 best-effort 복사 → account.json 삭제.
 *  - 어느 쪽도 없으면 빈 레지스트리 생성.
 * DB rename이 중간에 실패하면 이미 옮긴 파일을 역순으로 원위치 롤백하고 accounts.json은 쓰지
 * 않는다(= 다음 실행 시 최상단 accounts.json 가드에 걸리지 않아 자동 재시도됨). rename 이후
 * 단계(테마 복사·account.json 삭제)의 실패는 계정 등록/DB 자체는 이미 유효하므로 best-effort로
 * 경고만 남긴다.
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
  const target = accountDbPath(legacyEmail);
  // 1) DB rename을 먼저, all-or-nothing으로. 중간 실패 시 옮긴 파일을 역순 롤백하고
  //    accounts.json을 쓰지 않은 채 return — 다음 실행에서 재시도 가능한 상태로 남긴다.
  if (fs.existsSync(LEGACY_DB_FILE()) && !fs.existsSync(target)) {
    const moved: Array<{ src: string; dest: string }> = [];
    try {
      for (const ext of ['', '-wal', '-shm']) {
        const src = LEGACY_DB_FILE() + ext;
        const dest = target + ext;
        if (fs.existsSync(src)) {
          fs.renameSync(src, dest);
          moved.push({ src, dest });
        }
      }
    } catch (err) {
      for (const { src, dest } of moved.reverse()) {
        try {
          fs.renameSync(dest, src);
        } catch {
          /* best-effort rollback */
        }
      }
      console.warn('[accounts] legacy db rename failed — migration deferred to next launch:', err);
      return;
    }
  }
  // 2) rename이 성공(또는 애초에 불필요)했을 때만 레지스트리를 커밋.
  writeAccounts({ accounts: [{ email: legacyEmail, demo: false }], activeEmail: legacyEmail });
  // 3) 테마 복사 + account.json 삭제는 best-effort — 실패해도 계정 등록/DB는 이미 유효하다.
  try {
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
