import type { BrowserWindow } from 'electron';
import type { GmailProvider } from './gmail';
import type { AccountContext } from './ipc';
import { classifyError, isExhausted } from '../shared/sync';
import { emitSyncState, notifyThreadsChanged, onReconnect, setOnline } from './sync-state';

const TICK_MS = 60_000;
const DAY_MS = 86_400_000;

let timer: NodeJS.Timeout | null = null;
let tickFn: (() => Promise<void>) | null = null;
let tickInFlight = false;

/**
 * Background daemon: every minute, for *every* signed-in account, wake snoozed threads whose time
 * has come (re-apply INBOX, drop zenmail/snoozed), fire scheduled sends, resurface follow-up
 * reminders that got no reply in time, and drain the offline mutation queue (F6 CP3). All change
 * signals emitted by these four loops are collapsed into a single end-of-tick per-account
 * `mail:threads-changed` (needsRefetch) send (D12). Accounts are isolated: a needsReauth account
 * is skipped and a failing account's error never aborts the others' ticks.
 */
export function startSnoozeDaemon(
  getContexts: () => AccountContext[],
  getWindow: () => BrowserWindow | null
): void {
  stopSnoozeDaemon();
  const tick = async () => {
    // Reconnect (D9 accelerator) and the 60s interval can both fire close together —
    // skip re-entrant ticks rather than draining the same queue twice concurrently.
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
  tickFn = tick;
  onReconnect(() => void tick());
  timer = setInterval(() => void tick(), TICK_MS);
  void tick();
}

async function tickAccount(
  ctx: AccountContext & { provider: GmailProvider },
  getWindow: () => BrowserWindow | null,
  now: number
): Promise<void> {
  const provider = ctx.provider;
  const c = ctx.cache;
  let changed = false;

  for (const { threadId } of c.dueSnoozes(now)) {
    try {
      const snoozeLabel = await provider.snoozeLabelId();
      await provider.modifyThread({
        threadId,
        addLabelIds: ['INBOX'],
        removeLabelIds: [snoozeLabel],
      });
      c.removeSnooze(threadId);
      getWindow()?.webContents.send('mail:snooze-fired', { accountId: ctx.email, threadId });
      changed = true;
    } catch (err) {
      console.error('[snooze] failed to wake thread', threadId, err);
    }
  }

  for (const { id, payload, attempts } of c.dueScheduledSends(now)) {
    try {
      const result = await provider.send(payload);
      // at-least-once (D7): remove only *after* send succeeds. A response lost between the
      // provider call resolving and this line would leave the row and retry — an accepted
      // duplicate-send risk (no Gmail idempotency key, Sent-folder dedup is out of scope).
      c.removeScheduledSend(id);
      if (payload.remindDays) {
        c.addFollowup(result.threadId, now, now + payload.remindDays * DAY_MS);
      }
      changed = true;
    } catch (err) {
      const cls = classifyError(err);
      if (cls === 'transient' && !isExhausted(attempts + 1)) {
        c.bumpScheduledSendAttempt(id, now);
      } else {
        console.error('[snooze] scheduled send failed permanently', id, err);
        c.removeScheduledSend(id);
        getWindow()?.webContents.send('mail:mutation-permanent-failed', {
          accountId: ctx.email,
          threadId: payload.threadId ?? null,
          kind: 'send',
        });
        changed = true;
      }
    }
  }

  for (const { threadId, baselineAt } of c.dueFollowups(now)) {
    try {
      const detail = await provider.getThread(threadId);
      if (detail.labelIds.includes('TRASH')) {
        c.removeFollowup(threadId);
        continue;
      }
      const meEmail = provider.email.toLowerCase();
      const replied = detail.messages.some(
        (m) => m.date > baselineAt && m.from.email.toLowerCase() !== meEmail
      );
      if (replied) {
        c.removeFollowup(threadId);
        continue;
      }
      await provider.modifyThread({
        threadId,
        addLabelIds: ['INBOX', 'UNREAD'], // 이미 INBOX면 no-op — send&archive/수동 아카이브 모두 복귀
        removeLabelIds: [],
      });
      c.setFollowupFired(threadId);
      getWindow()?.webContents.send('mail:followup-fired', { accountId: ctx.email, threadId });
      changed = true;
    } catch (err) {
      // 영구 삭제된 스레드(404)는 매 틱 재시도하지 않고 정리한다
      const status = (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
      if (status === 404 || /not found/i.test(String(err))) {
        c.removeFollowup(threadId);
      } else {
        console.error('[followup] failed to process', threadId, err);
      }
    }
  }

  // --- offline mutation queue drain (F6 CP3, D6/D8/D9) ---
  const depthBefore = c.mutationQueueDepth();
  const skipThreads = new Set<string>();
  let haltDrain = false;
  for (const m of c.listDrainableMutations(now)) {
    if (haltDrain) break;
    if (skipThreads.has(m.threadId)) continue; // per-thread FIFO barrier (D6): don't reorder past a failed predecessor

    try {
      if (m.kind === 'modifyLabels') {
        const p = m.payload as { threadId: string; addLabelIds: string[]; removeLabelIds: string[] };
        await provider.modifyThread({
          threadId: p.threadId,
          addLabelIds: p.addLabelIds,
          removeLabelIds: p.removeLabelIds,
        });
      } else if (m.kind === 'snooze') {
        const p = m.payload as { threadId: string; until: string };
        const until = new Date(p.until).getTime();
        const snoozeLabel = await provider.snoozeLabelId();
        await provider.modifyThread({
          threadId: p.threadId,
          addLabelIds: [snoozeLabel],
          removeLabelIds: ['INBOX'],
        });
        c.addSnooze(p.threadId, until);
      }
      c.removeMutation(m.id);
      setOnline(true);
      changed = true;
    } catch (err) {
      const cls = classifyError(err);
      if (cls === 'transient' && !isExhausted(m.attempts + 1)) {
        c.bumpMutationAttempt(m.id, now, String(err));
        setOnline(false);
        haltDrain = true; // offline — remaining attempts this tick would just fail too
      } else {
        c.removeMutation(m.id);
        getWindow()?.webContents.send('mail:mutation-permanent-failed', {
          accountId: ctx.email,
          threadId: m.threadId,
          kind: m.kind,
        });
        skipThreads.add(m.threadId);
        changed = true;
      }
    }
  }
  if (c.mutationQueueDepth() !== depthBefore) emitSyncState(getWindow);

  // Daemon-origin change (D1 compromise): the wake/send/followup/drain loops touch threads that
  // may not be in the renderer's current list (other labels), and the new server state isn't in
  // the cache summaries — so ship a single needsRefetch (≤1/min) rather than a diff. This keeps
  // pure diff-push (0 refetch) for the hot mutation path while the daemon stays refetch-based.
  if (changed) notifyThreadsChanged(getWindow, { accountId: ctx.email, upserts: [], removals: [], needsRefetch: true });
}

export function stopSnoozeDaemon(): void {
  if (timer) clearInterval(timer);
  timer = null;
  tickFn = null;
}

/** E2E-only: force a daemon tick to run to completion (see ZENMAIL_E2E_PORT gate in ipc.ts). */
export async function runDaemonTickNow(): Promise<void> {
  if (tickFn) await tickFn();
}
