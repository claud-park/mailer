import { useEffect, useMemo, useRef, useState } from 'react';
import { useMailStore, activeAccount } from '../store/mail';
import type { ThreadDetail } from '../../shared/types';

/** Re:/Fwd: 접두를 (반복까지) 제거. */
function stripSubjectPrefix(subject: string): string {
  return subject.replace(/^((re|fwd):\s*)+/i, '').trim();
}

/** 스레드 참여자 이메일(from/to/cc) 중복 제거 + 본인 제외. */
function threadAttendees(detail: ThreadDetail | null, me: string | undefined): string[] {
  if (!detail) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of detail.messages) {
    for (const c of [m.from, ...m.to, ...m.cc]) {
      const email = c.email.toLowerCase();
      if (!email || email === me?.toLowerCase() || seen.has(email)) continue;
      seen.add(email);
      out.push(c.email);
    }
  }
  return out;
}

export function EventComposer() {
  const open = useMailStore((s) => s.eventComposerOpen);
  const close = useMailStore((s) => s.closeEventComposer);
  const create = useMailStore((s) => s.createCalendarEvent);
  const activeThread = useMailStore((s) => s.activeThread);
  const me = useMailStore((s) => activeAccount(s)?.email);
  const panelRef = useRef<HTMLDivElement>(null);

  const prefillSummary = useMemo(() => stripSubjectPrefix(activeThread?.subject ?? ''), [activeThread]);
  const prefillAttendees = useMemo(() => threadAttendees(activeThread, me).join(', '), [activeThread, me]);

  const [summary, setSummary] = useState(prefillSummary);
  const [attendees, setAttendees] = useState(prefillAttendees);
  const [start, setStart] = useState(''); // datetime-local, 사용자 입력 필수 (No AI)
  const [end, setEnd] = useState('');
  const [saving, setSaving] = useState(false);

  // 폼이 열릴 때마다 현재 스레드로 프리필 재설정
  useEffect(() => {
    if (open) {
      setSummary(prefillSummary);
      setAttendees(prefillAttendees);
      setStart('');
      setEnd('');
      panelRef.current?.focus();
    }
  }, [open, prefillSummary, prefillAttendees]);

  if (!open) return null;

  const canCreate = !!summary.trim() && !!start && !saving;

  const submit = async () => {
    if (!canCreate) return;
    const startISO = new Date(start).toISOString();
    const endISO = end ? new Date(end).toISOString() : new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
    setSaving(true);
    try {
      await create({
        summary: summary.trim(),
        startISO,
        endISO,
        attendees: attendees.split(',').map((s) => s.trim()).filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50" onClick={close}>
      <div
        ref={panelRef}
        tabIndex={-1}
        data-testid="event-composer"
        className="zen-fade-in w-96 rounded-lg border border-bg-border bg-bg-subtle p-3 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          e.stopPropagation();
        }}
      >
        <div className="px-1 py-1 text-[11px] font-semibold tracking-wider text-text-muted uppercase">
          이벤트 만들기
        </div>
        <label className="mt-1 block text-[11px] text-text-muted">제목</label>
        <input
          aria-label="Event summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="mb-2 w-full rounded border border-bg-border bg-bg px-2 py-1 text-[13px] text-text-primary"
        />
        <label className="block text-[11px] text-text-muted">참석자</label>
        <input
          aria-label="Event attendees"
          value={attendees}
          onChange={(e) => setAttendees(e.target.value)}
          className="mb-2 w-full rounded border border-bg-border bg-bg px-2 py-1 text-[13px] text-text-primary"
        />
        <label className="block text-[11px] text-text-muted">시작</label>
        <input
          aria-label="Event start"
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="mb-2 w-full rounded border border-bg-border bg-bg px-2 py-1 text-[13px] text-text-primary"
        />
        <label className="block text-[11px] text-text-muted">종료 (선택)</label>
        <input
          aria-label="Event end"
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="mb-3 w-full rounded border border-bg-border bg-bg px-2 py-1 text-[13px] text-text-primary"
        />
        <div className="flex justify-end gap-2">
          <button onClick={close} className="rounded px-3 py-1 text-[12px] text-text-secondary hover:text-text-primary">
            취소
          </button>
          <button
            aria-label="Create event"
            disabled={!canCreate}
            onClick={() => void submit()}
            className="rounded bg-accent px-3 py-1 text-[12px] font-medium text-white disabled:opacity-40"
          >
            만들기
          </button>
        </div>
      </div>
    </div>
  );
}
