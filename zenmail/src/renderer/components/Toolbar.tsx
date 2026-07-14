import { useEffect, useRef, useState } from 'react';
import { useMailStore, activeAccount } from '../store/mail';
import { useCoachStore } from '../store/coach';

export function Toolbar() {
  const searchQuery = useMailStore((s) => s.searchQuery);
  const searchFocusTick = useMailStore((s) => s.searchFocusTick);
  const submitSearch = useMailStore((s) => s.submitSearch);
  const clearSearch = useMailStore((s) => s.clearSearch);
  const openCompose = useMailStore((s) => s.openCompose);
  const closeThread = useMailStore((s) => s.closeThread);
  const activeThreadId = useMailStore((s) => s.activeThreadId);
  const splitInbox = useMailStore((s) => s.splitInbox);
  const toggleSplit = useMailStore((s) => s.toggleSplit);
  const account = useMailStore(activeAccount);

  const [draft, setDraft] = useState(searchQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    if (searchFocusTick > 0) inputRef.current?.focus();
  }, [searchFocusTick]);

  return (
    <header className="app-drag flex h-12 shrink-0 items-center gap-2 border-b border-bg-border px-3">
      <button
        onClick={closeThread}
        disabled={!activeThreadId}
        title="Back to list (Esc)"
        className="app-no-drag rounded-md px-2 py-1 text-text-secondary hover:bg-bg-subtle hover:text-text-primary disabled:opacity-30"
      >
        ←
      </button>

      <div className="app-no-drag relative mx-auto w-full max-w-xl">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitSearch(draft);
            if (e.key === 'Escape') {
              setDraft('');
              clearSearch();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Search mail  ( / )"
          className="w-full rounded-md border border-bg-border bg-bg-subtle px-3 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
        {searchQuery && (
          <button
            onClick={() => {
              setDraft('');
              clearSearch();
            }}
            className="absolute top-1/2 right-2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            title="Clear search (Esc)"
          >
            ×
          </button>
        )}
      </div>

      <button
        onClick={() => {
          toggleSplit();
          useCoachStore.getState().recordMouse('toggleSplit');
          useCoachStore.getState().maybeHint('toggleSplit');
        }}
        title="Toggle split inbox (⌘⇧I)"
        className={`app-no-drag rounded-md px-2 py-1 text-[12px] ${
          splitInbox ? 'text-accent' : 'text-text-secondary'
        } hover:bg-bg-subtle`}
      >
        Split
      </button>
      <button
        onClick={() => {
          openCompose();
          useCoachStore.getState().recordMouse('compose');
          useCoachStore.getState().maybeHint('compose');
        }}
        title="Compose (c)"
        className="app-no-drag rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover"
      >
        Compose
      </button>
      {account?.demo && (
        <span className="app-no-drag rounded bg-label-yellow/20 px-1.5 py-0.5 text-[10px] font-medium text-label-yellow">
          DEMO
        </span>
      )}
    </header>
  );
}
