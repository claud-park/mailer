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
  ThreadDetail,
} from '../shared/types';
import { classifyError } from '../shared/sync';
import * as auth from './auth';
import * as cache from './cache';
import { DEMO_VIP_EMAIL, MockGmailProvider, RealGmailProvider, type GmailProvider } from './gmail';
import { runDaemonTickNow } from './snooze';
import { emitSyncState, notifyThreadsChanged, setOnline, triggerReconnect } from './sync-state';

const UNDO_WINDOW_MS = 10_000;
const DAY_MS = 86_400_000;

let provider: GmailProvider | null = null;
const pendingSends = new Map<string, NodeJS.Timeout>();

// E2E-only: consumed (one-shot) by the next mail:modify-labels or mail:snooze call —
// only ever set true via the ZENMAIL_E2E_PORT-gated mail:debug-fail-next-modify handler below.
let debugFailNextModify = false;
function consumeDebugFailNextModify(): boolean {
  if (!debugFailNextModify) return false;
  debugFailNextModify = false;
  return true;
}
// The injected failure must land *after* the mock provider's ~120ms round-trip would have,
// so E2E can overlap a second real mutation inside the failure window (TC-SP-C2's whole
// point). An instant throw resolves the rollback before the harness can even press the
// second key, collapsing the concurrency the test exists to exercise.
async function maybeInjectDebugFailure(): Promise<void> {
  if (!consumeDebugFailNextModify()) return;
  await new Promise((r) => setTimeout(r, 400));
  throw new Error('injected failure');
}

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
  // F6 CP5 (D1): mutation-origin diff push. Re-read the affected row from cache (its optimistic
  // label delta already applied) and ship it as an upsert. The renderer decides upsert-vs-remove
  // against its *current* view label, so main never needs to know which list is on screen. A thread
  // absent from cache is skipped (60s poll converges). removals[] is reserved for server-vanished ids.
  const pushThreadUpsert = (threadId: string) => {
    const summary = cache.getThreadSummary(threadId);
    if (summary) notifyThreadsChanged(getWindow, { upserts: [summary], removals: [] });
  };

  /**
   * Write-path core (F6 CP2, D3/D4/D5/D6/D9). Optimistically applies the label delta to the cache,
   * then either goes direct-to-provider (online happy path) or spills to the mutation queue:
   *  1. cache.applyLabelDelta — always, so cold-restart reads reflect the mutation (D3).
   *  2. per-thread FIFO barrier (D6): if a mutation is already queued for this thread we enqueue
   *     behind it (order-preserving) even while online, and resolve.
   *  3. direct call — the debug failure injection stays *inside* doProvider (unchanged position);
   *     success flips online=true and pokes the renderer exactly as before.
   *  4. catch — classifyError(err): 'permanent' (incl. the generic debug-injected failure, D5/D13)
   *     rethrows onto the existing renderer-rollback path; 'transient' spills to the queue, flips
   *     online=false, and resolves so the renderer keeps its optimistic UI (D4/D9).
   * onEnqueue runs on the two enqueue paths only (barrier + transient) — never on permanent
   * failure — letting snooze persist its local truth (addSnooze) without polluting the rollback.
   */
  async function attemptOrEnqueue(
    kind: string,
    threadId: string,
    addLabelIds: string[],
    removeLabelIds: string[],
    payload: object,
    doProvider: () => Promise<void>,
    onEnqueue?: () => void
  ): Promise<void> {
    cache.applyLabelDelta(threadId, addLabelIds, removeLabelIds);

    if (cache.hasPendingMutations(threadId)) {
      onEnqueue?.();
      cache.enqueueMutation(kind, threadId, payload, Date.now());
      emitSyncState(getWindow);
      return;
    }

    try {
      await doProvider();
      setOnline(true, () => emitSyncState(getWindow));
      pushThreadUpsert(threadId);
    } catch (err) {
      if (classifyError(err) === 'permanent') throw err;
      onEnqueue?.();
      cache.enqueueMutation(kind, threadId, payload, Date.now());
      setOnline(false);
      emitSyncState(getWindow);
    }
  }

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
    const p = requireProvider();

    // SWR cache-first cold read (F6 CP6, D11 sibling of fetch-thread). Only plain label reads are
    // eligible: search (q) must hit the provider FTS, and pagination (pageToken) must stay strictly
    // sequential — both bypass the cache and take the direct flow below.
    const swrEligible = !req.q && !req.pageToken;
    if (swrEligible) {
      const cached = cache.getThreads(req.labelIds?.[0]);
      if (cached.length > 0) {
        // Warm cache: return the cached page immediately, then revalidate in the background and ship
        // a pure diff (renderer merges via applyThreadsDiff, zero refetch).
        void (async () => {
          try {
            const fresh = await p.listThreads(req);
            cache.upsertThreads(fresh.threads);
            // Per-thread JSON diff vs what we just returned — new/changed summaries become upserts.
            // JSON.stringify is acceptable at page size (≤50 rows); the cache row order (rowToSummary)
            // and the provider summary order match, so an unchanged page yields zero upserts (no send).
            //
            // removals are deliberately NOT computed: a ≤50-row page can't tell "archived elsewhere"
            // from "beyond this page", and applyThreadsDiff already drops any upsert whose fresh
            // labelIds no longer include the current view label (label-change removal). A genuine
            // server-side delete is rare and converges via the 60s poll (needsRefetch). D1's removals[]
            // stays reserved for that daemon-origin path.
            //
            // Real-account risk (D14 backlog): an eventually-consistent fresh page could momentarily
            // re-upsert a just-archived thread. The mock provider is synchronous (modifyThread updates
            // its own store before this refetch), so E2E is unaffected.
            const prev = new Map(cached.map((t) => [t.id, JSON.stringify(t)]));
            const upserts = fresh.threads.filter((t) => prev.get(t.id) !== JSON.stringify(t));
            if (upserts.length > 0) {
              notifyThreadsChanged(getWindow, { upserts, removals: [], needsRefetch: false });
            }
          } catch (err) {
            // offline/transient — the cached list is already on screen, so stay quiet. Still an
            // attempt-based signal (D9): flip online=false, but never throw out of the background task.
            if (classifyError(err) === 'transient') setOnline(false, () => emitSyncState(getWindow));
          }
        })();
        return { threads: cached };
      }
    }

    // Cold miss / search / pagination — fetch from the provider, cache it, return (unchanged flow).
    const res = await p.listThreads(req);
    cache.upsertThreads(res.threads);
    return res;
  });

  ipcMain.handle('mail:fetch-thread', async (_e, threadId: string) => {
    const p = requireProvider();

    // opportunistic follow-up resolution (D7): reuse an already-fetched detail, no extra API call.
    const resolveFollowup = (detail: ThreadDetail) => {
      const followup = cache.getFollowup(threadId);
      if (followup && followup.status === 'pending') {
        const meEmail = p.email.toLowerCase();
        const replied = detail.messages.some(
          (m) => m.date > followup.baselineAt && m.from.email.toLowerCase() !== meEmail
        );
        if (replied) cache.removeFollowup(threadId);
      }
    };

    const cached = cache.getCachedThreadDetail(threadId);
    if (cached) {
      // SWR cache-hit (D11): return the cached detail immediately, revalidate in the background.
      void (async () => {
        try {
          const fresh = await p.getThread(threadId);
          cache.cacheThreadDetail(fresh);
          resolveFollowup(fresh);
          // JSON.stringify diff is acceptable at detail size (tens of messages); push
          // mail:thread-changed only when the fresh detail actually differs from what we returned.
          if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
            getWindow()?.webContents.send('mail:thread-changed', { threadId, detail: fresh });
          }
        } catch (err) {
          // offline etc. — the cached detail is already in the UI, so stay quiet. A transient
          // failure is still an attempt-based signal (D9): flip online=false, but never throw.
          if (classifyError(err) === 'transient') setOnline(false, () => emitSyncState(getWindow));
        }
      })();
      return cached;
    }

    // cold miss — fetch from the provider, cache it, resolve the follow-up, return (unchanged flow).
    const detail = await p.getThread(threadId);
    cache.cacheThreadDetail(detail);
    resolveFollowup(detail);
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
        // 등록은 send 성공 직후 — 뒤따르는 archive가 실패해도 리마인더는 유실되지 않아야 한다
        if (req.remindDays) {
          cache.addFollowup(result.threadId, Date.now(), Date.now() + req.remindDays * DAY_MS);
        }
        if (req.archive && req.threadId) {
          await p.modifyThread({
            threadId: req.threadId,
            addLabelIds: [],
            removeLabelIds: ['INBOX'],
          });
          // Keep the cache consistent with this main-side archive (D3). Unlike manual archive
          // (attemptOrEnqueue → applyLabelDelta), send&archive mutates the provider directly, so
          // without this the thread's cache row keeps INBOX. F6 CP6 made fetch-threads a cache-first
          // SWR read, and upsertThreads(fresh) can only heal *appearing* threads (re-writes rows) —
          // it never deletes, so a "should-disappear" archive left stale here would resurface on a
          // warm-cache read. Removing INBOX from the cache row now makes getThreads exclude it.
          cache.applyLabelDelta(req.threadId, [], ['INBOX']);
        }
        // Send completion is rare (≤1 per sent mail, 10s after the click) and mutates state the
        // renderer can't diff locally: a freshly-created thread id (archive) and a main-side followup
        // registration (remindDays) that the followup banner reads from listFollowups. So take the
        // needsRefetch path (refresh + refreshFollowups) rather than a pure diff — off the hot path,
        // this preserves the old threads-updated→refreshFollowups coupling exactly.
        notifyThreadsChanged(getWindow, { upserts: [], removals: [], needsRefetch: true });
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
    await attemptOrEnqueue(
      'modifyLabels',
      req.threadId,
      req.addLabelIds,
      req.removeLabelIds,
      { threadId: req.threadId, addLabelIds: req.addLabelIds, removeLabelIds: req.removeLabelIds },
      async () => {
        await maybeInjectDebugFailure();
        await requireProvider().modifyThread(req);
      }
    );
  });

  ipcMain.handle('mail:snooze', async (_e, req: SnoozeRequest) => {
    const until = new Date(req.until).getTime();
    await attemptOrEnqueue(
      'snooze',
      req.threadId,
      // snooze label id is unknown until the provider resolves it (may fail offline), so the
      // optimistic cache delta only removes INBOX here (D3 note); drain re-resolves the label.
      [],
      ['INBOX'],
      // store the original SnoozeRequest — drain re-interprets it (label resolution + addSnooze).
      req,
      async () => {
        await maybeInjectDebugFailure();
        const p = requireProvider();
        const snoozeLabel = await p.snoozeLabelId();
        await p.modifyThread({
          threadId: req.threadId,
          addLabelIds: [snoozeLabel],
          removeLabelIds: ['INBOX'],
        });
        cache.addSnooze(req.threadId, until);
      },
      // snooze time is local truth — persist it on the queue paths too (transient/barrier), but
      // not on permanent failure (rethrow happens before onEnqueue), preserving TC-SP rollback.
      () => cache.addSnooze(req.threadId, until)
    );
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
    await maybeInjectDebugFailure();
    const now = Date.now();
    cache.addFollowup(threadId, now, now + remindDays * DAY_MS);
  });

  ipcMain.handle('mail:cancel-followup', async (_e, threadId: string) => {
    await maybeInjectDebugFailure();
    cache.removeFollowup(threadId);
  });

  ipcMain.handle('mail:dismiss-followup', async (_e, threadId: string) => {
    await maybeInjectDebugFailure();
    cache.removeFollowup(threadId);
  });

  ipcMain.handle('mail:list-followups', async (): Promise<FollowupInfo[]> => {
    return cache.listFollowups();
  });

  // D9 accelerator: the renderer's `online` event forces an immediate drain attempt (CP3 daemon
  // registers the reconnect hook) and marks us online, rather than waiting for the 60s backstop.
  ipcMain.handle('mail:renderer-online', async () => {
    setOnline(true, () => emitSyncState(getWindow));
    triggerReconnect();
  });

  // E2E-only debug IPC — never registered unless ZENMAIL_E2E_PORT is set (see e2e/).
  if (process.env.ZENMAIL_E2E_PORT) {
    ipcMain.handle('mail:debug-simulate-reply', async (_e, threadId: string) => {
      if (provider instanceof MockGmailProvider) {
        provider.simulateReply(threadId);
        // the new inbound message lives only in the mock provider, not the cache — the renderer
        // must refetch to see it (needsRefetch), same as the daemon-origin path.
        notifyThreadsChanged(getWindow, { upserts: [], removals: [], needsRefetch: true });
      }
    });

    ipcMain.handle('mail:debug-tick', async () => {
      await runDaemonTickNow();
    });

    ipcMain.handle('mail:debug-add-followup-due-now', async (_e, threadId: string) => {
      const now = Date.now();
      cache.addFollowup(threadId, now, now);
    });

    ipcMain.handle('mail:debug-fail-next-modify', async () => {
      debugFailNextModify = true;
    });

    // D13: offline simulation is a *coded* throw (ECONNRESET) from the mock provider, distinct from
    // the generic (permanent) debug-fail injection above. Toggling this is the only way the write
    // path diverges from its pre-CP2 behavior.
    ipcMain.handle('mail:debug-set-online', async (_e, v: boolean) => {
      if (provider instanceof MockGmailProvider) provider.setOffline(!v);
      setOnline(v, () => emitSyncState(getWindow));
      emitSyncState(getWindow);
    });

    ipcMain.handle('mail:debug-queue-depth', async (): Promise<number> => {
      return cache.mutationQueueDepth();
    });
  }
}
