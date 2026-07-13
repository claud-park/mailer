import { useEffect, useRef } from 'react';
import { useMailStore } from '../store/mail';
import type { CalendarEvent } from '../../shared/types';

function eventTime(e: CalendarEvent): string {
  if (e.allDay) return '종일';
  return new Date(e.startISO).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(e: CalendarEvent): string {
  const d = new Date(e.startISO);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  return isToday ? '오늘' : '내일';
}

export function AgendaPanel() {
  const open = useMailStore((s) => s.agendaOpen);
  const close = useMailStore((s) => s.closeAgenda);
  const events = useMailStore((s) => s.agendaEvents);
  const loading = useMailStore((s) => s.agendaLoading);
  const error = useMailStore((s) => s.agendaError);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50" onClick={close}>
      <div
        ref={panelRef}
        tabIndex={-1}
        data-testid="agenda-panel"
        className="zen-fade-in max-h-[70vh] w-80 overflow-y-auto rounded-lg border border-bg-border bg-bg-subtle p-2 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          e.stopPropagation();
        }}
      >
        <div className="px-2 py-1.5 text-[11px] font-semibold tracking-wider text-text-muted uppercase">
          오늘 · 내일 일정
        </div>
        {loading && <div className="px-2 py-3 text-[13px] text-text-muted">일정 불러오는 중…</div>}
        {error && <div data-testid="agenda-error" className="px-2 py-3 text-[13px] text-red-500">{error}</div>}
        {!loading && !error && events.length === 0 && (
          <div className="px-2 py-3 text-[13px] text-text-muted">예정된 일정이 없어요</div>
        )}
        {!loading && !error &&
          events.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[13px]">
              <span className="min-w-0 truncate text-text-primary">{e.summary}</span>
              <span className="shrink-0 text-[11px] text-text-muted">
                {dayLabel(e)} {eventTime(e)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
