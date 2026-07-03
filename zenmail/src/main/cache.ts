import path from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import type {
  Contact,
  MessageDetail,
  SendRequest,
  SplitDefinition,
  ThreadDetail,
  ThreadSummary,
} from '../shared/types';

let db: Database.Database | null = null;

export function openCache(): Database.Database {
  if (db) return db;
  const file = path.join(app.getPath('userData'), 'zenmail.db');
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL DEFAULT '',
      from_name TEXT NOT NULL DEFAULT '',
      from_email TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      date INTEGER NOT NULL DEFAULT 0,
      unread INTEGER NOT NULL DEFAULT 0,
      label_ids TEXT NOT NULL DEFAULT '[]',
      message_count INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
    CREATE TABLE IF NOT EXISTS snoozes (
      thread_id TEXT PRIMARY KEY,
      until INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scheduled_sends (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      send_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contacts (
      email TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      last_seen INTEGER NOT NULL DEFAULT 0
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS threads_fts USING fts5(
      id UNINDEXED, subject, from_name, from_email, snippet
    );
    CREATE TABLE IF NOT EXISTS splits (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, rule TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}

function rowToSummary(r: Record<string, unknown>): ThreadSummary {
  return {
    id: r.id as string,
    subject: r.subject as string,
    from: { name: r.from_name as string, email: r.from_email as string },
    snippet: r.snippet as string,
    date: r.date as number,
    unread: !!(r.unread as number),
    labelIds: JSON.parse(r.label_ids as string),
    messageCount: r.message_count as number,
  };
}

export function upsertThreads(threads: ThreadSummary[]): void {
  const d = openCache();
  const up = d.prepare(`
    INSERT INTO threads (id, subject, from_name, from_email, snippet, date, unread, label_ids, message_count, updated_at)
    VALUES (@id, @subject, @fromName, @fromEmail, @snippet, @date, @unread, @labelIds, @messageCount, @now)
    ON CONFLICT(id) DO UPDATE SET
      subject=excluded.subject, from_name=excluded.from_name, from_email=excluded.from_email,
      snippet=excluded.snippet, date=excluded.date, unread=excluded.unread,
      label_ids=excluded.label_ids, message_count=excluded.message_count, updated_at=excluded.updated_at
  `);
  const delFts = d.prepare('DELETE FROM threads_fts WHERE id = ?');
  const insFts = d.prepare(
    'INSERT INTO threads_fts (id, subject, from_name, from_email, snippet) VALUES (?, ?, ?, ?, ?)'
  );
  const upContact = d.prepare(`
    INSERT INTO contacts (email, name, last_seen) VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET name=excluded.name, last_seen=MAX(last_seen, excluded.last_seen)
  `);
  const now = Date.now();
  d.transaction(() => {
    for (const t of threads) {
      up.run({
        id: t.id,
        subject: t.subject,
        fromName: t.from.name,
        fromEmail: t.from.email,
        snippet: t.snippet,
        date: t.date,
        unread: t.unread ? 1 : 0,
        labelIds: JSON.stringify(t.labelIds),
        messageCount: t.messageCount,
        now,
      });
      delFts.run(t.id);
      insFts.run(t.id, t.subject, t.from.name, t.from.email, t.snippet);
      if (t.from.email) upContact.run(t.from.email, t.from.name, t.date);
    }
  })();
}

export function cacheThreadDetail(detail: ThreadDetail): void {
  const d = openCache();
  const up = d.prepare(
    'INSERT INTO messages (id, thread_id, payload) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload'
  );
  const upContact = d.prepare(`
    INSERT INTO contacts (email, name, last_seen) VALUES (?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET name=excluded.name, last_seen=MAX(last_seen, excluded.last_seen)
  `);
  d.transaction(() => {
    for (const m of detail.messages) {
      up.run(m.id, detail.id, JSON.stringify(m));
      for (const c of [m.from, ...m.to, ...m.cc]) {
        if (c.email) upContact.run(c.email, c.name, m.date);
      }
    }
  })();
}

export function getCachedThreadDetail(threadId: string): MessageDetail[] {
  const d = openCache();
  const rows = d
    .prepare('SELECT payload FROM messages WHERE thread_id = ?')
    .all(threadId) as { payload: string }[];
  return rows
    .map((r) => JSON.parse(r.payload) as MessageDetail)
    .sort((a, b) => a.date - b.date);
}

export function searchLocal(q: string): ThreadSummary[] {
  const d = openCache();
  const term = q
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replace(/"/g, '""')}"*`)
    .join(' ');
  if (!term) return [];
  const rows = d
    .prepare(
      `SELECT t.* FROM threads_fts f JOIN threads t ON t.id = f.id
       WHERE threads_fts MATCH ? ORDER BY t.date DESC LIMIT 50`
    )
    .all(term) as Record<string, unknown>[];
  return rows.map(rowToSummary);
}

export function listContacts(prefix: string): Contact[] {
  const d = openCache();
  const rows = d
    .prepare(
      `SELECT email, name FROM contacts
       WHERE email LIKE ? OR name LIKE ?
       ORDER BY last_seen DESC LIMIT 8`
    )
    .all(`%${prefix}%`, `%${prefix}%`) as { email: string; name: string }[];
  return rows.map((r) => ({ email: r.email, name: r.name }));
}

// --- snoozes ---

export function addSnooze(threadId: string, until: number): void {
  openCache()
    .prepare(
      'INSERT INTO snoozes (thread_id, until) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET until=excluded.until'
    )
    .run(threadId, until);
}

export function dueSnoozes(now: number): { threadId: string }[] {
  const rows = openCache()
    .prepare('SELECT thread_id FROM snoozes WHERE until <= ?')
    .all(now) as { thread_id: string }[];
  return rows.map((r) => ({ threadId: r.thread_id }));
}

export function removeSnooze(threadId: string): void {
  openCache().prepare('DELETE FROM snoozes WHERE thread_id = ?').run(threadId);
}

// --- scheduled sends ---

export function addScheduledSend(id: string, payload: SendRequest, sendAt: number): void {
  openCache()
    .prepare('INSERT INTO scheduled_sends (id, payload, send_at) VALUES (?, ?, ?)')
    .run(id, JSON.stringify(payload), sendAt);
}

export function dueScheduledSends(now: number): { id: string; payload: SendRequest }[] {
  const rows = openCache()
    .prepare('SELECT id, payload FROM scheduled_sends WHERE send_at <= ?')
    .all(now) as { id: string; payload: string }[];
  return rows.map((r) => ({ id: r.id, payload: JSON.parse(r.payload) as SendRequest }));
}

export function removeScheduledSend(id: string): void {
  openCache().prepare('DELETE FROM scheduled_sends WHERE id = ?').run(id);
}

// --- splits ---

export function getSplits(): SplitDefinition[] {
  const rows = openCache()
    .prepare('SELECT * FROM splits ORDER BY position ASC')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    position: r.position as number,
    enabled: !!(r.enabled as number),
    rule: JSON.parse(r.rule as string),
  }));
}

export function replaceSplits(defs: SplitDefinition[]): void {
  const d = openCache();
  const now = Date.now();
  const del = d.prepare('DELETE FROM splits');
  const ins = d.prepare(`
    INSERT INTO splits (id, name, position, enabled, rule, created_at)
    VALUES (@id, @name, @position, @enabled, @rule, @createdAt)
  `);
  d.transaction(() => {
    del.run();
    for (const def of defs) {
      ins.run({
        id: def.id,
        name: def.name,
        position: def.position,
        enabled: def.enabled ? 1 : 0,
        rule: JSON.stringify(def.rule),
        createdAt: now,
      });
    }
  })();
}

// --- settings ---

export function getSetting(key: string): string | null {
  const row = openCache()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(key: string, value: string): void {
  openCache()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
    )
    .run(key, value);
}
