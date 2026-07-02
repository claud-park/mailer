import type { BrowserWindow } from 'electron';
import type { GmailProvider } from './gmail';
import {
  dueScheduledSends,
  dueSnoozes,
  removeScheduledSend,
  removeSnooze,
} from './cache';

const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;

/**
 * Background daemon: every minute, wake snoozed threads whose time has come
 * (re-apply INBOX, drop zenmail/snoozed) and fire scheduled sends.
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
        await provider.send(payload);
        removeScheduledSend(id);
        getWindow()?.webContents.send('mail:threads-updated');
      } catch (err) {
        console.error('[snooze] scheduled send failed', id, err);
      }
    }
  };
  timer = setInterval(() => void tick(), TICK_MS);
  void tick();
}

export function stopSnoozeDaemon(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
