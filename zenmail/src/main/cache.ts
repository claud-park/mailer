import crypto from 'node:crypto';
import path from 'node:path';
import { app } from 'electron';
import Database from 'better-sqlite3';
import type {
  Contact,
  FollowupInfo,
  MessageDetail,
  SendRequest,
  SplitDefinition,
  ThreadDetail,
  ThreadSummary,
} from '../shared/types';
import { backoffDelayMs } from '../shared/sync';

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
    CREATE TABLE IF NOT EXISTS followups (
      thread_id   TEXT PRIMARY KEY,
      baseline_at INTEGER NOT NULL,
      due_at      INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mutations (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
      thread_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mutations_thread ON mutations(thread_id);
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

/** Cache reader for the split-inbox lists — mirrors the Gmail `labelIds` filter semantics. */
export function getThreads(labelId: string | undefined, limit = 50): ThreadSummary[] {
  const label = labelId ?? 'INBOX';
  const rows = openCache()
    .prepare('SELECT * FROM threads WHERE label_ids LIKE ? ORDER BY date DESC LIMIT ?')
    .all(`%"${label}"%`, limit) as Record<string, unknown>[];
  return rows.map(rowToSummary);
}

/**
 * Single-thread summary reader for diff-push (F6 CP5, D1): after an optimistic label delta,
 * the write path re-reads the affected row to ship it as a `mail:threads-changed` upsert.
 * Returns null if the thread isn't cached (caller skips the push — 60s poll converges).
 */
export function getThreadSummary(threadId: string): ThreadSummary | null {
  const row = openCache()
    .prepare('SELECT * FROM threads WHERE id = ?')
    .get(threadId) as Record<string, unknown> | undefined;
  return row ? rowToSummary(row) : null;
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

/**
 * Reassembles a full ThreadDetail from the cache for SWR cache-hit reads (D11): threads row
 * supplies subject/labelIds, messages table supplies the message bodies. Returns null if the
 * thread row or any cached messages are missing (cold miss — caller falls back to network).
 */
export function getCachedThreadDetail(threadId: string): ThreadDetail | null {
  const d = openCache();
  const threadRow = d
    .prepare('SELECT subject, label_ids FROM threads WHERE id = ?')
    .get(threadId) as { subject: string; label_ids: string } | undefined;
  if (!threadRow) return null;
  const rows = d
    .prepare('SELECT payload FROM messages WHERE thread_id = ?')
    .all(threadId) as { payload: string }[];
  if (rows.length === 0) return null;
  const messages = rows
    .map((r) => JSON.parse(r.payload) as MessageDetail)
    .sort((a, b) => a.date - b.date);
  return {
    id: threadId,
    subject: threadRow.subject,
    labelIds: JSON.parse(threadRow.label_ids),
    messages,
  };
}

/**
 * Pure label_ids merge — extracted so the idempotency of add/remove can be unit-tested
 * without a live DB. add: dedupes against current + itself. remove: filters out.
 */
export function mergeLabelIds(
  current: string[],
  addLabelIds: string[],
  removeLabelIds: string[]
): string[] {
  const removed = current.filter((id) => !removeLabelIds.includes(id));
  const merged = [...removed];
  for (const id of addLabelIds) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged.filter((id) => !removeLabelIds.includes(id));
}

/**
 * Applies an optimistic label delta straight to the threads cache row (D3: enqueue + cache
 * write are meant to be atomic with the queue insert at the IPC call site). Idempotent: a
 * label already present/absent is a no-op for that label. `unread` is re-derived from the
 * UNREAD label so it stays consistent with labelIds. No-op if the thread isn't cached.
 *
 * Note: if INBOX is removed here the row is NOT deleted — label-filtered readers (getThreads)
 * naturally exclude it, and keeping the row lets warm-cache reads/undo still resolve it.
 */
export function applyLabelDelta(
  threadId: string,
  addLabelIds: string[],
  removeLabelIds: string[]
): void {
  const d = openCache();
  const row = d.prepare('SELECT label_ids FROM threads WHERE id = ?').get(threadId) as
    | { label_ids: string }
    | undefined;
  if (!row) return;
  const current = JSON.parse(row.label_ids) as string[];
  const next = mergeLabelIds(current, addLabelIds, removeLabelIds);
  const unread = next.includes('UNREAD');
  d.prepare('UPDATE threads SET label_ids = ?, unread = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(next),
    unread ? 1 : 0,
    Date.now(),
    threadId
  );
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

// --- followups ---

export function addFollowup(threadId: string, baselineAt: number, dueAt: number): void {
  openCache()
    .prepare(
      `INSERT INTO followups (thread_id, baseline_at, due_at, status, created_at)
       VALUES (?, ?, ?, 'pending', ?)
       ON CONFLICT(thread_id) DO UPDATE SET
         baseline_at=excluded.baseline_at, due_at=excluded.due_at, status='pending',
         created_at=excluded.created_at`
    )
    .run(threadId, baselineAt, dueAt, Date.now());
}

export function dueFollowups(now: number): { threadId: string; baselineAt: number }[] {
  const rows = openCache()
    .prepare(`SELECT thread_id, baseline_at FROM followups WHERE status = 'pending' AND due_at <= ?`)
    .all(now) as { thread_id: string; baseline_at: number }[];
  return rows.map((r) => ({ threadId: r.thread_id, baselineAt: r.baseline_at }));
}

export function setFollowupFired(threadId: string): void {
  openCache().prepare(`UPDATE followups SET status = 'fired' WHERE thread_id = ?`).run(threadId);
}

export function removeFollowup(threadId: string): void {
  openCache().prepare('DELETE FROM followups WHERE thread_id = ?').run(threadId);
}

export function listFollowups(): FollowupInfo[] {
  const rows = openCache()
    .prepare('SELECT thread_id, status, due_at FROM followups')
    .all() as { thread_id: string; status: string; due_at: number }[];
  return rows.map((r) => ({
    threadId: r.thread_id,
    status: r.status as 'pending' | 'fired',
    dueAt: r.due_at,
  }));
}

/** internal helper — baseline_at is not part of the public FollowupInfo shape */
export function getFollowup(
  threadId: string
): { threadId: string; baselineAt: number; status: 'pending' | 'fired' } | null {
  const row = openCache()
    .prepare('SELECT thread_id, baseline_at, status FROM followups WHERE thread_id = ?')
    .get(threadId) as { thread_id: string; baseline_at: number; status: string } | undefined;
  if (!row) return null;
  return {
    threadId: row.thread_id,
    baselineAt: row.baseline_at,
    status: row.status as 'pending' | 'fired',
  };
}

export function clearFollowups(): void {
  openCache().prepare('DELETE FROM followups').run();
}

// --- mutation queue (offline-write spill, D3/D4/D6) ---

export interface QueuedMutation {
  id: string;
  kind: string;
  payload: unknown;
  threadId: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
}

export function enqueueMutation(kind: string, threadId: string, payload: object, now: number): string {
  const id = crypto.randomUUID();
  openCache()
    .prepare(
      `INSERT INTO mutations (id, kind, payload, thread_id, created_at, attempts, next_attempt_at, last_error)
       VALUES (?, ?, ?, ?, ?, 0, 0, NULL)`
    )
    .run(id, kind, JSON.stringify(payload), threadId, now);
  return id;
}

export function listDrainableMutations(now: number): QueuedMutation[] {
  const rows = openCache()
    .prepare('SELECT * FROM mutations WHERE next_attempt_at <= ? ORDER BY created_at ASC')
    .all(now) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    payload: JSON.parse(r.payload as string),
    threadId: r.thread_id as string,
    createdAt: r.created_at as number,
    attempts: r.attempts as number,
    nextAttemptAt: r.next_attempt_at as number,
    lastError: (r.last_error as string | null) ?? null,
  }));
}

/** Records a failed drain attempt and reschedules via shared/sync's exponential backoff. */
export function bumpMutationAttempt(id: string, now: number, error: string): void {
  const d = openCache();
  const row = d.prepare('SELECT attempts FROM mutations WHERE id = ?').get(id) as
    | { attempts: number }
    | undefined;
  if (!row) return;
  const attempts = row.attempts + 1;
  const nextAttemptAt = now + backoffDelayMs(attempts);
  d.prepare('UPDATE mutations SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?').run(
    attempts,
    nextAttemptAt,
    error,
    id
  );
}

export function removeMutation(id: string): void {
  openCache().prepare('DELETE FROM mutations WHERE id = ?').run(id);
}

export function hasPendingMutations(threadId: string): boolean {
  const row = openCache()
    .prepare('SELECT 1 FROM mutations WHERE thread_id = ? LIMIT 1')
    .get(threadId);
  return !!row;
}

export function mutationQueueDepth(): number {
  const row = openCache().prepare('SELECT COUNT(*) AS n FROM mutations').get() as { n: number };
  return row.n;
}
