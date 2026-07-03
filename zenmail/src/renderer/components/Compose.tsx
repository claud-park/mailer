import { useEffect, useRef, useState } from 'react';
import { useMailStore } from '../store/mail';
import type { Contact } from '../../shared/types';
import {
  FOLLOWUP_PRESETS,
  FOLLOWUP_DEFAULT_DAYS,
  FOLLOWUP_DEFAULT_DAYS_KEY,
  formatRemindDays,
} from '../lib/followup';

function RecipientField({
  label,
  values,
  onChange,
  autoFocus,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const q = draft.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const mySeq = ++seq.current;
    void window.zenmail.listContacts(q).then((contacts) => {
      if (seq.current !== mySeq) return;
      setSuggestions(contacts.filter((c) => !values.includes(c.email)));
      setHighlighted(0);
    });
  }, [draft, values]);

  const commit = (email: string) => {
    const v = email.trim().replace(/,$/, '');
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
    setSuggestions([]);
  };

  return (
    <div className="relative flex items-center gap-2 border-b border-bg-border py-1.5">
      <span className="w-12 shrink-0 text-[12px] text-text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {values.map((v) => (
          <span
            key={v}
            className="flex items-center gap-1 rounded-full bg-bg-border px-2 py-0.5 text-[12px]"
          >
            {v}
            <button
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="text-text-muted hover:text-text-primary"
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          autoFocus={autoFocus}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlighted((h) => Math.max(h - 1, 0));
            } else if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
              if (draft.trim() || suggestions.length) {
                e.preventDefault();
                commit(suggestions[highlighted]?.email ?? draft);
              }
            } else if (e.key === 'Backspace' && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
          className="min-w-32 flex-1 bg-transparent py-0.5 text-[13px] outline-none"
        />
      </div>
      {suggestions.length > 0 && (
        <ul className="absolute top-full left-14 z-10 mt-1 w-80 overflow-hidden rounded-md border border-bg-border bg-bg-subtle shadow-xl">
          {suggestions.map((c, i) => (
            <li key={c.email}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(c.email);
                }}
                className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left ${
                  i === highlighted ? 'bg-bg-border' : ''
                }`}
              >
                <span className="text-[13px] text-text-primary">{c.name}</span>
                <span className="truncate text-[11px] text-text-muted">{c.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Compose() {
  const composeInit = useMailStore((s) => s.composeInit);
  const closeCompose = useMailStore((s) => s.closeCompose);
  const send = useMailStore((s) => s.send);
  const showToast = useMailStore((s) => s.showToast);

  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [remindOpen, setRemindOpen] = useState(false);
  const [remindDays, setRemindDays] = useState<number | null>(null);
  const [remindCustomDays, setRemindCustomDays] = useState(FOLLOWUP_DEFAULT_DAYS);
  const [sending, setSending] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!composeInit) return;
    setTo(composeInit.to);
    setCc(composeInit.cc);
    setBcc([]);
    setShowCcBcc(composeInit.cc.length > 0);
    setSubject(composeInit.subject);
    setScheduleOpen(false);
    setScheduleAt('');
    setRemindOpen(false);
    setRemindDays(null);
    if (editorRef.current) editorRef.current.innerHTML = '';
  }, [composeInit]);

  useEffect(() => {
    void window.zenmail.getSetting(FOLLOWUP_DEFAULT_DAYS_KEY).then((v) => {
      const n = v ? Number(v) : NaN;
      setRemindCustomDays(Number.isFinite(n) && n > 0 ? n : FOLLOWUP_DEFAULT_DAYS);
    });
  }, []);

  if (!composeInit) return null;

  const doSend = async (opts: { archive?: boolean; schedule?: boolean } = {}) => {
    const body =
      (editorRef.current?.innerHTML ?? '') +
      (composeInit.quotedHtml ? composeInit.quotedHtml : '');
    if (!to.length) {
      showToast('Add at least one recipient');
      return;
    }
    if (sending) return;
    setSending(true);
    try {
      await send({
        to,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        subject,
        body,
        threadId: composeInit.threadId,
        inReplyTo: composeInit.inReplyTo,
        archive: opts.archive,
        sendAt: opts.schedule && scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
        remindDays: remindDays ?? undefined,
      });
      if (remindDays != null) {
        void window.zenmail.setSetting(FOLLOWUP_DEFAULT_DAYS_KEY, String(remindDays));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="zen-fade-in absolute inset-0 z-30 flex flex-col bg-bg"
      onKeyDown={(e) => e.stopPropagation()} // shield global shortcuts while composing
    >
      <header className="app-drag flex h-12 shrink-0 items-center justify-between border-b border-bg-border px-4">
        <span className="pl-16 text-[13px] font-medium text-text-secondary">
          {composeInit.mode === 'new' ? 'New message' : subject || 'New message'}
        </span>
        <button
          onClick={closeCompose}
          title="Close (Esc)"
          aria-label="Close compose"
          className="app-no-drag rounded px-2 py-1 text-text-secondary hover:bg-bg-subtle hover:text-text-primary"
        >
          ✕
        </button>
      </header>

      <div
        className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-y-auto px-6 py-4"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            closeCompose();
          }
          if (e.metaKey && e.key === 'Enter') {
            e.preventDefault();
            void doSend({ archive: e.shiftKey });
          }
        }}
      >
        <RecipientField label="To" values={to} onChange={setTo} autoFocus={to.length === 0} />
        {showCcBcc ? (
          <>
            <RecipientField label="Cc" values={cc} onChange={setCc} />
            <RecipientField label="Bcc" values={bcc} onChange={setBcc} />
          </>
        ) : (
          <button
            onClick={() => setShowCcBcc(true)}
            className="self-start py-1 text-[11px] text-text-muted hover:text-text-primary"
          >
            + Cc/Bcc
          </button>
        )}
        <div className="flex items-center gap-2 border-b border-bg-border py-1.5">
          <span className="w-12 shrink-0 text-[12px] text-text-muted">Subject</span>
          <input
            autoFocus={to.length > 0}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="flex-1 bg-transparent py-0.5 text-[13px] font-medium outline-none"
          />
        </div>

        <div
          ref={editorRef}
          contentEditable
          data-placeholder="Write something zen…"
          className="mt-3 min-h-48 flex-1 text-[13px] leading-relaxed outline-none"
        />
        {composeInit.quotedHtml && (
          <div className="mt-2 border-t border-bg-border pt-2 text-[11px] text-text-muted">
            Quoted text will be included below your message.
          </div>
        )}
      </div>

      <footer className="mx-auto flex w-full max-w-3xl items-center gap-3 px-6 pb-5">
        <button
          onClick={() => void doSend()}
          disabled={sending}
          className="rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-40"
        >
          Send&ensp;⌘↩
        </button>
        {composeInit.threadId && (
          <button
            onClick={() => void doSend({ archive: true })}
            disabled={sending}
            className="rounded-md border border-bg-border px-3 py-1.5 text-[13px] text-text-secondary hover:text-text-primary disabled:opacity-40"
          >
            Send & archive&ensp;⌘⇧↩
          </button>
        )}
        <div className="relative">
          <button
            onClick={() => setScheduleOpen((v) => !v)}
            className="rounded-md border border-bg-border px-3 py-1.5 text-[13px] text-text-secondary hover:text-text-primary"
          >
            Schedule…
          </button>
          {scheduleOpen && (
            <div className="absolute bottom-full left-0 mb-2 flex items-center gap-2 rounded-md border border-bg-border bg-bg-subtle p-3 shadow-xl">
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="rounded border border-bg-border bg-bg px-2 py-1 text-[12px] text-text-primary"
              />
              <button
                onClick={() => void doSend({ schedule: true })}
                disabled={!scheduleAt || sending}
                className="rounded bg-accent px-2 py-1 text-[12px] text-white disabled:opacity-40"
              >
                Schedule
              </button>
            </div>
          )}
        </div>
        <div className="relative">
          <button
            onClick={() => setRemindOpen((v) => !v)}
            aria-label="Remind me if no reply"
            className="rounded-md border border-bg-border px-3 py-1.5 text-[13px] text-text-secondary hover:text-text-primary"
          >
            Remind…
          </button>
          {remindOpen && (
            <div className="absolute bottom-full left-0 mb-2 flex items-center gap-2 rounded-md border border-bg-border bg-bg-subtle p-3 shadow-xl">
              {FOLLOWUP_PRESETS.map((p) => (
                <button
                  key={p.days}
                  onClick={() => {
                    setRemindDays(p.days);
                    setRemindOpen(false);
                  }}
                  className="rounded border border-bg-border px-2 py-1 text-[12px] text-text-secondary hover:text-text-primary"
                >
                  {p.label}
                </button>
              ))}
              <input
                type="number"
                min={1}
                value={remindCustomDays}
                onChange={(e) => setRemindCustomDays(Number(e.target.value))}
                aria-label="Custom remind days"
                className="w-14 rounded border border-bg-border bg-bg px-2 py-1 text-[12px] text-text-primary"
              />
              <button
                onClick={() => {
                  setRemindDays(remindCustomDays);
                  setRemindOpen(false);
                }}
                disabled={!remindCustomDays || remindCustomDays < 1}
                className="rounded bg-accent px-2 py-1 text-[12px] text-white disabled:opacity-40"
              >
                Set
              </button>
            </div>
          )}
        </div>
        {remindDays != null && (
          <span className="flex items-center gap-1 rounded-full bg-bg-border px-2 py-0.5 text-[12px] text-text-secondary">
            Remind in {formatRemindDays(remindDays)}
            <button
              onClick={() => setRemindDays(null)}
              aria-label="Remove reminder"
              className="text-text-muted hover:text-text-primary"
            >
              ×
            </button>
          </span>
        )}
        <span className="ml-auto text-[11px] text-text-muted">10s undo window after send</span>
      </footer>
    </div>
  );
}
