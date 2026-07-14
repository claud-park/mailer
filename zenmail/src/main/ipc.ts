import crypto from 'node:crypto';
import { ipcMain, type BrowserWindow } from 'electron';
import type {
  AccountInfo,
  CalendarEvent,
  CreateEventInput,
  FetchThreadsRequest,
  FollowupInfo,
  ModifyLabelsRequest,
  RsvpResponse,
  SendReceipt,
  SendRequest,
  SnoozeRequest,
  SplitDefinition,
  ThreadDetail,
} from '../shared/types';
import { classifyError } from '../shared/sync';
import * as auth from './auth';
import { MockCalendarProvider, RealCalendarProvider, type CalendarProvider } from './calendar';
import * as cache from './cache';
import { DEMO_VIP_EMAIL, MockGmailProvider, RealGmailProvider, type GmailProvider } from './gmail';
import { computeRevalidateDiff } from './revalidate';
import { runDaemonTickNow } from './snooze';
import { emitSyncState, notifyThreadsChanged, setOnline, triggerReconnect } from './sync-state';
import { viewMembershipLabels } from '../shared/view';

const UNDO_WINDOW_MS = 10_000;
const DAY_MS = 86_400_000;

let provider: GmailProvider | null = null;
let calendarProvider: CalendarProvider | null = null;
/** 현재 세션의 실제 calendar.events scope 보유 여부(데모는 true). */
let calendarReady = false;
/** E2E-only: 데모에서 calendarReady 게이트를 강제로 덮어씀(null이면 계산값 사용). */
let debugCalendarReady: boolean | null = null;

function currentCalendarReady(demo: boolean): boolean {
  if (debugCalendarReady !== null) return debugCalendarReady;
  return demo ? true : calendarReady;
}

function requireCalendarProvider(): CalendarProvider {
  if (!calendarProvider) throw new Error('Not signed in (calendar)');
  return calendarProvider;
}

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
    calendarProvider = new RealCalendarProvider(session.client, session.email);
    calendarReady = session.calendarReady;
    return { email: session.email, demo: false, calendarReady: currentCalendarReady(false) };
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
      if (classifyError(err) === 'permanent') {
        // The renderer rolls its store back on reject (F4) — mirror that in the cache, or a
        // cold read after a permanent failure would paint the never-applied optimistic state (D3).
        cache.applyLabelDelta(threadId, removeLabelIds, addLabelIds);
        throw err;
      }
      onEnqueue?.();
      cache.enqueueMutation(kind, threadId, payload, Date.now());
      setOnline(false);
      emitSyncState(getWindow);
    }
  }

  ipcMain.handle('auth:get-account', async (): Promise<AccountInfo | null> => {
    if (provider) return { email: provider.email, demo: provider.demo, calendarReady: currentCalendarReady(provider.demo) };
    return restoreSession();
  });

  ipcMain.handle('auth:sign-in', async (): Promise<AccountInfo> => {
    const email = await auth.signIn();
    const session = await auth.getAuthorizedClient();
    if (!session) throw new Error('Sign-in did not persist a session');
    provider = new RealGmailProvider(session.client, email);
    calendarProvider = new RealCalendarProvider(session.client, email);
    calendarReady = session.calendarReady;
    return { email, demo: false, calendarReady: currentCalendarReady(false) };
  });

  ipcMain.handle('auth:sign-in-demo', async (): Promise<AccountInfo> => {
    provider = new MockGmailProvider();
    calendarProvider = new MockCalendarProvider();
    calendarReady = true;
    debugCalendarReady = null; // 새 데모 세션은 게이트 오버라이드를 초기화(E3 재로그인 복귀)
    return { email: provider.email, demo: true, calendarReady: true };
  });

  ipcMain.handle('auth:sign-out', async () => {
    await auth.signOut();
    provider = null;
    calendarProvider = null;
    calendarReady = false;
    cache.clearFollowups();
    cache.clearLocalDeltaTracking();
  });

  ipcMain.handle('mail:fetch-threads', async (_e, req: FetchThreadsRequest) => {
    const p = requireProvider();

    // SWR cache-first cold read (F6 CP6, D11 sibling of fetch-thread). Only plain label reads are
    // eligible: search (q) must hit the provider FTS, and pagination (pageToken) must stay strictly
    // sequential — both bypass the cache and take the direct flow below.
    const swrEligible = !req.q && !req.pageToken;
    if (swrEligible) {
      const viewLabel = req.labelIds?.[0] ?? 'INBOX';
      const cached = cache.getThreads(viewLabel);
      if (cached.length > 0) {
        // Warm cache: return the cached page immediately, then revalidate in the background and ship
        // a pure diff (renderer merges via applyThreadsDiff, zero refetch).
        //
        // inbox-zero-starred D3/D4 — convergence rule (replaces the old "removals deliberately NOT
        // computed" absence, which this feature proved stale: a label lost outside ZenMail left INBOX
        // permanently in the cache row and every cold read re-served it — the 84-row bug).
        //  • upserts  : fresh 행 중 반환한 cached 페이지 JSON과 다른 것(신규 포함) — 기존 규칙 보존.
        //  • removals : 뷰 전체 캐시 행(getViewRows, LIMIT 없음) 중 fresh에서 사라진 것. fresh가
        //    완전-페이지(nextPageToken 없음)면 전량, 부분 창이면 min(fresh date) 이상만 제거(D4).
        //  • 가드     : hasPendingMutations ∨ localDeltaSince(grace) 인 id는 upsert·removal·캐시
        //    기록 3곳 모두에서 제외 — 방금 로컬 아카이브한 스레드가 스테일 fresh로 부활하지 않는다(D3).
        //    grace는 실계정에서만 15s(Gmail list 인덱스 전파 지연 추정치) — mock provider는 자체
        //    상태에 대해 항상 동기적으로 최신이라(list 지연이 존재하지 않음, 기존 D1 주석 "mock
        //    provider is synchronous... E2E is unaffected"의 전제와 동일) grace=0. 15s를 mock에도
        //    걸면 데몬(followup 발화 등, provider.modifyThread 직접 호출 후 needsRefetch)처럼 로컬
        //    아카이브 수 초 뒤에 합법적으로 라벨이 되돌아오는 케이스까지 최대 15초간 억제해 버려
        //    TC-FUP-D2류의 "정당한 복원 upsert가 가드에 막힘" 회귀를 낳는다(실측으로 발견, D3 갱신).
        //  • snoozed  : fresh에 있어도 캐시엔 안 쓰되 present로 카운트해 removal 후보에서 뺀다(D6).
        // 자세한 근거: docs/features/inbox-zero-starred/DECISIONS.md D3/D4.
        void (async () => {
          const fetchStartedAt = Date.now();
          const GRACE_MS = p.demo ? 0 : 15_000;
          try {
            const fresh = await p.listThreads(req);
            const guarded = (id: string) =>
              cache.hasPendingMutations(id) ||
              cache.localDeltaSince(id, fetchStartedAt - GRACE_MS);
            // 뷰 전체 캐시 행을 stripping 전에 열거(removal 후보 소스).
            const viewRows = cache.getViewRows(viewLabel);
            const { upserts, removals, freshRowsToCache } = computeRevalidateDiff(cached, fresh, viewRows, {
              guarded,
              isSnoozed: cache.isSnoozed,
            });
            cache.upsertThreads(freshRowsToCache);
            for (const id of removals) {
              // 행 삭제가 아니라 뷰 라벨 스트립(INBOX 뷰는 INBOX+STARRED 동시) — FTS·타 라벨·undo용
              // 행 보존, origin:'server'로 이 스트립이 다음 가드를 오염시키지 않게 한다(D4/D3).
              cache.applyLabelDelta(id, [], viewMembershipLabels(viewLabel), { origin: 'server' });
            }
            if (upserts.length || removals.length) {
              notifyThreadsChanged(getWindow, { upserts, removals, needsRefetch: false });
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
      let result;
      try {
        result = await p.send(req);
      } catch (err) {
        // F6 CP7 (D7): send spill. The message never actually left on a transient failure, so it's
        // safe to hand off to scheduled_sends for the daemon to retry (immediate due — see D7 note
        // on at-least-once). A permanent failure keeps the pre-CP7 console.error and additionally
        // tells the renderer so it can reconcile (no optimistic send-state to roll back today, but
        // the compose UI already closed — surface it via the shared permanent-failure channel).
        if (classifyError(err) === 'transient') {
          cache.addScheduledSend(sendId, req, Date.now());
          setOnline(false);
          emitSyncState(getWindow);
        } else {
          console.error('[send] failed', err);
          getWindow()?.webContents.send('mail:mutation-permanent-failed', {
            threadId: req.threadId ?? null,
            kind: 'send',
          });
        }
        return;
      }
      try {
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
        // send itself succeeded — a failure here (followup/archive) must NOT spill to
        // scheduled_sends (that would re-send and double-deliver the message).
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

  ipcMain.handle('calendar:list-events', async (_e, timeMinISO: string, timeMaxISO: string): Promise<CalendarEvent[]> => {
    return requireCalendarProvider().listEvents(timeMinISO, timeMaxISO);
  });

  ipcMain.handle('calendar:respond', async (_e, iCalUID: string, response: RsvpResponse): Promise<void> => {
    await requireCalendarProvider().respondToEvent(iCalUID, response);
  });

  ipcMain.handle('calendar:create', async (_e, input: CreateEventInput): Promise<CalendarEvent> => {
    return requireCalendarProvider().createEvent(input);
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

    // TC-SY-B5: arm a one-shot permanent (4xx) failure for the next modifyThread on a specific
    // thread — reaches the daemon drain loop (unlike debugFailNextModify, which is scoped to the
    // modify-labels/snooze IPC handlers), so a queued offline mutation can be dropped on drain.
    ipcMain.handle('mail:debug-fail-next-modify-for-thread', async (_e, threadId: string) => {
      if (provider instanceof MockGmailProvider) provider.failNextModifyForThread(threadId);
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

    // TC-SY-D1: expose the mock provider's network-method call counters so E2E can prove that a
    // mutation's diff-push (notifyThreadsChanged upsert) never triggers a list refetch.
    ipcMain.handle('mail:debug-provider-calls', async (): Promise<Record<string, number>> => {
      if (provider instanceof MockGmailProvider) return { ...provider.callCounts };
      return {};
    });

    // inbox-zero-starred (TC-IZ-A1/A2): "Gmail 웹에서 아카이브" 재현 — mock provider 저장소에서만
    // INBOX를 벗긴다(캐시·modifyThread 부기 우회). 다음 revalidate가 캐시/리스트에서 수렴시켜야 한다.
    ipcMain.handle('mail:debug-external-archive', async (_e, threadId: string) => {
      if (provider instanceof MockGmailProvider) provider.externalArchive(threadId);
    });

    ipcMain.handle('calendar:debug-state', async (): Promise<{ events: CalendarEvent[]; responses: Record<string, string> }> => {
      if (calendarProvider instanceof MockCalendarProvider) return calendarProvider.snapshot();
      return { events: [], responses: {} };
    });

    ipcMain.handle('calendar:debug-fail-next', async () => {
      if (calendarProvider instanceof MockCalendarProvider) calendarProvider.failNextCalendarCall();
    });

    // 데모 calendarReady 게이트 시뮬레이션. 렌더러가 다음 auth:get-account(재시작/재로그인)에서 읽는다.
    ipcMain.handle('calendar:debug-set-ready', async (_e, v: boolean) => {
      debugCalendarReady = v;
    });
  }
}
