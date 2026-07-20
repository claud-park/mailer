import crypto from 'node:crypto';
import fs from 'node:fs';
import { app, ipcMain, type BrowserWindow } from 'electron';
import type { Auth } from 'googleapis';
import type {
  AccountsSnapshot,
  CalendarEvent,
  CreateEventInput,
  FetchThreadsRequest,
  FollowupInfo,
  Label,
  ModifyLabelsRequest,
  RsvpResponse,
  SendReceipt,
  SendRequest,
  SnoozeRequest,
  SplitDefinition,
  ThreadDetail,
} from '../shared/types';
import { classifyError } from '../shared/sync';
import * as accounts from './accounts';
import * as auth from './auth';
import { MockCalendarProvider, RealCalendarProvider, type CalendarProvider } from './calendar';
import { AccountCache } from './cache';
import { writeDownload } from './download';
import {
  DEMO_ACCOUNT_EMAILS,
  DEMO_VIP_EMAIL,
  MockGmailProvider,
  RealGmailProvider,
  type GmailProvider,
} from './gmail';
import { getCachedOrFetch, isPrefetchableUrlE2E } from './image-cache';
import { debugNotificationLog, setDebugFocusOverride, updateDockBadge } from './notify';
import { computeRevalidateDiff } from './revalidate';
import { runDaemonTickNow } from './snooze';
import {
  emitSyncState,
  notifyThreadsChanged,
  registerPendingCounter,
  setOnline,
  triggerReconnect,
} from './sync-state';
import { viewMembershipLabels } from '../shared/view';

const UNDO_WINDOW_MS = 10_000;
const DAY_MS = 86_400_000;

/**
 * multi-account: 한 계정의 런타임 컨텍스트. provider === null ⇔ needsReauth (토큰 복원/갱신 실패
 * 격리 — 이 계정의 mail IPC는 reject, 다른 계정 무영향). cache는 계정별 SQLite 핸들.
 */
export interface AccountContext {
  email: string;
  demo: boolean;
  provider: GmailProvider | null; // null ⇔ needsReauth
  calendarProvider: CalendarProvider | null;
  calendarReady: boolean;
  cache: AccountCache;
  needsReauth: boolean;
  unreadCount: number;
  /** new-mail-alerts D9/D10: 마지막으로 관측한 "Inbox∪Starred, unread" 스레드 ID 집합. 아직 한
   *  번도 못 가져왔으면 undefined(= 이 계정에 대한 첫 상세 조회 — baseline만 시딩하고 알림은 쏘지
   *  않는다, notify.ts의 diffNewUnread). sign-out 시 contexts.delete와 함께 자동 GC(D10) — 별도
   *  초기화·정리 코드 불필요. */
  lastKnownUnreadIds?: Set<string>;
}

const contexts = new Map<string, AccountContext>();
/** main측 활성 계정 — debug hook 기본 대상 + accounts.json activeEmail 미러(실계정 한정 영속). */
let activeEmail: string | null = null;

/** E2E-only: 데모에서 calendarReady 게이트를 강제로 덮어씀(null이면 계산값 사용). 전역(활성 데모 대상). */
let debugCalendarReady: boolean | null = null;

/** E2E-only: 다운로드 저장 디렉터리 오버라이드(null이면 OS Downloads 사용). */
let downloadDirOverride: string | null = null;
function downloadsDir(): string {
  return downloadDirOverride ?? app.getPath('downloads');
}

/** E2E-only: 원격 이미지 캐시 디렉터리 오버라이드(null이면 accounts.imageCacheDir(email) 사용). */
let imageCacheDirOverride: string | null = null;

export function getContexts(): AccountContext[] {
  return [...contexts.values()];
}
export function getActiveEmail(): string | null {
  return activeEmail;
}
const activeCtx = (): AccountContext | undefined => (activeEmail ? contexts.get(activeEmail) : undefined);

function requireContext(accountId: string): AccountContext & { provider: GmailProvider } {
  const ctx = contexts.get(accountId);
  if (!ctx) throw new Error(`Unknown account ${accountId}`);
  if (!ctx.provider) throw new Error(`Account needs re-auth: ${accountId}`);
  return ctx as AccountContext & { provider: GmailProvider };
}

function requireCalendarProvider(accountId: string): CalendarProvider {
  const ctx = requireContext(accountId);
  if (!ctx.calendarProvider) throw new Error('Not signed in (calendar)');
  return ctx.calendarProvider;
}

export function accountsSnapshot(): AccountsSnapshot {
  return {
    accounts: getContexts().map((c) => ({
      email: c.email,
      demo: c.demo,
      calendarReady: c.demo ? (debugCalendarReady ?? true) : c.calendarReady,
      unreadCount: c.unreadCount,
      needsReauth: c.needsReauth,
    })),
    activeEmail,
  };
}

export function pushAccountsChanged(getWindow: () => BrowserWindow | null): void {
  getWindow()?.webContents.send('auth:accounts-changed', accountsSnapshot());
}

function makeRealContext(session: {
  client: Auth.OAuth2Client;
  email: string;
  calendarReady: boolean;
}): AccountContext {
  return {
    email: session.email,
    demo: false,
    provider: new RealGmailProvider(session.client, session.email),
    calendarProvider: new RealCalendarProvider(session.client, session.email),
    calendarReady: session.calendarReady,
    cache: new AccountCache(accounts.accountDbPath(session.email)),
    needsReauth: false,
    unreadCount: 0,
  };
}

function makeReauthContext(email: string): AccountContext {
  return {
    email,
    demo: false,
    provider: null,
    calendarProvider: null,
    calendarReady: false,
    cache: new AccountCache(accounts.accountDbPath(email)),
    needsReauth: true,
    unreadCount: 0,
  };
}

function makeDemoContext(email: string): AccountContext {
  return {
    email,
    demo: true,
    provider: new MockGmailProvider(email),
    calendarProvider: new MockCalendarProvider(),
    calendarReady: true,
    cache: new AccountCache(accounts.accountDbPath(email)),
    needsReauth: false,
    unreadCount: 0,
  };
}

/** 앱 부팅: accounts.json의 전 실계정 컨텍스트 복원. 토큰 실패 계정은 needsReauth로 격리(부분 실패 허용). */
export async function initAccounts(): Promise<void> {
  const file = accounts.readAccounts();
  for (const a of file.accounts) {
    if (a.demo) continue; // 데모는 비영속(D3) — 방어적 스킵
    try {
      const session = await auth.getAuthorizedClient(a.email);
      contexts.set(a.email, session ? makeRealContext(session) : makeReauthContext(a.email));
    } catch (err) {
      console.warn('[accounts] restore failed, marking needsReauth:', a.email, err);
      contexts.set(a.email, makeReauthContext(a.email));
    }
  }
  activeEmail =
    file.activeEmail && contexts.has(file.activeEmail)
      ? file.activeEmail
      : (getContexts()[0]?.email ?? null);
}

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

const pendingSends = new Map<string, { timer: NodeJS.Timeout; accountId: string }>();

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  // 전 계정 합산 pending 집계를 sync-state에 등록(sync-state는 cache를 직접 알지 않는다).
  registerPendingCounter(() =>
    getContexts().reduce(
      (n, c) => n + c.cache.mutationQueueDepth() + c.cache.overdueScheduledSendCount(Date.now()),
      0
    )
  );

  // F6 CP5 (D1): mutation-origin diff push. Re-read the affected row from cache (its optimistic
  // label delta already applied) and ship it as an upsert. The renderer decides upsert-vs-remove
  // against its *current* view label, so main never needs to know which list is on screen. A thread
  // absent from cache is skipped (60s poll converges). removals[] is reserved for server-vanished ids.
  const pushThreadUpsert = (ctx: AccountContext, threadId: string) => {
    const summary = ctx.cache.getThreadSummary(threadId);
    if (summary) notifyThreadsChanged(getWindow, { accountId: ctx.email, upserts: [summary], removals: [] });
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
    ctx: AccountContext & { provider: GmailProvider },
    kind: string,
    threadId: string,
    addLabelIds: string[],
    removeLabelIds: string[],
    payload: object,
    doProvider: () => Promise<void>,
    onEnqueue?: () => void
  ): Promise<void> {
    ctx.cache.applyLabelDelta(threadId, addLabelIds, removeLabelIds);

    if (ctx.cache.hasPendingMutations(threadId)) {
      onEnqueue?.();
      ctx.cache.enqueueMutation(kind, threadId, payload, Date.now());
      emitSyncState(getWindow);
      return;
    }

    try {
      await doProvider();
      setOnline(true, () => emitSyncState(getWindow));
      pushThreadUpsert(ctx, threadId);
    } catch (err) {
      if (classifyError(err) === 'permanent') {
        // The renderer rolls its store back on reject (F4) — mirror that in the cache, or a
        // cold read after a permanent failure would paint the never-applied optimistic state (D3).
        ctx.cache.applyLabelDelta(threadId, removeLabelIds, addLabelIds);
        throw err;
      }
      onEnqueue?.();
      ctx.cache.enqueueMutation(kind, threadId, payload, Date.now());
      setOnline(false);
      emitSyncState(getWindow);
    }
  }

  // --- account lifecycle ---

  // 로그인/데모 진입 직후 1회 배지 시딩 — 데몬의 첫 틱(최대 60s)을 기다리지 않고 초기 배지를 표시한다.
  // 데몬 틱의 배지 루프(snooze.ts)와 동일한 조건(needsReauth 스킵, 계정별 격리)을 공유한다.
  async function refreshBadges(): Promise<void> {
    let badgeChanged = false;
    for (const ctx of getContexts()) {
      if (!ctx.provider) continue; // needsReauth 계정은 스킵
      try {
        const n = await ctx.provider.inboxUnreadCount();
        if (n !== ctx.unreadCount) {
          ctx.unreadCount = n;
          badgeChanged = true;
        }
      } catch (err) {
        console.error('[badges] refresh failed', ctx.email, err); // transient — 다음 틱에 재시도
      }
    }
    // new-mail-alerts R1: dock 배지는 로그인/데모 진입 직후에도 바로 정확한 값을 보여야 한다 —
    // 알림 발화 로직과는 무관한 순수 카운트 합산이라 여기서 호출해도 콜드스타트 안전(D9)을 해치지
    // 않는다(알림은 데몬의 lastKnownUnreadIds 최초-관측 가드에서만 처리, 이 함수는 그대로 무변경).
    updateDockBadge(getContexts());
    if (badgeChanged) pushAccountsChanged(getWindow);
  }

  ipcMain.handle('auth:list-accounts', async (): Promise<AccountsSnapshot> => accountsSnapshot());

  ipcMain.handle('auth:add-account', async (): Promise<AccountsSnapshot> => {
    const email = await auth.signIn();
    const session = await auth.getAuthorizedClient(email);
    if (!session) throw new Error('Sign-in did not persist a session');
    contexts.get(email)?.cache.close(); // 재로그인(reauth)이면 기존 핸들 교체
    contexts.set(email, makeRealContext(session));
    accounts.addStoredAccount(email);
    if (!activeEmail) {
      activeEmail = email;
      accounts.setActiveEmail(email);
    }
    pushAccountsChanged(getWindow);
    void refreshBadges(); // await하지 않는다 — 로그인 응답 지연 금지
    return accountsSnapshot();
  });

  ipcMain.handle('auth:sign-in-demo', async (): Promise<AccountsSnapshot> => {
    for (const email of DEMO_ACCOUNT_EMAILS) {
      if (!contexts.has(email)) contexts.set(email, makeDemoContext(email));
    }
    activeEmail = DEMO_ACCOUNT_EMAILS[0]; // demo@zenmail.app — accounts.json엔 미영속(D3)
    debugCalendarReady = null; // 새 데모 세션은 게이트 오버라이드 초기화(기존 E3 시맨틱 보존)
    pushAccountsChanged(getWindow);
    void refreshBadges(); // await하지 않는다 — 로그인 응답 지연 금지
    return accountsSnapshot();
  });

  ipcMain.handle('auth:remove-account', async (_e, email: string): Promise<AccountsSnapshot> => {
    const ctx = contexts.get(email);
    if (ctx) {
      // 이 계정 소속 undo-window 타이머 정리 — 계정 제거 후 타이머가 발화하면 닫힌 cache 핸들을
      // 만진다(transient 실패 경로의 addScheduledSend → unhandled rejection).
      for (const [sendId, entry] of pendingSends) {
        if (entry.accountId === email) {
          clearTimeout(entry.timer);
          pendingSends.delete(sendId);
        }
      }
      if (!ctx.demo) await auth.signOut(email);
      ctx.cache.close();
      contexts.delete(email);
      // 계정 DB 파일 정리(원본 파괴는 명시적 제거 의도가 있는 이 경로에서만)
      for (const ext of ['', '-wal', '-shm']) {
        fs.rmSync(accounts.accountDbPath(email) + ext, { force: true });
      }
    }
    const file = accounts.removeStoredAccount(email);
    if (activeEmail === email) activeEmail = file.activeEmail ?? getContexts()[0]?.email ?? null;
    pushAccountsChanged(getWindow);
    return accountsSnapshot();
  });

  ipcMain.handle('auth:set-active-account', async (_e, email: string) => {
    if (!contexts.has(email)) throw new Error(`Unknown account ${email}`);
    activeEmail = email;
    accounts.setActiveEmail(email); // 미등록(데모) email이면 내부에서 no-op
  });

  // --- global settings (테마 등 — 계정 DB 아님) ---

  ipcMain.handle('settings:get-global', async (_e, key: string): Promise<string | null> => {
    return accounts.getGlobalSetting(key);
  });

  ipcMain.handle('settings:set-global', async (_e, key: string, value: string) => {
    accounts.setGlobalSetting(key, value);
  });

  // --- mail ---

  ipcMain.handle('mail:fetch-threads', async (_e, accountId: string, req: FetchThreadsRequest) => {
    const ctx = requireContext(accountId);
    const p = ctx.provider;

    // SWR cache-first cold read (F6 CP6, D11 sibling of fetch-thread). Only plain label reads are
    // eligible: search (q) must hit the provider FTS, and pagination (pageToken) must stay strictly
    // sequential — both bypass the cache and take the direct flow below.
    const swrEligible = !req.q && !req.pageToken;
    if (swrEligible) {
      const viewLabel = req.labelIds?.[0] ?? 'INBOX';
      const cached = ctx.cache.getThreads(viewLabel);
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
              ctx.cache.hasPendingMutations(id) ||
              ctx.cache.localDeltaSince(id, fetchStartedAt - GRACE_MS);
            // 뷰 전체 캐시 행을 stripping 전에 열거(removal 후보 소스).
            const viewRows = ctx.cache.getViewRows(viewLabel);
            const { upserts, removals, freshRowsToCache } = computeRevalidateDiff(cached, fresh, viewRows, {
              guarded,
              isSnoozed: (id) => ctx.cache.isSnoozed(id),
            });
            ctx.cache.upsertThreads(freshRowsToCache);
            for (const id of removals) {
              // 행 삭제가 아니라 뷰 라벨 스트립(INBOX/STARRED 뷰는 서로의 정의 라벨까지 함께
              // 벗김 — starred-view 최종 리뷰, view.ts의 viewMembershipLabels 주석 참조) —
              // FTS·타 라벨·undo용 행 보존, origin:'server'로 이 스트립이 다음 가드를 오염시키지
              // 않게 한다(D4/D3).
              ctx.cache.applyLabelDelta(id, [], viewMembershipLabels(viewLabel), { origin: 'server' });
            }
            if (upserts.length || removals.length) {
              notifyThreadsChanged(getWindow, { accountId: ctx.email, upserts, removals, needsRefetch: false });
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
    ctx.cache.upsertThreads(res.threads);
    return res;
  });

  ipcMain.handle('mail:fetch-thread', async (_e, accountId: string, threadId: string) => {
    const ctx = requireContext(accountId);
    const p = ctx.provider;

    // opportunistic follow-up resolution (D7): reuse an already-fetched detail, no extra API call.
    const resolveFollowup = (detail: ThreadDetail) => {
      const followup = ctx.cache.getFollowup(threadId);
      if (followup && followup.status === 'pending') {
        const meEmail = p.email.toLowerCase();
        const replied = detail.messages.some(
          (m) => m.date > followup.baselineAt && m.from.email.toLowerCase() !== meEmail
        );
        if (replied) ctx.cache.removeFollowup(threadId);
      }
    };

    const cached = ctx.cache.getCachedThreadDetail(threadId);
    if (cached) {
      // SWR cache-hit (D11): return the cached detail immediately, revalidate in the background.
      void (async () => {
        try {
          const fresh = await p.getThread(threadId);
          ctx.cache.cacheThreadDetail(fresh);
          resolveFollowup(fresh);
          // JSON.stringify diff is acceptable at detail size (tens of messages); push
          // mail:thread-changed only when the fresh detail actually differs from what we returned.
          if (JSON.stringify(fresh) !== JSON.stringify(cached)) {
            getWindow()?.webContents.send('mail:thread-changed', { accountId: ctx.email, threadId, detail: fresh });
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
    ctx.cache.cacheThreadDetail(detail);
    resolveFollowup(detail);
    return detail;
  });

  ipcMain.handle('mail:fetch-labels', async (_e, accountId: string) => {
    return requireContext(accountId).provider.listLabels();
  });

  ipcMain.handle('mail:create-label', async (_e, accountId: string, name: string): Promise<Label> => {
    return requireContext(accountId).provider.createLabel(name);
  });

  ipcMain.handle('mail:delete-label', async (_e, accountId: string, labelId: string): Promise<void> => {
    await requireContext(accountId).provider.deleteLabel(labelId);
  });

  ipcMain.handle('mail:send', async (_e, accountId: string, req: SendRequest): Promise<SendReceipt> => {
    const ctx = requireContext(accountId);
    const p = ctx.provider;
    const sendId = crypto.randomUUID();

    if (req.sendAt) {
      // schedule send: persist and let the daemon fire it
      const sendAt = new Date(req.sendAt).getTime();
      ctx.cache.addScheduledSend(sendId, req, sendAt);
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
          ctx.cache.addScheduledSend(sendId, req, Date.now());
          setOnline(false);
          emitSyncState(getWindow);
        } else {
          console.error('[send] failed', err);
          getWindow()?.webContents.send('mail:mutation-permanent-failed', {
            accountId: ctx.email,
            threadId: req.threadId ?? null,
            kind: 'send',
          });
        }
        return;
      }
      try {
        // 등록은 send 성공 직후 — 뒤따르는 archive가 실패해도 리마인더는 유실되지 않아야 한다
        if (req.remindDays) {
          ctx.cache.addFollowup(result.threadId, Date.now(), Date.now() + req.remindDays * DAY_MS);
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
          ctx.cache.applyLabelDelta(req.threadId, [], ['INBOX']);
        }
        // Send completion is rare (≤1 per sent mail, 10s after the click) and mutates state the
        // renderer can't diff locally: a freshly-created thread id (archive) and a main-side followup
        // registration (remindDays) that the followup banner reads from listFollowups. So take the
        // needsRefetch path (refresh + refreshFollowups) rather than a pure diff — off the hot path,
        // this preserves the old threads-updated→refreshFollowups coupling exactly.
        notifyThreadsChanged(getWindow, { accountId: ctx.email, upserts: [], removals: [], needsRefetch: true });
      } catch (err) {
        // send itself succeeded — a failure here (followup/archive) must NOT spill to
        // scheduled_sends (that would re-send and double-deliver the message).
        console.error('[send] failed', err);
      }
    }, UNDO_WINDOW_MS);
    pendingSends.set(sendId, { timer, accountId: ctx.email });
    return { sendId, sendAt };
  });

  ipcMain.handle('mail:cancel-send', async (_e, accountId: string, sendId: string): Promise<boolean> => {
    const entry = pendingSends.get(sendId);
    if (entry) {
      clearTimeout(entry.timer);
      pendingSends.delete(sendId);
      return true;
    }
    // scheduled send? — 계정이 이미 제거됐을 수 있으므로 requireContext 대신 관용화(no-op)
    contexts.get(accountId)?.cache.removeScheduledSend(sendId);
    return true;
  });

  ipcMain.handle('mail:modify-labels', async (_e, accountId: string, req: ModifyLabelsRequest) => {
    const ctx = requireContext(accountId);
    await attemptOrEnqueue(
      ctx,
      'modifyLabels',
      req.threadId,
      req.addLabelIds,
      req.removeLabelIds,
      { threadId: req.threadId, addLabelIds: req.addLabelIds, removeLabelIds: req.removeLabelIds },
      async () => {
        await maybeInjectDebugFailure();
        await ctx.provider.modifyThread(req);
      }
    );
  });

  ipcMain.handle('mail:snooze', async (_e, accountId: string, req: SnoozeRequest) => {
    const ctx = requireContext(accountId);
    const until = new Date(req.until).getTime();
    await attemptOrEnqueue(
      ctx,
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
        const snoozeLabel = await ctx.provider.snoozeLabelId();
        await ctx.provider.modifyThread({
          threadId: req.threadId,
          addLabelIds: [snoozeLabel],
          removeLabelIds: ['INBOX'],
        });
        ctx.cache.addSnooze(req.threadId, until);
      },
      // snooze time is local truth — persist it on the queue paths too (transient/barrier), but
      // not on permanent failure (rethrow happens before onEnqueue), preserving TC-SP rollback.
      () => ctx.cache.addSnooze(req.threadId, until)
    );
  });

  // undo-toast D5: 스누즈 취소 — 원래 라벨(INBOX) 복원 성공을 확인한 뒤에만 대기 중인 스누즈 행을
  // 제거한다(mail:snooze와 대칭, 큐잉 없이 즉시 처리 — undo 창은 5초로 짧아 오프라인 큐잉 이점이
  // 적다). 순서가 중요하다 — 먼저 캐시에서 스누즈 행을 지우고 나중에 modifyThread가 실패하면,
  // 데몬이 더 이상 이 스레드를 깨울 방법이 없는 채로 서버엔 스누즈 라벨이 영구히 남는다.
  //
  // D9: 여기서 캐시 행(label_ids)에 곧바로 applyLabelDelta로 INBOX를 반영해보는 시도는 되돌렸다 —
  // E2E(TC-UNDO-A4, reload 후 생존 확인)에서 2/2 재현되는 회귀를 만들었고(정확한 원인은 미확정 —
  // localDeltaAt 가드/revalidate 타이밍과의 상호작용으로 추정), 이 캐시 갱신 자체는 리뷰가 Minor·
  // self-healing(다음 revalidate가 provider의 fresh 상태로 자연히 upsert)로 판정한 항목이라 원래
  // 동작(캐시는 다음 revalidate가 치유)으로 롤백하는 편이 새 회귀를 감수하는 것보다 안전하다.
  ipcMain.handle('mail:cancel-snooze', async (_e, accountId: string, threadId: string): Promise<void> => {
    const ctx = requireContext(accountId);
    const snoozeLabel = await ctx.provider.snoozeLabelId();
    await ctx.provider.modifyThread({
      threadId,
      addLabelIds: ['INBOX'],
      removeLabelIds: [snoozeLabel],
    });
    ctx.cache.removeSnooze(threadId);
  });

  ipcMain.handle('mail:search-local', async (_e, accountId: string, q: string) => {
    return requireContext(accountId).cache.searchLocal(q);
  });

  ipcMain.handle('mail:contacts', async (_e, accountId: string, prefix: string) => {
    return requireContext(accountId).cache.listContacts(prefix);
  });

  ipcMain.handle('mail:get-splits', async (_e, accountId: string): Promise<SplitDefinition[]> => {
    const ctx = requireContext(accountId);
    const existing = ctx.cache.getSplits();
    if (existing.length > 0) return existing;

    const accountDomain = ctx.provider.email.split('@')[1] ?? '';
    // demo mode only: seed VIP with a sender from the mock data so the split is demonstrable out of the box.
    // work 데모 계정엔 demo VIP 발신자가 없으므로 시드하지 않는다(계정 오염 방지).
    const vipEmails = ctx.demo && ctx.email === 'demo@zenmail.app' ? [DEMO_VIP_EMAIL] : [];
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
    ctx.cache.replaceSplits(seeded);
    return seeded;
  });

  ipcMain.handle('mail:set-splits', async (_e, accountId: string, defs: SplitDefinition[]) => {
    requireContext(accountId).cache.replaceSplits(defs);
  });

  ipcMain.handle('mail:get-setting', async (_e, accountId: string, key: string): Promise<string | null> => {
    return requireContext(accountId).cache.getSetting(key);
  });

  ipcMain.handle('mail:set-setting', async (_e, accountId: string, key: string, value: string) => {
    requireContext(accountId).cache.setSetting(key, value);
  });

  ipcMain.handle('mail:add-followup', async (_e, accountId: string, threadId: string, remindDays: number) => {
    await maybeInjectDebugFailure();
    const now = Date.now();
    requireContext(accountId).cache.addFollowup(threadId, now, now + remindDays * DAY_MS);
  });

  ipcMain.handle('mail:cancel-followup', async (_e, accountId: string, threadId: string) => {
    await maybeInjectDebugFailure();
    requireContext(accountId).cache.removeFollowup(threadId);
  });

  ipcMain.handle('mail:dismiss-followup', async (_e, accountId: string, threadId: string) => {
    await maybeInjectDebugFailure();
    requireContext(accountId).cache.removeFollowup(threadId);
  });

  ipcMain.handle('mail:list-followups', async (_e, accountId: string): Promise<FollowupInfo[]> => {
    return requireContext(accountId).cache.listFollowups();
  });

  // D9 accelerator: the renderer's `online` event forces an immediate drain attempt (CP3 daemon
  // registers the reconnect hook) and marks us online, rather than waiting for the 60s backstop.
  ipcMain.handle('mail:renderer-online', async () => {
    setOnline(true, () => emitSyncState(getWindow));
    triggerReconnect();
  });

  // --- calendar ---

  ipcMain.handle('calendar:list-events', async (_e, accountId: string, timeMinISO: string, timeMaxISO: string): Promise<CalendarEvent[]> => {
    return requireCalendarProvider(accountId).listEvents(timeMinISO, timeMaxISO);
  });

  ipcMain.handle('calendar:respond', async (_e, accountId: string, iCalUID: string, response: RsvpResponse): Promise<void> => {
    await requireCalendarProvider(accountId).respondToEvent(iCalUID, response);
  });

  ipcMain.handle('calendar:create', async (_e, accountId: string, input: CreateEventInput): Promise<CalendarEvent> => {
    return requireCalendarProvider(accountId).createEvent(input);
  });

  // --- attachments ---

  ipcMain.handle(
    'mail:get-attachment-image',
    async (
      _e,
      accountId: string,
      messageId: string,
      attachmentId: string,
      mimeType: string
    ): Promise<{ dataUri: string; mimeType: string } | { error: string }> => {
      try {
        // 매 호출 fresh fetch — sqlite 무저장(D5). Gmail은 base64url 반환 → data URI용 표준 base64로 정규화.
        const data = await requireContext(accountId).provider.getAttachment(messageId, attachmentId);
        const b64 = Buffer.from(data, 'base64url').toString('base64');
        return { dataUri: `data:${mimeType};base64,${b64}`, mimeType };
      } catch (err) {
        console.error('[attachment] get-image failed', err);
        return { error: String(err) };
      }
    }
  );

  ipcMain.handle(
    'mail:download-attachment',
    async (
      _e,
      accountId: string,
      messageId: string,
      attachmentId: string,
      filename: string
    ): Promise<{ savedPath: string } | { error: string }> => {
      try {
        const data = await requireContext(accountId).provider.getAttachment(messageId, attachmentId);
        const savedPath = await writeDownload(downloadsDir(), filename, Buffer.from(data, 'base64url'));
        return { savedPath };
      } catch (err) {
        console.error('[attachment] download failed', err);
        return { error: String(err) };
      }
    }
  );

  // --- remote image prefetch cache ---

  ipcMain.handle(
    'mail:get-remote-image',
    async (_e, accountId: string, url: string): Promise<{ dataUri: string; mimeType: string } | { error: string }> => {
      try {
        const ctx = requireContext(accountId);
        // Task 10 정정(FR11/FR16 상충): 이 IPC를 호출할지 말지(자동 mount 시점 vs 게이트 버튼 클릭
        // 시점)는 이미 렌더러(ThreadView.tsx MessageCard)가 autoLoadRemoteImages 전역 설정을 보고
        // 결정한 뒤다 — 호출이 들어온 이상 항상 실제 로드 의도(자동이든 수동 동의든)이므로 여기서
        // 전역 설정을 다시 검사해 fetchLive를 결정하면 안 된다. 원래 FR11 그대로 구현했더니 토글
        // off일 때(=게이트 버튼이 보이는 바로 그 상황) 클릭해도 fetchLive=false가 되어 캐시 miss
        // 시 항상 { error: 'not cached' }만 반환 — FR16이 약속한 "회귀 없는 완전한 게이트 폴백"이
        // 깨져 있었다(E2E로 처음 발견, TC-IMG-A3/B6). prefetch()도 항상 fetchLive:true를 쓴다 —
        // 이 IPC의 유일한 실제 호출부도 동일해야 일관적이다.
        const fetchLive = true;
        // E2E 전용: 하네스 로컬 이미지 서버(FR18) origin만 예외 허용 — 그 외 SSRF 가드는 그대로.
        const isAllowed = process.env.ZENMAIL_E2E_PORT ? isPrefetchableUrlE2E : undefined;
        return await getCachedOrFetch(ctx.cache, imageCacheDirOverride ?? accounts.imageCacheDir(accountId), url, {
          fetchLive,
          isAllowed,
        });
      } catch (err) {
        console.error('[image-cache] get-remote-image failed', err);
        return { error: String(err) };
      }
    }
  );

  // E2E-only debug IPC — never registered unless ZENMAIL_E2E_PORT is set (see e2e/).
  // 시그니처 무변경(내부적으로 main의 activeEmail 컨텍스트 대상, D6).
  if (process.env.ZENMAIL_E2E_PORT) {
    ipcMain.handle('mail:debug-simulate-reply', async (_e, threadId: string) => {
      const ctx = activeCtx();
      if (ctx?.provider instanceof MockGmailProvider) {
        ctx.provider.simulateReply(threadId);
        // the new inbound message lives only in the mock provider, not the cache — the renderer
        // must refetch to see it (needsRefetch), same as the daemon-origin path.
        notifyThreadsChanged(getWindow, { accountId: ctx.email, upserts: [], removals: [], needsRefetch: true });
      }
    });

    ipcMain.handle('mail:debug-tick', async () => {
      await runDaemonTickNow();
    });

    ipcMain.handle('mail:debug-add-followup-due-now', async (_e, threadId: string) => {
      const ctx = activeCtx();
      if (!ctx) return;
      const now = Date.now();
      ctx.cache.addFollowup(threadId, now, now);
    });

    ipcMain.handle('mail:debug-fail-next-modify', async () => {
      debugFailNextModify = true;
    });

    // TC-SY-B5: arm a one-shot permanent (4xx) failure for the next modifyThread on a specific
    // thread — reaches the daemon drain loop (unlike debugFailNextModify, which is scoped to the
    // modify-labels/snooze IPC handlers), so a queued offline mutation can be dropped on drain.
    ipcMain.handle('mail:debug-fail-next-modify-for-thread', async (_e, threadId: string) => {
      const ctx = activeCtx();
      if (ctx?.provider instanceof MockGmailProvider) ctx.provider.failNextModifyForThread(threadId);
    });

    // D13: offline simulation is a *coded* throw (ECONNRESET) from the mock provider, distinct from
    // the generic (permanent) debug-fail injection above. Toggling this is the only way the write
    // path diverges from its pre-CP2 behavior. 전 컨텍스트의 mock provider에 일괄 적용.
    ipcMain.handle('mail:debug-set-online', async (_e, v: boolean) => {
      for (const c of getContexts()) {
        if (c.provider instanceof MockGmailProvider) c.provider.setOffline(!v);
      }
      setOnline(v, () => emitSyncState(getWindow));
      emitSyncState(getWindow);
    });

    // 전 계정 합산 큐 깊이.
    ipcMain.handle('mail:debug-queue-depth', async (): Promise<number> => {
      return getContexts().reduce((n, c) => n + c.cache.mutationQueueDepth(), 0);
    });

    // TC-SY-D1: expose the mock provider's network-method call counters so E2E can prove that a
    // mutation's diff-push (notifyThreadsChanged upsert) never triggers a list refetch.
    ipcMain.handle('mail:debug-provider-calls', async (): Promise<Record<string, number>> => {
      const ctx = activeCtx();
      if (ctx?.provider instanceof MockGmailProvider) return { ...ctx.provider.callCounts };
      return {};
    });

    // inbox-zero-starred (TC-IZ-A1/A2): "Gmail 웹에서 아카이브" 재현 — mock provider 저장소에서만
    // INBOX를 벗긴다(캐시·modifyThread 부기 우회). 다음 revalidate가 캐시/리스트에서 수렴시켜야 한다.
    ipcMain.handle('mail:debug-external-archive', async (_e, threadId: string) => {
      const ctx = activeCtx();
      if (ctx?.provider instanceof MockGmailProvider) ctx.provider.externalArchive(threadId);
    });

    // starred-view D8 (TC-STAR-C1): "Gmail 웹에서 별표 해제" 재현 — mock provider 저장소에서만
    // STARRED를 벗긴다. 다음 revalidate가 Starred 뷰에서 수렴시켜야 한다.
    ipcMain.handle('mail:debug-external-unstar', async (_e, threadId: string) => {
      const ctx = activeCtx();
      if (ctx?.provider instanceof MockGmailProvider) ctx.provider.externalUnstar(threadId);
    });

    // new-mail-alerts (TC-ALT-*): 지정 계정의 데모 데이터셋에 새 unread 스레드 1건을 주입해 실제
    // 도착을 시뮬레이션한다(mock 전용). 이 훅만으로는 배지/알림 파이프라인이 반응하지 않는다 —
    // 기존 mail:debug-tick(runDaemonTickNow)을 뒤이어 호출해야 daemon이 증가를 관측한다.
    ipcMain.handle(
      'mail:debug-inject-new-mail',
      async (_e, accountId: string, opts?: { from?: string; subject?: string; bodyHtml?: string }) => {
        const ctx = contexts.get(accountId);
        if (ctx?.provider instanceof MockGmailProvider) ctx.provider.injectNewMail(opts);
      }
    );

    // new-mail-alerts (TC-ALT-D1/D2): real OS window focus can't be controlled deterministically
    // from an automated CDP harness — override the D5 focus gate directly (see notify.ts).
    ipcMain.handle('mail:debug-set-window-focused', async (_e, v: boolean) => {
      setDebugFocusOverride(v);
    });

    // new-mail-alerts (TC-ALT-B1/B2/D1/D2): native OS Notification objects have no CDP-visible
    // surface — expose the in-memory log notify.ts keeps of every notification it actually decided
    // to show (title/body), so E2E can assert count/content without touching a real OS banner.
    ipcMain.handle('mail:debug-notification-log', async (): Promise<Array<{ title: string; body: string }>> => {
      return [...debugNotificationLog];
    });

    // new-mail-alerts (TC-ALT-E1/E2/E3): a real OS notification banner click is Electron/OS's own
    // responsibility (not CDP-observable) — this reproduces only the *consequence* main's own click
    // handler would produce (fireNewMailNotification's `notification.on('click', ...)`), so E2E can
    // verify the renderer's routing (useThreads.ts onNotificationActivate) in isolation.
    ipcMain.handle(
      'mail:debug-notify-activate',
      async (_e, payload: { accountId: string | null; threadId: string | null }) => {
        getWindow()?.webContents.send('notify:activate', payload);
      }
    );

    // new-mail-alerts (TC-ALT-A1~A3, C1~C2, D1~D2): direct read of the actual OS dock badge value that
    // updateDockBadge sets (app.setBadgeCount) — independent of accountsSnapshot's own unreadCount
    // sum, so E2E can verify the real side effect rather than just the internal state it's derived from.
    ipcMain.handle('mail:debug-dock-badge', async (): Promise<number> => {
      return app.getBadgeCount();
    });

    ipcMain.handle('calendar:debug-state', async (): Promise<{ events: CalendarEvent[]; responses: Record<string, string> }> => {
      const ctx = activeCtx();
      if (ctx?.calendarProvider instanceof MockCalendarProvider) return ctx.calendarProvider.snapshot();
      return { events: [], responses: {} };
    });

    ipcMain.handle('calendar:debug-fail-next', async () => {
      const ctx = activeCtx();
      if (ctx?.calendarProvider instanceof MockCalendarProvider) ctx.calendarProvider.failNextCalendarCall();
    });

    // 데모 calendarReady 게이트 시뮬레이션. 렌더러가 다음 listAccounts(재시작/재로그인)에서 읽는다.
    ipcMain.handle('calendar:debug-set-ready', async (_e, v: boolean) => {
      debugCalendarReady = v;
    });

    ipcMain.handle('mail:debug-fail-next-attachment', async () => {
      const ctx = activeCtx();
      if (ctx?.provider instanceof MockGmailProvider) ctx.provider.failNextAttachmentCall();
    });

    // E2E 다운로드 dir 오버라이드 — 실제 사용자 Downloads 오염 방지 + 저장 경로/충돌 리네임 검증.
    ipcMain.handle('mail:debug-set-download-dir', async (_e, dir: string) => {
      downloadDirOverride = dir;
    });

    // E2E 이미지 캐시 dir 오버라이드 — 실제 userData/image-cache 오염 방지 + 캐시 히트/미스 검증.
    ipcMain.handle('mail:debug-set-image-cache-dir', async (_e, dir: string) => {
      imageCacheDirOverride = dir;
    });
  }
}
