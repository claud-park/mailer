import { useEffect } from 'react';
import { useMailStore } from '../store/mail';

const POLL_MS = 60_000;

/**
 * Keeps the thread list fresh: initial load, main-process push updates
 * (poll / snooze wake / undo-send completion), and a periodic poll.
 */
export function useThreads(): void {
  const signedIn = useMailStore((s) => !!s.account);

  useEffect(() => {
    if (!signedIn) return;
    const { refresh, showToast, refreshFollowups } = useMailStore.getState();

    // F6 CP5 (D1): the sole change channel. Mutation-origin pushes carry a diff we merge into the
    // store with zero refetch; daemon-origin pushes (needsRefetch) trigger a full refresh instead.
    const offChanged = window.zenmail.onThreadsChanged((p) => {
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
    const offSnooze = window.zenmail.onSnoozeFired(() => showToast('A snoozed thread is back'));

    // SWR revalidate merge (F6 CP4, D11): apply the fresh detail only if it's still the open
    // thread — never re-fetch (the payload is authoritative). Stale pushes are dropped by the guard.
    const offThreadChanged = window.zenmail.onThreadChanged((p) => {
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
      offThreadChanged();
      clearInterval(poll);
      window.removeEventListener('online', onOnline);
    };
  }, [signedIn]);
}
