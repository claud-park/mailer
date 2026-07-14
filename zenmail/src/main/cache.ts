import crypto from 'node:crypto';
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
import { isInInboxView } from '../shared/view';

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

/**
 * multi-account: per-account SQLite cache handle. Constructed with an explicit dbFile path so
 * each account gets an isolated file (was previously a module-level `db` singleton pointed at
 * a single hardcoded userData path — see LEGACY SHIM below for the transitional single-account
 * callers).
 */
export class AccountCache {
  private db: Database.Database;
  /** inbox-zero-starred D3 로컬-델타 가드 — 계정(인스턴스) 스코프. 기존 모듈 전역 주석 근거 동일.
   * SWR revalidate가 "방금 로컬에서 아카이브/스트립한 스레드"를 스테일 fresh 페이지 때문에
   * 부활시키지 않도록 가드하는 데 쓴다(hasPendingMutations와 함께). 프로세스 수명 동안만 유지되는
   * in-memory Map으로 의도적으로 둔다 — 재시작 케이스는 영속 mutations 큐가 커버하므로 컬럼을
   * 추가해 스키마를 늘리지 않는다(D3). revalidate발 서버-스트립은 origin:'server'로 여기서 제외된다. */
  private localDeltaAt = new Map<string, number>();

  constructor(dbFile: string) {
    this.db = new Database(dbFile);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
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
    // F6 CP7 (D7): scheduled_sends predates attempts/next_attempt_at — CREATE TABLE IF NOT EXISTS
    // never adds columns to an already-existing table, so migrate via ALTER TABLE, swallowing the
    // "duplicate column" error a repeat construction on the same file would otherwise throw.
    for (const stmt of [
      'ALTER TABLE scheduled_sends ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE scheduled_sends ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0',
    ]) {
      try {
        this.db.exec(stmt);
      } catch (err) {
        if (!/duplicate column/i.test(String(err))) throw err;
      }
    }
  }

  close(): void {
    this.db.close();
  }

  /** localDeltaAt[threadId] ≥ ts (로컬 델타가 ts 이후 발생) — revalidate 부활 가드용. */
  localDeltaSince(threadId: string, ts: number): boolean {
    const at = this.localDeltaAt.get(threadId);
    return at !== undefined && at >= ts;
  }

  /**
   * inbox-zero-starred: 계정 경계(sign-out)에서 로컬-델타 기록을 비운다. 가드의 전제는 "낙관
   * 뮤테이션이 아직 같은 provider/세션에 반영 중"인데, sign-out은 provider 인스턴스 자체를
   * 교체한다 — 이전 세션의 타임스탬프가 새 provider의 진짜 fresh 페이지를 15초간 가로막아
   * (예: 아카이브 직후 sign-out→demo 재로그인) 정당한 복원 upsert까지 억제하는 버그였다.
   * clearFollowups()와 동일한 계정 경계 훅(auth:sign-out)에서 호출한다.
   */
  clearLocalDeltaTracking(): void {
    this.localDeltaAt.clear();
  }

  upsertThreads(threads: ThreadSummary[]): void {
    const d = this.db;
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
  getThreads(labelId: string | undefined, limit = 50): ThreadSummary[] {
    const label = labelId ?? 'INBOX';
    const d = this.db;
    if (label === 'INBOX') {
      // inbox-zero-starred D1/D6: 인박스 뷰 = (INBOX ∨ STARRED) − snoozed − TRASH/SPAM.
      // 캐시 리더는 라벨 id를 모르므로 snooze 배제는 로컬 truth인 snoozes 테이블 서브쿼리로 한다(D6).
      // TRASH/SPAM은 SQL에서 직접 배제한다(isInInboxView와 동일 조건) — LIKE 프리필터 뒤에 JS 필터를
      // 얹고 LIMIT을 먼저 적용하면, 상위 N행에 TRASH/SPAM 잔류 행이 몰릴 때 유효 행이 limit보다 적게
      // 반환될 수 있다(뒤쪽 유효 행을 못 봄) — SQL이 최대한 정확히 걸러야 LIMIT이 안전하다. isInInboxView
      // JS 필터는 그래도 유지(공유 술어가 유일한 진실 소스라는 D1 불변식 보존, SQL은 동일 조건의 미러).
      const rows = d
        .prepare(
          `SELECT * FROM threads
           WHERE (label_ids LIKE '%"INBOX"%' OR label_ids LIKE '%"STARRED"%')
             AND label_ids NOT LIKE '%"TRASH"%'
             AND label_ids NOT LIKE '%"SPAM"%'
             AND id NOT IN (SELECT thread_id FROM snoozes)
           ORDER BY date DESC LIMIT ?`
        )
        .all(limit) as Record<string, unknown>[];
      return rows.map(rowToSummary).filter((t) => isInInboxView(t.labelIds));
    }
    const rows = d
      .prepare('SELECT * FROM threads WHERE label_ids LIKE ? ORDER BY date DESC LIMIT ?')
      .all(`%"${label}"%`, limit) as Record<string, unknown>[];
    return rows.map(rowToSummary);
  }

  /**
   * inbox-zero-starred D4: revalidate의 removal 열거용 — 뷰에 매칭되는 **전체** 캐시 행(LIMIT 없음).
   * getThreads가 반환하는 상위 페이지가 아니라 뷰 전체를 훑어야 84행 오염 케이스의 51번 이후 행까지
   * 제거 후보가 된다. 멤버십 판정은 getThreads와 동일(INBOX면 인박스 술어+snoozes 배제, 그 외 라벨은
   * 단순 LIKE). removal window 판정에 쓰이므로 date를 함께 반환한다.
   */
  getViewRows(labelId: string | undefined): { id: string; date: number }[] {
    const label = labelId ?? 'INBOX';
    const d = this.db;
    if (label === 'INBOX') {
      const rows = d
        .prepare(
          `SELECT id, label_ids, date FROM threads
           WHERE (label_ids LIKE '%"INBOX"%' OR label_ids LIKE '%"STARRED"%')
             AND label_ids NOT LIKE '%"TRASH"%'
             AND label_ids NOT LIKE '%"SPAM"%'
             AND id NOT IN (SELECT thread_id FROM snoozes)`
        )
        .all() as { id: string; label_ids: string; date: number }[];
      return rows
        .filter((r) => isInInboxView(JSON.parse(r.label_ids) as string[]))
        .map((r) => ({ id: r.id, date: r.date }));
    }
    return d
      .prepare('SELECT id, date FROM threads WHERE label_ids LIKE ?')
      .all(`%"${label}"%`) as { id: string; date: number }[];
  }

  /** inbox-zero-starred D6: snoozes 테이블에 pending 행이 있으면 true(로컬 snooze truth). */
  isSnoozed(threadId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM snoozes WHERE thread_id = ? LIMIT 1').get(threadId);
    return !!row;
  }

  /**
   * Single-thread summary reader for diff-push (F6 CP5, D1): after an optimistic label delta,
   * the write path re-reads the affected row to ship it as a `mail:threads-changed` upsert.
   * Returns null if the thread isn't cached (caller skips the push — 60s poll converges).
   */
  getThreadSummary(threadId: string): ThreadSummary | null {
    const row = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToSummary(row) : null;
  }

  cacheThreadDetail(detail: ThreadDetail): void {
    const d = this.db;
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
  getCachedThreadDetail(threadId: string): ThreadDetail | null {
    const d = this.db;
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
   * Applies an optimistic label delta straight to the threads cache row (D3: enqueue + cache
   * write are meant to be atomic with the queue insert at the IPC call site). Idempotent: a
   * label already present/absent is a no-op for that label. `unread` is re-derived from the
   * UNREAD label so it stays consistent with labelIds. No-op if the thread isn't cached.
   *
   * Note: if INBOX is removed here the row is NOT deleted — label-filtered readers (getThreads)
   * naturally exclude it, and keeping the row lets warm-cache reads/undo still resolve it.
   *
   * inbox-zero-starred D3: opts.origin이 'server'가 아니면(기본 'local' — 모든 기존 호출부는
   * 로컬 낙관 뮤테이션이므로 불변) 이 스레드의 로컬-델타 시각을 기록한다. revalidate가 서버발
   * removal 스트립을 적용할 때만 {origin:'server'}로 이 기록을 건너뛴다(자기 upsert가 다음 가드를
   * 오염시키지 않도록).
   */
  applyLabelDelta(
    threadId: string,
    addLabelIds: string[],
    removeLabelIds: string[],
    opts: { origin?: 'local' | 'server' } = {}
  ): void {
    const d = this.db;
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
    if (opts.origin !== 'server') this.localDeltaAt.set(threadId, Date.now());
  }

  searchLocal(q: string): ThreadSummary[] {
    const d = this.db;
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

  listContacts(prefix: string): Contact[] {
    const d = this.db;
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

  addSnooze(threadId: string, until: number): void {
    this.db
      .prepare(
        'INSERT INTO snoozes (thread_id, until) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET until=excluded.until'
      )
      .run(threadId, until);
  }

  dueSnoozes(now: number): { threadId: string }[] {
    const rows = this.db
      .prepare('SELECT thread_id FROM snoozes WHERE until <= ?')
      .all(now) as { thread_id: string }[];
    return rows.map((r) => ({ threadId: r.thread_id }));
  }

  removeSnooze(threadId: string): void {
    this.db.prepare('DELETE FROM snoozes WHERE thread_id = ?').run(threadId);
  }

  // --- scheduled sends ---

  addScheduledSend(id: string, payload: SendRequest, sendAt: number): void {
    this.db
      .prepare('INSERT INTO scheduled_sends (id, payload, send_at) VALUES (?, ?, ?)')
      .run(id, JSON.stringify(payload), sendAt);
  }

  dueScheduledSends(now: number): { id: string; payload: SendRequest; attempts: number }[] {
    const rows = this.db
      .prepare('SELECT id, payload, attempts FROM scheduled_sends WHERE send_at <= ? AND next_attempt_at <= ?')
      .all(now, now) as { id: string; payload: string; attempts: number }[];
    return rows.map((r) => ({ id: r.id, payload: JSON.parse(r.payload) as SendRequest, attempts: r.attempts }));
  }

  removeScheduledSend(id: string): void {
    this.db.prepare('DELETE FROM scheduled_sends WHERE id = ?').run(id);
  }

  /**
   * F6 CP7 (D7): records a failed scheduled-send retry with exponential backoff — mirrors
   * bumpMutationAttempt but for the send-spill queue (no last_error column needed here).
   */
  bumpScheduledSendAttempt(id: string, now: number): void {
    const d = this.db;
    const row = d.prepare('SELECT attempts FROM scheduled_sends WHERE id = ?').get(id) as
      | { attempts: number }
      | undefined;
    if (!row) return;
    const attempts = row.attempts + 1;
    const nextAttemptAt = now + backoffDelayMs(attempts);
    d.prepare('UPDATE scheduled_sends SET attempts = ?, next_attempt_at = ? WHERE id = ?').run(
      attempts,
      nextAttemptAt,
      id
    );
  }

  // --- splits ---

  getSplits(): SplitDefinition[] {
    const rows = this.db
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

  replaceSplits(defs: SplitDefinition[]): void {
    const d = this.db;
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

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
      )
      .run(key, value);
  }

  // --- followups ---

  addFollowup(threadId: string, baselineAt: number, dueAt: number): void {
    this.db
      .prepare(
        `INSERT INTO followups (thread_id, baseline_at, due_at, status, created_at)
         VALUES (?, ?, ?, 'pending', ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           baseline_at=excluded.baseline_at, due_at=excluded.due_at, status='pending',
           created_at=excluded.created_at`
      )
      .run(threadId, baselineAt, dueAt, Date.now());
  }

  dueFollowups(now: number): { threadId: string; baselineAt: number }[] {
    const rows = this.db
      .prepare(`SELECT thread_id, baseline_at FROM followups WHERE status = 'pending' AND due_at <= ?`)
      .all(now) as { thread_id: string; baseline_at: number }[];
    return rows.map((r) => ({ threadId: r.thread_id, baselineAt: r.baseline_at }));
  }

  setFollowupFired(threadId: string): void {
    this.db.prepare(`UPDATE followups SET status = 'fired' WHERE thread_id = ?`).run(threadId);
  }

  removeFollowup(threadId: string): void {
    this.db.prepare('DELETE FROM followups WHERE thread_id = ?').run(threadId);
  }

  listFollowups(): FollowupInfo[] {
    const rows = this.db
      .prepare('SELECT thread_id, status, due_at FROM followups')
      .all() as { thread_id: string; status: string; due_at: number }[];
    return rows.map((r) => ({
      threadId: r.thread_id,
      status: r.status as 'pending' | 'fired',
      dueAt: r.due_at,
    }));
  }

  /** internal helper — baseline_at is not part of the public FollowupInfo shape */
  getFollowup(
    threadId: string
  ): { threadId: string; baselineAt: number; status: 'pending' | 'fired' } | null {
    const row = this.db
      .prepare('SELECT thread_id, baseline_at, status FROM followups WHERE thread_id = ?')
      .get(threadId) as { thread_id: string; baseline_at: number; status: string } | undefined;
    if (!row) return null;
    return {
      threadId: row.thread_id,
      baselineAt: row.baseline_at,
      status: row.status as 'pending' | 'fired',
    };
  }

  clearFollowups(): void {
    this.db.prepare('DELETE FROM followups').run();
  }

  // --- mutation queue (offline-write spill, D3/D4/D6) ---

  enqueueMutation(kind: string, threadId: string, payload: object, now: number): string {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO mutations (id, kind, payload, thread_id, created_at, attempts, next_attempt_at, last_error)
         VALUES (?, ?, ?, ?, ?, 0, 0, NULL)`
      )
      .run(id, kind, JSON.stringify(payload), threadId, now);
    return id;
  }

  listDrainableMutations(now: number): QueuedMutation[] {
    const rows = this.db
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
  bumpMutationAttempt(id: string, now: number, error: string): void {
    const d = this.db;
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

  removeMutation(id: string): void {
    this.db.prepare('DELETE FROM mutations WHERE id = ?').run(id);
  }

  hasPendingMutations(threadId: string): boolean {
    const row = this.db
      .prepare('SELECT 1 FROM mutations WHERE thread_id = ? LIMIT 1')
      .get(threadId);
    return !!row;
  }

  mutationQueueDepth(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM mutations').get() as { n: number };
    return row.n;
  }

  /** Sends that are due (spilled retries or overdue schedules) — counted as pending sync work.
   *  Future-dated user schedules are intentionally excluded (they are not "syncing"). */
  overdueScheduledSendCount(now: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM scheduled_sends WHERE send_at <= ?')
      .get(now) as { n: number };
    return row.n;
  }
}
