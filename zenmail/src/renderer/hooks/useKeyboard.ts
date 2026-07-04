import { useEffect } from 'react';
import { useMailStore } from '../store/mail';
import { useCoachStore } from '../store/coach';
import { toggleHud } from '../store/latency';
import { computeSplits } from '../lib/splits';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

/** true when the split tab bar is driving the on-screen list (mirrors store's splitViewActive) */
function splitViewActive(s: ReturnType<typeof useMailStore.getState>): boolean {
  return s.splitInbox && s.activeLabelId === 'INBOX' && !s.searchQuery;
}

/**
 * List/thread navigation shortcuts. Single-key action shortcuts
 * (c, e, r, a, f, l, b, #, /, g-sequences, …) are registered through kbar —
 * this hook only owns the keys kbar can't express well.
 */
export function useKeyboard(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = useMailStore.getState();

      // ⌘⌥⇧L — hidden diagnostic HUD toggle (unadvertised, works even while
      // typing/modal-open since it's a read-only overlay, not a mutating action)
      if (e.metaKey && e.altKey && e.shiftKey && e.code === 'KeyL') {
        e.preventDefault();
        toggleHud();
        return;
      }

      // ⌘⇧I — split/unified toggle works even while typing
      if (e.metaKey && e.shiftKey && e.code === 'KeyI') {
        e.preventDefault();
        s.toggleSplit();
        useCoachStore.getState().recordEfficient('toggleSplit');
        return;
      }

      // ⌘1~⌘9 — jump to nth split tab (must sit above the `if (e.metaKey) return` guard below)
      if (e.metaKey && !e.shiftKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
        if (splitViewActive(s)) {
          const n = Number(e.code.slice(5));
          const { order } = computeSplits(s.threads, s.splitDefs);
          if (order[n - 1] !== undefined) {
            e.preventDefault();
            s.switchTab(order[n - 1]);
            useCoachStore.getState().recordEfficient('switchTab');
          }
        }
        return;
      }

      if (isTyping(e.target)) return;
      const coach = useCoachStore.getState();
      if (
        s.composeInit ||
        s.snoozePickerOpen ||
        s.labelPickerOpen ||
        s.splitSettingsOpen ||
        s.followupPickerOpen ||
        coach.cheatSheetOpen ||
        coach.statsOpen
      ) {
        if (e.key === 'Escape') {
          s.closeSnoozePicker();
          s.closeLabelPicker();
          if (coach.cheatSheetOpen) coach.closeCheatSheet();
          if (coach.statsOpen) coach.closeStats();
        }
        return;
      }
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey && splitViewActive(s)) {
        e.preventDefault();
        if (e.shiftKey) s.prevTab();
        else s.nextTab();
        useCoachStore.getState().recordEfficient('switchTab');
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'j':
          e.preventDefault();
          s.moveSelection(1);
          useCoachStore.getState().recordEfficient('nav');
          break;
        case 'k':
          e.preventDefault();
          s.moveSelection(-1);
          useCoachStore.getState().recordEfficient('nav');
          break;
        case 'Enter':
          e.preventDefault();
          s.openSelected();
          useCoachStore.getState().recordEfficient('openThread');
          break;
        case ']':
          e.preventDefault();
          s.nextThread();
          break;
        case '[':
          e.preventDefault();
          s.prevThread();
          break;
        case 'Escape':
          if (s.activeThreadId) s.closeThread();
          else s.clearSearch();
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
