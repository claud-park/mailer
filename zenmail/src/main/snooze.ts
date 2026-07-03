import type { BrowserWindow } from 'electron';
import type { GmailProvider } from './gmail';
import {
  addFollowup,
  dueFollowups,
  dueScheduledSends,
  dueSnoozes,
  removeFollowup,
  removeScheduledSend,
  removeSnooze,
  setFollowupFired,
} from './cache';

const TICK_MS = 60_000;
const DAY_MS = 86_400_000;

let timer: NodeJS.Timeout | null = null;
let tickFn: (() => Promise<void>) | null = null;

/**
 * Background daemon: every minute, wake snoozed threads whose time has come
 * (re-apply INBOX, drop zenmail/snoozed), fire scheduled sends, and resurface
 * follow-up reminders that got no reply in time.
 */
export function startSnoozeDaemon(
  getProvider: () => GmailProvider | null,
  getWindow: () => BrowserWindow | null
): void {
  stopSnoozeDaemon();
  const tick = async () => {
    const provider = getProvider();
    if (!provider) return;
    const now = Date.now();

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
        getWindow()?.webContents.send('mail:threads-updated');
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
        getWindow()?.webContents.send('mail:threads-updated');
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
        getWindow()?.webContents.send('mail:threads-updated');
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
  };
  tickFn = tick;
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
