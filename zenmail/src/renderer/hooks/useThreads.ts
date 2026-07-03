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

    const offUpdated = window.zenmail.onThreadsUpdated(() => {
      void refresh();
      void refreshFollowups();
    });
    const offSnooze = window.zenmail.onSnoozeFired(() => showToast('A snoozed thread is back'));
    const poll = setInterval(() => void refresh(), POLL_MS);

    return () => {
      offUpdated();
      offSnooze();
      clearInterval(poll);
    };
  }, [signedIn]);
}
