import { useEffect, useRef, useState } from 'react';
import { useMailStore } from '../store/mail';
import { selectVisibleThreads, INBOX_TAB } from '../lib/splits';
import { FOLLOWUP_PRESETS } from '../lib/followup';

export function FollowupPicker() {
  const open = useMailStore((s) => s.followupPickerOpen);
  const close = useMailStore((s) => s.closeFollowupPicker);
  const scheduleFollowup = useMailStore((s) => s.scheduleFollowup);
  const cancelFollowup = useMailStore((s) => s.cancelFollowup);
  const followups = useMailStore((s) => s.followups);
  // mirrors the store's private targetThreadId() — the thread this picker's actions apply to
  const targetId = useMailStore((s) => {
    if (s.activeThreadId) return s.activeThreadId;
    const useSplit = s.splitInbox && s.activeLabelId === 'INBOX' && !s.searchQuery;
    const visible = selectVisibleThreads(s.threads, s.splitDefs, useSplit ? s.activeSplitTab : INBOX_TAB);
    return visible[s.selectedIndex]?.id ?? null;
  });
  const [custom, setCustom] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const isPending = targetId != null && followups.get(targetId)?.status === 'pending';

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/50"
      onClick={close}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="zen-fade-in w-72 rounded-lg border border-bg-border bg-bg-subtle p-2 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // keep global single-key shortcuts (kbar) from firing behind the modal
          if (e.key === 'Escape') close();
          e.stopPropagation();
        }}
      >
        <div className="px-2 py-1.5 text-[11px] font-semibold tracking-wider text-text-muted uppercase">
          Remind me…
        </div>
        {isPending && (
          <button
            onClick={() => void cancelFollowup()}
            className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] text-red-400 hover:bg-bg-border"
          >
            Cancel reminder
          </button>
        )}
        {FOLLOWUP_PRESETS.map((p) => (
          <button
            key={p.days}
            onClick={() => void scheduleFollowup(p.days)}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] text-text-primary hover:bg-bg-border"
          >
            {p.label}
          </button>
        ))}
        <div className="mt-1 flex items-center gap-2 border-t border-bg-border px-2 pt-2 pb-1">
          <input
            type="number"
            min={1}
            placeholder="Custom days"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="flex-1 rounded border border-bg-border bg-bg px-2 py-1 text-[12px] text-text-primary"
          />
          <button
            disabled={!custom || Number(custom) <= 0}
            onClick={() => void scheduleFollowup(Number(custom))}
            className="rounded bg-accent px-2 py-1 text-[12px] text-white disabled:opacity-40"
          >
            Set
          </button>
        </div>
      </div>
    </div>
  );
}
