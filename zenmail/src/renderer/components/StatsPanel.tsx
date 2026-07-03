import { useRef, useEffect } from 'react';
import { useCoachStore } from '../store/coach';
import { keyboardRatio, MILESTONES } from '../lib/coach';

const STAT_ROWS: { key: string; label: string }[] = [
  { key: 'archive', label: 'Archived' },
  { key: 'send', label: 'Sent' },
  { key: 'snooze', label: 'Snoozed' },
  { key: 'followup', label: 'Reminded' },
];

export function StatsPanel() {
  const open = useCoachStore((s) => s.statsOpen);
  const close = useCoachStore((s) => s.closeStats);
  const keyboardCount = useCoachStore((s) => s.keyboardCount);
  const mouseCount = useCoachStore((s) => s.mouseCount);
  const weekProcessed = useCoachStore((s) => s.weekProcessed);
  const counters = useCoachStore((s) => s.counters);
  const milestonesShown = useCoachStore((s) => s.milestonesShown);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const ratio = keyboardRatio(keyboardCount, mouseCount);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Your stats"
        className="zen-fade-in max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border border-bg-border bg-bg-subtle p-4 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          e.stopPropagation();
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[13px] font-semibold text-text-primary">Your stats</div>
          <button
            onClick={close}
            aria-label="Close stats"
            className="rounded px-2 py-1 text-text-secondary hover:bg-bg-border hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        <div className="mb-4 rounded-md border border-bg-border p-3 text-center">
          <div className="text-[10px] font-semibold tracking-wider text-text-muted uppercase">
            Keyboard ratio
          </div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-text-primary">
            {ratio === null ? '—' : `${Math.round(ratio * 100)}%`}
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1 px-1 text-[10px] font-semibold tracking-wider text-text-muted uppercase">
            This week
          </div>
          <div className="flex items-center justify-between rounded-md px-1 py-1 text-[13px] text-text-secondary">
            <span>Processed</span>
            <span className="tabular-nums text-text-primary">{weekProcessed}</span>
          </div>
        </div>

        <div className="mb-4">
          <div className="mb-1 px-1 text-[10px] font-semibold tracking-wider text-text-muted uppercase">
            All time
          </div>
          {STAT_ROWS.map((row) => (
            <div
              key={row.key}
              className="flex items-center justify-between rounded-md px-1 py-1 text-[13px] text-text-secondary"
            >
              <span>{row.label}</span>
              <span className="tabular-nums text-text-primary">{counters[row.key] ?? 0}</span>
            </div>
          ))}
        </div>

        <div>
          <div className="mb-1 px-1 text-[10px] font-semibold tracking-wider text-text-muted uppercase">
            Milestones
          </div>
          {MILESTONES.map((m) => {
            const earned = milestonesShown.includes(m.id);
            return (
              <div
                key={m.id}
                className={`flex items-center gap-2 rounded-md px-1 py-1 text-[12px] ${
                  earned ? 'text-text-primary' : 'text-text-muted'
                }`}
              >
                <span>{earned ? '✓' : '○'}</span>
                <span className={earned ? '' : 'opacity-60'}>{m.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
