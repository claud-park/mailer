import { useEffect, useRef, useState } from 'react';
import { useMailStore } from '../store/mail';

function laterToday(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 3, 0, 0, 0);
  return d;
}

function tomorrowMorning(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d;
}

function nextWeek(): Date {
  const d = new Date();
  const day = d.getDay();
  const daysUntilMonday = ((8 - day) % 7) || 7;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(8, 0, 0, 0);
  return d;
}

const PRESETS: { label: string; hint: (d: Date) => string; at: () => Date }[] = [
  {
    label: 'Later today',
    hint: (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    at: laterToday,
  },
  {
    label: 'Tomorrow morning',
    hint: (d) => d.toLocaleString([], { weekday: 'short', hour: 'numeric' }),
    at: tomorrowMorning,
  },
  {
    label: 'Next week',
    hint: (d) => d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric' }),
    at: nextWeek,
  },
];

export function SnoozePicker() {
  const open = useMailStore((s) => s.snoozePickerOpen);
  const close = useMailStore((s) => s.closeSnoozePicker);
  const snoozeThread = useMailStore((s) => s.snoozeThread);
  const [custom, setCustom] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

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
          Snooze until…
        </div>
        {PRESETS.map((p) => {
          const at = p.at();
          return (
            <button
              key={p.label}
              onClick={() => void snoozeThread(at)}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] text-text-primary hover:bg-bg-border"
            >
              {p.label}
              <span className="text-[11px] text-text-muted">{p.hint(at)}</span>
            </button>
          );
        })}
        <div className="mt-1 flex items-center gap-2 border-t border-bg-border px-2 pt-2 pb-1">
          <input
            type="datetime-local"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="flex-1 rounded border border-bg-border bg-bg px-2 py-1 text-[12px] text-text-primary"
          />
          <button
            disabled={!custom}
            onClick={() => void snoozeThread(new Date(custom))}
            className="rounded bg-accent px-2 py-1 text-[12px] text-white disabled:opacity-40"
          >
            Set
          </button>
        </div>
      </div>
    </div>
  );
}
