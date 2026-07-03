import crypto from 'node:crypto';
import { ipcMain, type BrowserWindow } from 'electron';
import type {
  AccountInfo,
  FetchThreadsRequest,
  FollowupInfo,
  ModifyLabelsRequest,
  SendReceipt,
  SendRequest,
  SnoozeRequest,
  SplitDefinition,
} from '../shared/types';
import * as auth from './auth';
import * as cache from './cache';
import { DEMO_VIP_EMAIL, MockGmailProvider, RealGmailProvider, type GmailProvider } from './gmail';
import { runDaemonTickNow } from './snooze';

const UNDO_WINDOW_MS = 10_000;
const DAY_MS = 86_400_000;

let provider: GmailProvider | null = null;
const pendingSends = new Map<string, NodeJS.Timeout>();

export function getProvider(): GmailProvider | null {
  return provider;
}

async function restoreSession(): Promise<AccountInfo | null> {
  const session = await auth.getAuthorizedClient();
  if (session) {
    provider = new RealGmailProvider(session.client, session.email);
    return { email: session.email, demo: false };
  }
  return null;
}

function requireProvider(): GmailProvider {
  if (!provider) throw new Error('Not signed in');
  return provider;
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const notifyThreadsUpdated = () =>
    getWindow()?.webContents.send('mail:threads-updated');

  ipcMain.handle('auth:get-account', async (): Promise<AccountInfo | null> => {
    if (provider) return { email: provider.email, demo: provider.demo };
    return restoreSession();
  });

  ipcMain.handle('auth:sign-in', async (): Promise<AccountInfo> => {
    const email = await auth.signIn();
    const session = await auth.getAuthorizedClient();
    if (!session) throw new Error('Sign-in did not persist a session');
    provider = new RealGmailProvider(session.client, email);
    return { email, demo: false };
  });

  ipcMain.handle('auth:sign-in-demo', async (): Promise<AccountInfo> => {
    provider = new MockGmailProvider();
    return { email: provider.email, demo: true };
  });

  ipcMain.handle('auth:sign-out', async () => {
    await auth.signOut();
    provider = null;
    cache.clearFollowups();
  });

  ipcMain.handle('mail:fetch-threads', async (_e, req: FetchThreadsRequest) => {
    const res = await requireProvider().listThreads(req);
    cache.upsertThreads(res.threads);
    return res;
  });

  ipcMain.handle('mail:fetch-thread', async (_e, threadId: string) => {
    const p = requireProvider();
    const detail = await p.getThread(threadId);
    cache.cacheThreadDetail(detail);

    // opportunistic follow-up resolution (D7): reuse the detail we just fetched,
    // no extra API call.
    const followup = cache.getFollowup(threadId);
    if (followup && followup.status === 'pending') {
      const meEmail = p.email.toLowerCase();
      const replied = detail.messages.some(
        (m) => m.date > followup.baselineAt && m.from.email.toLowerCase() !== meEmail
      );
      if (replied) cache.removeFollowup(threadId);
    }

    return detail;
  });

  ipcMain.handle('mail:fetch-labels', async () => {
    return requireProvider().listLabels();
  });

  ipcMain.handle('mail:send', async (_e, req: SendRequest): Promise<SendReceipt> => {
    const p = requireProvider();
    const sendId = crypto.randomUUID();

    if (req.sendAt) {
      // schedule send: persist and let the daemon fire it
      const sendAt = new Date(req.sendAt).getTime();
      cache.addScheduledSend(sendId, req, sendAt);
      return { sendId, sendAt };
    }

    // undo window: hold the send for 10s, cancellable via mail:cancel-send
    const sendAt = Date.now() + UNDO_WINDOW_MS;
    const timer = setTimeout(async () => {
      pendingSends.delete(sendId);
      try {
        const result = await p.send(req);
        if (req.archive && req.threadId) {
          await p.modifyThread({
            threadId: req.threadId,
            addLabelIds: [],
            removeLabelIds: ['INBOX'],
          });
        }
        if (req.remindDays) {
          cache.addFollowup(result.threadId, Date.now(), Date.now() + req.remindDays * DAY_MS);
        }
        notifyThreadsUpdated();
      } catch (err) {
        console.error('[send] failed', err);
      }
    }, UNDO_WINDOW_MS);
    pendingSends.set(sendId, timer);
    return { sendId, sendAt };
  });

  ipcMain.handle('mail:cancel-send', async (_e, sendId: string): Promise<boolean> => {
    const timer = pendingSends.get(sendId);
    if (timer) {
      clearTimeout(timer);
      pendingSends.delete(sendId);
      return true;
    }
    // scheduled send?
    cache.removeScheduledSend(sendId);
    return true;
  });

  ipcMain.handle('mail:modify-labels', async (_e, req: ModifyLabelsRequest) => {
    await requireProvider().modifyThread(req);
    notifyThreadsUpdated();
  });

  ipcMain.handle('mail:snooze', async (_e, req: SnoozeRequest) => {
    const p = requireProvider();
    const snoozeLabel = await p.snoozeLabelId();
    await p.modifyThread({
      threadId: req.threadId,
      addLabelIds: [snoozeLabel],
      removeLabelIds: ['INBOX'],
    });
    cache.addSnooze(req.threadId, new Date(req.until).getTime());
    notifyThreadsUpdated();
  });

  ipcMain.handle('mail:search-local', async (_e, q: string) => {
    return cache.searchLocal(q);
  });

  ipcMain.handle('mail:contacts', async (_e, prefix: string) => {
    return cache.listContacts(prefix);
  });

  ipcMain.handle('mail:get-splits', async (): Promise<SplitDefinition[]> => {
    const existing = cache.getSplits();
    if (existing.length > 0) return existing;

    const accountDomain = provider?.email.split('@')[1] ?? '';
    // demo mode only: seed VIP with a sender from the mock data so the split is demonstrable out of the box
    const vipEmails = provider?.demo ? [DEMO_VIP_EMAIL] : [];
    const seeded: SplitDefinition[] = [
      {
        id: crypto.randomUUID(),
        name: 'VIP',
        position: 0,
        enabled: true,
        rule: { kind: 'senders', emails: vipEmails },
      },
      {
        id: crypto.randomUUID(),
        name: 'Team',
        position: 1,
        enabled: true,
        rule: { kind: 'domains', domains: accountDomain ? [accountDomain] : [] },
      },
      {
        id: crypto.randomUUID(),
        name: 'Newsletter',
        position: 2,
        enabled: true,
        rule: { kind: 'newsletter' },
      },
    ];
    // 로그인 전 호출이면 저장하지 않는다 — Team 도메인이 빈 채로 영구 시드되는 것 방지
    if (provider) cache.replaceSplits(seeded);
    return seeded;
  });

  ipcMain.handle('mail:set-splits', async (_e, defs: SplitDefinition[]) => {
    cache.replaceSplits(defs);
  });

  ipcMain.handle('mail:get-setting', async (_e, key: string): Promise<string | null> => {
    return cache.getSetting(key);
  });

  ipcMain.handle('mail:set-setting', async (_e, key: string, value: string) => {
    cache.setSetting(key, value);
  });

  ipcMain.handle('mail:add-followup', async (_e, threadId: string, remindDays: number) => {
    const now = Date.now();
    cache.addFollowup(threadId, now, now + remindDays * DAY_MS);
  });

  ipcMain.handle('mail:cancel-followup', async (_e, threadId: string) => {
    cache.removeFollowup(threadId);
  });

  ipcMain.handle('mail:dismiss-followup', async (_e, threadId: string) => {
    cache.removeFollowup(threadId);
  });

  ipcMain.handle('mail:list-followups', async (): Promise<FollowupInfo[]> => {
    return cache.listFollowups();
  });

  // E2E-only debug IPC — never registered unless ZENMAIL_E2E_PORT is set (see e2e/).
  if (process.env.ZENMAIL_E2E_PORT) {
    ipcMain.handle('mail:debug-simulate-reply', async (_e, threadId: string) => {
      if (provider instanceof MockGmailProvider) {
        provider.simulateReply(threadId);
        notifyThreadsUpdated();
      }
    });

    ipcMain.handle('mail:debug-tick', async () => {
      await runDaemonTickNow();
    });
  }
}
