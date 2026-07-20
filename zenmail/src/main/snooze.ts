import type { BrowserWindow } from 'electron';
import { NEW_MAIL_QUERY, type GmailProvider } from './gmail';
import type { AccountContext } from './ipc';
import { diffNewUnread, fireNewMailNotification, updateDockBadge } from './notify';
import type { ThreadSummary } from '../shared/types';
import { classifyError, isExhausted } from '../shared/sync';
import { emitSyncState, isOnline, notifyThreadsChanged, onReconnect, setOnline } from './sync-state';
import { extractRemoteImageUrls, isPrefetchableUrlE2E, prefetch, pruneCache } from './image-cache';
import { imageCacheDir } from './accounts';

const TICK_MS = 60_000;
const DAY_MS = 86_400_000;
const IMAGE_CACHE_MAX_BYTES = 200 * 1024 * 1024;

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
  getWindow: () => BrowserWindow | null,
  pushAccounts: () => void
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

      // 배지: 전 계정 INBOX 안읽음 수 갱신(1콜/계정/분, D7) — 값이 하나라도 바뀌면 스냅샷 push.
      // ipc.ts를 런타임 import하면 순환이 생기므로 pushAccounts 콜백으로 주입받는다(index.ts가 정본).
      //
      // new-mail-alerts D7/D8: 카운트가 순증(n > ctx.unreadCount)했을 때만 추가로 Inbox∪Starred
      // unread 상세(발신자/제목)를 1콜 더 가져와 diffNewUnread로 진짜 신규분만 골라낸다 — 감소/동일은
      // 기존과 동일하게 카운트만 갱신(추가 콜 없음, D7 비용 원칙 유지). 계정별 결과를 모아 틱 끝에서
      // 전역 합산 1회로 dock 배지 갱신 + 알림 발화한다(D1).
      let badgeChanged = false;
      const perAccountNew: Array<{ accountId: string; threads: ThreadSummary[] }> = [];
      for (const ctx of getContexts()) {
        if (!ctx.provider) continue; // needsReauth 계정은 스킵
        try {
          const n = await ctx.provider.inboxUnreadCount();
          if (n !== ctx.unreadCount) {
            if (n > ctx.unreadCount) {
              try {
                const { threads: current } = await ctx.provider.listThreads({ q: NEW_MAIL_QUERY });
                const { newThreads, nextIds } = diffNewUnread(current, ctx.lastKnownUnreadIds);
                ctx.lastKnownUnreadIds = nextIds;
                if (newThreads.length) {
                  perAccountNew.push({ accountId: ctx.email, threads: newThreads });
                  // remote-image-prefetch FR9: 오프라인 계정은 프리페치(네트워크 fetch)를 건너뛴다 —
                  // pruneCache는 디스크 정리일 뿐 네트워크가 필요 없어 오프라인이어도 계속 돈다(아래).
                  if (isOnline()) {
                    void prefetchNewThreadImages(ctx as AccountContext & { provider: GmailProvider }, newThreads).catch(
                      (err) => console.error('[daemon] image prefetch failed', ctx.email, err)
                    );
                  }
                }
              } catch (err) {
                // ctx.lastKnownUnreadIds is NOT updated on failure (still whatever it was), so this
                // batch isn't silently lost forever — a later tick where the count rises past this
                // level again will diff against the same stale baseline and catch the missed threads
                // too. It's not a guaranteed "retry next tick": if those threads get read before the
                // count rises further, this specific notification never fires (badge stays correct
                // either way). Accepted tradeoff — see new-mail-alerts DECISIONS.md D12.
                console.error('[daemon] new-mail detail fetch failed', ctx.email, err);
              }
            }
            ctx.unreadCount = n;
            badgeChanged = true;
          }
        } catch (err) {
          console.error('[daemon] badge refresh failed', ctx.email, err); // transient — 다음 틱에 재시도
        }
        // remote-image-prefetch NFR5: 이 틱에 새 프리페치가 없어도(또는 오프라인이어도) image_cache는
        // mail:get-remote-image on-demand 경로로도 계속 자라므로, 계정마다 매 틱 무조건 prune한다
        // (디스크 읽기뿐이라 저렴 — pruneCache는 상한 미만이면 즉시 no-op).
        pruneCache(ctx.cache, imageCacheDir(ctx.email), IMAGE_CACHE_MAX_BYTES);
      }
      updateDockBadge(getContexts());
      if (perAccountNew.length) fireNewMailNotification(perAccountNew, getWindow);
      if (badgeChanged) pushAccounts();
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

/**
 * remote-image-prefetch: newly-detected unread threads (new-mail-alerts' diffNewUnread output)
 * are prefetched into the account's image cache so their remote <img> content is already local by
 * the time the user opens them. listThreads(ThreadSummary[]) has no bodyHtml, so each new thread
 * needs its own getThread call to obtain it. getThread failures are isolated per-thread — one
 * thread's fetch failure never blocks prefetching the rest.
 */
async function prefetchNewThreadImages(
  ctx: AccountContext & { provider: GmailProvider },
  newThreads: ThreadSummary[]
): Promise<void> {
  const urls: string[] = [];
  for (const t of newThreads) {
    try {
      const detail = await ctx.provider.getThread(t.id);
      for (const msg of detail.messages) urls.push(...extractRemoteImageUrls(msg.bodyHtml));
    } catch (err) {
      console.error('[daemon] getThread for image prefetch failed', t.id, err);
    }
  }
  // pruneCache는 호출부(tick 루프)가 계정당 매 틱 무조건 돌린다 — 여기서 다시 부르지 않는다.
  // E2E 전용: 하네스 로컬 이미지 서버(FR18) origin만 예외 허용 — 그 외 SSRF 가드는 그대로.
  const isAllowed = process.env.ZENMAIL_E2E_PORT ? isPrefetchableUrlE2E : undefined;
  if (urls.length) await prefetch(ctx.cache, imageCacheDir(ctx.email), urls, isAllowed);
}

export function stopSnoozeDaemon(): void {
  if (timer) clearInterval(timer);
  timer = null;
  tickFn = null;
  onReconnect(null); // stale hook would otherwise fire a background tick after teardown (e.g. tests)
}

/** E2E-only: force a daemon tick to run to completion (see ZENMAIL_E2E_PORT gate in ipc.ts). */
export async function runDaemonTickNow(): Promise<void> {
  if (tickFn) await tickFn();
}
