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
