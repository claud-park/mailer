import { useEffect } from 'react';
import { useMailStore } from '../store/mail';

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
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

      // ⌘⇧I — split/unified toggle works even while typing
      if (e.metaKey && e.shiftKey && e.code === 'KeyI') {
        e.preventDefault();
        s.toggleSplit();
        return;
      }

      if (isTyping(e.target)) return;
      if (s.composeInit || s.snoozePickerOpen || s.labelPickerOpen) {
        if (e.key === 'Escape') {
          s.closeSnoozePicker();
          s.closeLabelPicker();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'j':
          e.preventDefault();
          s.moveSelection(1);
          break;
        case 'k':
          e.preventDefault();
          s.moveSelection(-1);
          break;
        case 'Enter':
          e.preventDefault();
          s.openSelected();
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
