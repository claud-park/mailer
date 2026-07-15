import { useMemo, useRef, useState } from 'react';
import { useMailStore, activeAccount, quoteHtml, CALENDAR_REAUTH_MSG } from '../store/mail';
import type { MessageDetail, InviteInfo, RsvpResponse } from '../../shared/types';
import { labelChipFallback } from '../lib/theme';

const REMOTE_IMG_RE = /<img[^>]+src=["']?https?:/i;

/** Sanitize + prepare message HTML for the sandboxed frame. */
function prepareHtml(
  message: MessageDetail,
  opts: { showQuoted: boolean; allowImages: boolean; theme: 'light' | 'dark' }
): { srcDoc: string; hasQuoted: boolean } {
  const raw = message.bodyHtml || `<pre style="white-space:pre-wrap">${message.bodyText}</pre>`;
  const doc = new DOMParser().parseFromString(raw, 'text/html');

  // defense in depth — the iframe sandbox already blocks script execution
  doc.querySelectorAll('script, iframe, object, embed, form').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    }
  });

  const quoted = doc.querySelectorAll('.gmail_quote, blockquote');
  const hasQuoted = quoted.length > 0;
  if (!opts.showQuoted) quoted.forEach((el) => el.remove());

  const imgSrc = opts.allowImages ? "data: https: http:" : 'data:';
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; font-src data:;`;
  const srcDoc = `<!doctype html><html><head>
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <base target="_blank">
    <style>
      body { margin: 0; padding: 4px 0; background: transparent; color: ${
        opts.theme === 'dark' ? '#ececec' : '#18181b'
      };
             font: 13px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
             word-wrap: break-word; }
      a { color: #6366f1; }
      img { max-width: 100%; height: auto; }
      pre { white-space: pre-wrap; }
    </style>
  </head><body>${doc.body.innerHTML}</body></html>`;
  return { srcDoc, hasQuoted };
}

function MessageCard({ message, isLast }: { message: MessageDetail; isLast: boolean }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [allowImages, setAllowImages] = useState(false);
  const [height, setHeight] = useState(120);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const theme = useMailStore((s) => s.theme);

  const { srcDoc, hasQuoted } = useMemo(
    () => prepareHtml(message, { showQuoted, allowImages, theme }),
    [message, showQuoted, allowImages, theme]
  );

  const hasRemoteImages = useMemo(
    () => REMOTE_IMG_RE.test(message.bodyHtml),
    [message.bodyHtml]
  );

  return (
    <article className="border-b border-bg-border/60 px-6 py-4">
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[13px] font-medium text-text-primary">{message.from.name}</span>
          <span className="ml-2 text-[12px] text-text-muted">{message.from.email}</span>
          <div className="truncate text-[11px] text-text-muted">
            to {message.to.map((c) => c.name || c.email).join(', ')}
            {message.cc.length > 0 && ` · cc ${message.cc.map((c) => c.name || c.email).join(', ')}`}
          </div>
        </div>
        <time className="shrink-0 text-[11px] text-text-muted">
          {new Date(message.date).toLocaleString()}
        </time>
      </header>

      {hasRemoteImages && !allowImages && (
        <button
          onClick={() => setAllowImages(true)}
          className="mb-2 rounded border border-bg-border px-2 py-0.5 text-[11px] text-text-secondary hover:text-text-primary"
        >
          Load remote images
        </button>
      )}

      <iframe
        ref={frameRef}
        title={`message-${message.id}`}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
        style={{ height }}
        className="w-full border-0 bg-transparent"
        onLoad={() => {
          const body = frameRef.current?.contentDocument?.body;
          if (body) setHeight(Math.min(Math.max(body.scrollHeight + 8, 40), isLast ? 100000 : 600));
        }}
      />

      {hasQuoted && (
        <button
          onClick={() => setShowQuoted((v) => !v)}
          title={showQuoted ? 'Hide quoted text' : 'Show quoted text'}
          className="mt-1 rounded bg-bg-border px-2 py-0 text-[13px] leading-4 text-text-secondary hover:text-text-primary"
        >
          …
        </button>
      )}
    </article>
  );
}

function InlineReply() {
  const activeThread = useMailStore((s) => s.activeThread);
  const accountEmail = useMailStore((s) => activeAccount(s)?.email);
  const send = useMailStore((s) => s.send);
  const [body, setBody] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState(false);

  if (!activeThread || activeThread.messages.length === 0) return null;
  const last = activeThread.messages[activeThread.messages.length - 1];
  const replyTo = last.from.email === accountEmail ? last.to[0]?.email : last.from.email;

  const doSend = async (archive: boolean) => {
    if (!body.trim() || !replyTo || sending) return;
    setSending(true);
    try {
      await send({
        to: [replyTo],
        subject: activeThread.subject.startsWith('Re:')
          ? activeThread.subject
          : `Re: ${activeThread.subject}`,
        body: body + quoteHtml(activeThread),
        threadId: activeThread.id,
        inReplyTo: last.id,
        archive,
      });
      setBody('');
      if (editorRef.current) editorRef.current.innerHTML = '';
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-bg-border px-6 py-3">
      <div
        ref={editorRef}
        contentEditable
        data-placeholder={`Reply to ${last.from.name || replyTo}…`}
        onInput={(e) => setBody((e.target as HTMLDivElement).innerHTML)}
        onKeyDown={(e) => {
          if (e.metaKey && e.key === 'Enter') {
            e.preventDefault();
            void doSend(e.shiftKey);
          }
        }}
        className="min-h-16 rounded-md border border-bg-border bg-bg-subtle px-3 py-2 text-[13px] focus:border-accent focus:outline-none"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => void doSend(false)}
          disabled={!body.trim() || sending}
          className="rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-40"
        >
          Send&ensp;⌘↩
        </button>
        <span className="text-[11px] text-text-muted">⌘⇧↩ send & archive</span>
      </div>
    </div>
  );
}

function FollowupBanner({ threadId }: { threadId: string }) {
  const followup = useMailStore((s) => s.followups.get(threadId));
  const cancelFollowup = useMailStore((s) => s.cancelFollowup);
  const dismissFollowup = useMailStore((s) => s.dismissFollowup);

  if (!followup) return null;
  const dateStr = new Date(followup.dueAt).toLocaleDateString([], { month: 'short', day: 'numeric' });

  if (followup.status === 'pending') {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-bg-border/60 bg-bg-subtle px-6 py-1.5 text-[12px] text-text-secondary">
        <span>Reminder set — no reply by {dateStr}</span>
        <button
          onClick={() => void cancelFollowup(threadId)}
          aria-label="Cancel reminder"
          className="text-text-muted hover:text-text-primary"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 border-b border-bg-border/60 bg-accent/10 px-6 py-1.5 text-[12px] text-accent">
      <span>No reply since {dateStr}</span>
      <button
        onClick={() => void dismissFollowup(threadId)}
        className="rounded px-1.5 py-0.5 text-[11px] font-medium hover:bg-accent/20"
      >
        Dismiss
      </button>
    </div>
  );
}

const RSVP_LABEL: Record<RsvpResponse, string> = {
  accepted: '수락됨',
  tentative: '미정',
  declined: '거절됨',
};

function InviteBanner({ invite }: { invite: InviteInfo }) {
  const status = useMailStore((s) => s.rsvpStatus.get(invite.iCalUID));
  const calendarReady = useMailStore((s) => activeAccount(s)?.calendarReady ?? false);
  const respondToInvite = useMailStore((s) => s.respondToInvite);
  const showToast = useMailStore((s) => s.showToast);

  const when = new Date(invite.startISO).toLocaleString([], {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  const onRespond = (r: RsvpResponse) => {
    if (!calendarReady) { showToast(CALENDAR_REAUTH_MSG); return; }
    void respondToInvite(invite.iCalUID, r);
  };

  const btns: { r: RsvpResponse; label: string }[] = [
    { r: 'accepted', label: '수락' },
    { r: 'tentative', label: '미정' },
    { r: 'declined', label: '거절' },
  ];

  return (
    <div
      data-testid="invite-banner"
      className="flex items-center justify-between gap-3 border-b border-bg-border/60 bg-accent/10 px-6 py-2 text-[12px]"
    >
      <div className="min-w-0">
        <span className="font-medium text-text-primary">{invite.summary}</span>
        <span className="ml-2 text-text-muted">{when}</span>
        {invite.organizer && <span className="ml-2 text-text-muted">· {invite.organizer}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {status && <span className="mr-1 text-[11px] text-accent" data-testid="rsvp-status">응답: {RSVP_LABEL[status]}</span>}
        {btns.map((b) => (
          <button
            key={b.r}
            aria-label={b.label}
            onClick={() => onRespond(b.r)}
            className={`rounded px-2 py-0.5 text-[11px] font-medium ${
              status === b.r ? 'bg-accent text-white' : 'bg-bg-border text-text-secondary hover:text-text-primary'
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 스레드 내 invite가 여러 건이면 가장 최신 메시지의 invite 1건만 (동일 이벤트 업데이트 재전송). */
function latestInvite(messages: MessageDetail[]): InviteInfo | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].invite) return messages[i].invite;
  }
  return undefined;
}

export function ThreadView() {
  const activeThreadId = useMailStore((s) => s.activeThreadId);
  const activeThread = useMailStore((s) => s.activeThread);
  const threadLoading = useMailStore((s) => s.threadLoading);
  const labels = useMailStore((s) => s.labels);
  const theme = useMailStore((s) => s.theme);
  const toggleStar = useMailStore((s) => s.toggleStar);

  if (threadLoading && !activeThread) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-text-muted">
        Loading thread…
      </div>
    );
  }
  if (!activeThread) return null;

  const labelsById = new Map(labels.map((l) => [l.id, l]));
  const chips = activeThread.labelIds
    .map((id) => labelsById.get(id))
    .filter((l) => l && l.type === 'user' && l.visible);
  const starred = activeThread.labelIds.includes('STARRED');

  return (
    <div className="zen-fade-in flex min-h-0 min-w-0 flex-1 flex-col">
      {activeThreadId && <FollowupBanner threadId={activeThreadId} />}
      {(() => {
        const invite = latestInvite(activeThread.messages);
        return invite ? <InviteBanner invite={invite} /> : null;
      })()}
      <div className="flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 px-6 pt-4 pb-1">
          <h2 className="text-[15px] font-semibold text-text-primary">{activeThread.subject}</h2>
          <button
            onClick={() => void toggleStar(activeThread.id)}
            aria-label={starred ? 'Unstar thread' : 'Star thread'}
            className={`shrink-0 text-[15px] leading-none ${
              starred ? 'text-label-yellow' : 'text-text-muted hover:text-label-yellow'
            }`}
          >
            {starred ? '★' : '☆'}
          </button>
          {chips.map(
            (l) =>
              l && (
                <span
                  key={l.id}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    background: `${l.color?.backgroundColor ?? labelChipFallback(theme)}33`,
                    color: l.color?.backgroundColor ?? 'var(--color-text-secondary)',
                  }}
                >
                  {l.name}
                </span>
              )
          )}
        </div>
        {activeThread.messages.map((m, i) => (
          <MessageCard key={m.id} message={m} isLast={i === activeThread.messages.length - 1} />
        ))}
      </div>
      <InlineReply />
    </div>
  );
}
