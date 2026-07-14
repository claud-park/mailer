import { useEffect } from 'react';
import { useMailStore } from '../store/mail';

const POLL_MS = 60_000;

/**
 * Keeps the thread list fresh: initial load, main-process push updates
 * (poll / snooze wake / undo-send completion), and a periodic poll.
 */
export function useThreads(): void {
  const signedIn = useMailStore((s) => !!s.activeAccountId);

  useEffect(() => {
    if (!signedIn) return;
    const { refresh, showToast, refreshFollowups } = useMailStore.getState();
    // 활성 계정 diff/refetch만 반영 — 비활성 계정 push는 배지(accounts-changed)가 담당.
    const isActive = (accountId: string) => useMailStore.getState().activeAccountId === accountId;

    // F6 CP5 (D1): the sole change channel. Mutation-origin pushes carry a diff we merge into the
    // store with zero refetch; daemon-origin pushes (needsRefetch) trigger a full refresh instead.
    const offChanged = window.zenmail.onThreadsChanged((p) => {
      if (!isActive(p.accountId)) return; // 비활성 계정 diff/refetch는 무시
      if (p.needsRefetch) {
        void refresh();
        void refreshFollowups();
      } else {
        useMailStore.getState().applyThreadsDiff(p.upserts, p.removals);
        // both cheap local (non-network) reads, kept on the diff path to preserve the old
        // threads-updated coupling: loadLabels → sidebar unread badges; refreshFollowups → the
        // banner/pin state, which a mutation can flip main-side (e.g. markRead-on-open triggers
        // fetch-thread's opportunistic followup resolution — see TC-FUP-C2).
        void useMailStore.getState().loadLabels();
        void refreshFollowups();
      }
    });
    const offSnooze = window.zenmail.onSnoozeFired((p) => {
      if (isActive(p.accountId)) showToast('A snoozed thread is back');
    });

    // 계정 목록/배지/needsReauth 변화 — 스냅샷을 스토어에 미러.
    const offAccounts = window.zenmail.onAccountsChanged((snap) => {
      useMailStore.getState().applyAccountsSnapshot(snap);
    });

    // D10: sidebar sync line data — pure state mirror, no derived logic on the renderer side.
    const offSyncState = window.zenmail.onSyncState((s) => {
      useMailStore.setState({ sync: s });
    });
    // D10: a queued mutation/send exhausted retries — the renderer's optimistic state may be
    // stale (the server never got it), so reconcile with a real refresh() rather than trust it.
    const offMutationPermanentFailed = window.zenmail.onMutationPermanentFailed((p) => {
      if (!isActive(p.accountId)) return;
      showToast('Sync failed — changes reverted');
      void refresh();
    });

    // SWR revalidate merge (F6 CP4, D11): apply the fresh detail only if it's still the open
    // thread — never re-fetch (the payload is authoritative). Stale pushes are dropped by the guard.
    const offThreadChanged = window.zenmail.onThreadChanged((p) => {
      if (!isActive(p.accountId)) return;
      if (useMailStore.getState().activeThreadId === p.threadId) {
        useMailStore.setState({ activeThread: p.detail });
      }
    });

    const poll = setInterval(() => void refresh(), POLL_MS);

    // D9 accelerator: regaining connectivity forces an immediate drain instead of waiting for the poll.
    const onOnline = () => void window.zenmail.notifyOnline?.();
    window.addEventListener('online', onOnline);

    return () => {
      offChanged();
      offSnooze();
      offAccounts();
      offThreadChanged();
      offSyncState();
      offMutationPermanentFailed();
      clearInterval(poll);
      window.removeEventListener('online', onOnline);
    };
  }, [signedIn]);
}
