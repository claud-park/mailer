import type { BrowserWindow } from 'electron';
import type { GmailProvider } from './gmail';
import {
  addFollowup,
  addSnooze,
  bumpMutationAttempt,
  dueFollowups,
  dueScheduledSends,
  dueSnoozes,
  listDrainableMutations,
  mutationQueueDepth,
  removeFollowup,
  removeMutation,
  removeScheduledSend,
  removeSnooze,
  setFollowupFired,
} from './cache';
import { classifyError, isExhausted } from '../shared/sync';
import { emitSyncState, notifyThreadsChanged, onReconnect, setOnline } from './sync-state';

const TICK_MS = 60_000;
const DAY_MS = 86_400_000;

let timer: NodeJS.Timeout | null = null;
let tickFn: (() => Promise<void>) | null = null;
let tickInFlight = false;

/**
 * Background daemon: every minute, wake snoozed threads whose time has come
 * (re-apply INBOX, drop zenmail/snoozed), fire scheduled sends, resurface
 * follow-up reminders that got no reply in time, and drain the offline
 * mutation queue (F6 CP3). All change signals emitted by these four loops are
 * collapsed into a single end-of-tick `mail:threads-changed` (needsRefetch) send (D12).
 */
export function startSnoozeDaemon(
  getProvider: () => GmailProvider | null,
  getWindow: () => BrowserWindow | null
): void {
  stopSnoozeDaemon();
  const tick = async () => {
    // Reconnect (D9 accelerator) and the 60s interval can both fire close together —
    // skip re-entrant ticks rather than draining the same queue twice concurrently.
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      const provider = getProvider();
      if (!provider) return;
      const now = Date.now();
      let changed = false;

      for (const { threadId } of dueSnoozes(now)) {
        try {
          const snoozeLabel = await provider.snoozeLabelId();
          await provider.modifyThread({
            threadId,
            addLabelIds: ['INBOX'],
            removeLabelIds: [snoozeLabel],
          });
          removeSnooze(threadId);
          getWindow()?.webContents.send('mail:snooze-fired', threadId);
          changed = true;
        } catch (err) {
          console.error('[snooze] failed to wake thread', threadId, err);
        }
      }

      for (const { id, payload } of dueScheduledSends(now)) {
        try {
          const result = await provider.send(payload);
          removeScheduledSend(id);
          if (payload.remindDays) {
            addFollowup(result.threadId, now, now + payload.remindDays * DAY_MS);
          }
          changed = true;
        } catch (err) {
          console.error('[snooze] scheduled send failed', id, err);
        }
      }

      for (const { threadId, baselineAt } of dueFollowups(now)) {
        try {
          const detail = await provider.getThread(threadId);
          if (detail.labelIds.includes('TRASH')) {
            removeFollowup(threadId);
            continue;
          }
          const meEmail = provider.email.toLowerCase();
          const replied = detail.messages.some(
            (m) => m.date > baselineAt && m.from.email.toLowerCase() !== meEmail
          );
          if (replied) {
            removeFollowup(threadId);
            continue;
          }
          await provider.modifyThread({
            threadId,
            addLabelIds: ['INBOX', 'UNREAD'], // 이미 INBOX면 no-op — send&archive/수동 아카이브 모두 복귀
            removeLabelIds: [],
          });
          setFollowupFired(threadId);
          getWindow()?.webContents.send('mail:followup-fired', threadId);
          changed = true;
        } catch (err) {
          // 영구 삭제된 스레드(404)는 매 틱 재시도하지 않고 정리한다
          const status = (err as { code?: number; status?: number })?.code ?? (err as { status?: number })?.status;
          if (status === 404 || /not found/i.test(String(err))) {
            removeFollowup(threadId);
          } else {
            console.error('[followup] failed to process', threadId, err);
          }
        }
      }

      // --- offline mutation queue drain (F6 CP3, D6/D8/D9) ---
      const depthBefore = mutationQueueDepth();
      const skipThreads = new Set<string>();
      let haltDrain = false;
      for (const m of listDrainableMutations(now)) {
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
            addSnooze(p.threadId, until);
          }
          removeMutation(m.id);
          setOnline(true);
          changed = true;
        } catch (err) {
          const cls = classifyError(err);
          if (cls === 'transient' && !isExhausted(m.attempts + 1)) {
            bumpMutationAttempt(m.id, now, String(err));
            setOnline(false);
            haltDrain = true; // offline — remaining attempts this tick would just fail too
          } else {
            removeMutation(m.id);
            getWindow()?.webContents.send('mail:mutation-permanent-failed', {
              threadId: m.threadId,
              kind: m.kind,
            });
            skipThreads.add(m.threadId);
            changed = true;
          }
        }
      }
      if (mutationQueueDepth() !== depthBefore) emitSyncState(getWindow);

      // Daemon-origin change (D1 compromise): the wake/send/followup/drain loops touch threads that
      // may not be in the renderer's current list (other labels), and the new server state isn't in
      // the cache summaries — so ship a single needsRefetch (≤1/min) rather than a diff. This keeps
      // pure diff-push (0 refetch) for the hot mutation path while the daemon stays refetch-based.
      if (changed) notifyThreadsChanged(getWindow, { upserts: [], removals: [], needsRefetch: true });
    } finally {
      tickInFlight = false;
    }
  };
  tickFn = tick;
  onReconnect(() => void tick());
  timer = setInterval(() => void tick(), TICK_MS);
  void tick();
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
