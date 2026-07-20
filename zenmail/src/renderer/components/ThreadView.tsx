import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMailStore, activeAccount, quoteHtml, CALENDAR_REAUTH_MSG } from '../store/mail';
import type { AttachmentInfo, MessageDetail, InviteInfo, RsvpResponse } from '../../shared/types';
import { labelChipFallback } from '../lib/theme';
import { textToFragment } from '../lib/snippets';
import { SnippetPicker } from './SnippetPicker';

/** 본문에서 원격(https?:) img src만 추출 — main의 extractRemoteImageUrls(정규식)와 별도 구현,
 * renderer는 이미 DOMParser로 doc을 갖고 있으므로 DOM 기반이 더 정확하다. */
function extractRemoteImageUrls(doc: Document): string[] {
  const seen = new Set<string>();
  doc.querySelectorAll('img[src^="http:" i], img[src^="https:" i]').forEach((img) => {
    const src = img.getAttribute('src');
    if (src) seen.add(src);
  });
  return [...seen];
}

/** Sanitize + prepare message HTML for the sandboxed frame. */
function prepareHtml(
  message: MessageDetail,
  opts: { showQuoted: boolean; theme: 'light' | 'dark' },
  inlineImages: Map<string, string>,
  remoteImages: Map<string, string>
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

  // 인라인 cid: 이미지 치환(D7) — remote-image 게이트와 무관하게 항상 로드. 아직 도착 전이면
  // 빈 상태(alt) 유지. CSP img-src는 data:를 항상 허용하므로 별도 CSP 변경 불요.
  doc.querySelectorAll('img[src^="cid:"]').forEach((img) => {
    const cid = (img.getAttribute('src') ?? '').slice(4).replace(/^<|>$/g, '');
    const dataUri = inlineImages.get(cid);
    if (dataUri) img.setAttribute('src', dataUri);
  });

  // remote-image-prefetch: https(s): 이미지는 캐시에 있으면 data URI로 치환. 캐시에 없으면 원본
  // src를 그대로 두되, CSP img-src가 data:만 허용하므로 실제로는 그냥 안 보인다(네트워크 시도 없음).
  doc.querySelectorAll('img[src^="http:" i], img[src^="https:" i]').forEach((img) => {
    const src = img.getAttribute('src') ?? '';
    const dataUri = remoteImages.get(src);
    if (dataUri) img.setAttribute('src', dataUri);
  });

  const quoted = doc.querySelectorAll('.gmail_quote, blockquote');
  const hasQuoted = quoted.length > 0;
  if (!opts.showQuoted) quoted.forEach((el) => el.remove());

  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:;`;
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

const ATT_ICON_RULES: { test: (m: string) => boolean; icon: string }[] = [
  { test: (m) => m.startsWith('image/'), icon: '🖼' },
  { test: (m) => m === 'application/pdf', icon: '📄' },
  { test: (m) => m.includes('zip') || m.includes('compressed') || m.includes('tar'), icon: '🗜' },
  { test: (m) => m.includes('word') || m.includes('document') || m.startsWith('text/'), icon: '📝' },
];
function attachmentIcon(mimeType: string): string {
  return ATT_ICON_RULES.find((r) => r.test(mimeType))?.icon ?? '📎';
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentItem({
  messageId,
  att,
}: {
  messageId: string;
  att: AttachmentInfo & { attachmentId: string };
}) {
  const fetchAttachmentImage = useMailStore((s) => s.fetchAttachmentImage);
  const download = useMailStore((s) => s.downloadAttachment);
  const openLightbox = useMailStore((s) => s.openLightbox);
  const isImage = att.mimeType.startsWith('image/');
  const [thumb, setThumb] = useState<string | null>(null);
  const [error, setError] = useState(false);

  // 이미지 mimetype 항목만 썸네일 fetch(D6). 항목 단위 에러 격리(FR17) — 실패해도 카드는 정상.
  const loadThumb = useCallback(() => {
    if (!isImage) return;
    setError(false);
    void fetchAttachmentImage(messageId, att.attachmentId, att.mimeType).then((res) => {
      if ('dataUri' in res) setThumb(res.dataUri);
      else setError(true);
    });
  }, [isImage, fetchAttachmentImage, messageId, att.attachmentId, att.mimeType]);

  useEffect(() => {
    loadThumb();
  }, [loadThumb]);

  return (
    <div
      data-testid="attachment-item"
      className="flex items-center gap-2 rounded-md border border-bg-border bg-bg-subtle px-2 py-1.5 text-[12px]"
    >
      {isImage && thumb && (
        <button aria-label={`Preview ${att.filename}`} onClick={() => openLightbox({ dataUri: thumb, filename: att.filename })}>
          <img data-testid="attachment-thumb" src={thumb} alt={att.filename} className="h-8 w-8 rounded object-cover" />
        </button>
      )}
      {isImage && !thumb && !error && (
        <span className="flex h-8 w-8 items-center justify-center text-text-muted">…</span>
      )}
      {(!isImage || error) && (
        <span className="flex h-8 w-8 items-center justify-center text-[16px]">
          {error ? '⚠️' : attachmentIcon(att.mimeType)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-text-primary">{att.filename}</div>
        {error ? (
          <button
            data-testid="attachment-error"
            onClick={loadThumb}
            className="text-[11px] text-red-500 hover:underline"
          >
            불러오기 실패 · 재시도
          </button>
        ) : (
          <div className="text-[11px] text-text-muted">{formatSize(att.size)}</div>
        )}
      </div>
      <button
        data-testid="attachment-download"
        aria-label={`Download ${att.filename}`}
        onClick={() => void download(messageId, att.attachmentId, att.filename)}
        className="shrink-0 rounded px-2 py-0.5 text-[13px] text-text-secondary hover:text-text-primary"
      >
        ↓
      </button>
    </div>
  );
}

function AttachmentStrip({ message }: { message: MessageDetail }) {
  // D4: 비인라인 첨부만 나열(인라인 cid 이미지는 본문에서 이미 렌더 → 스트립 제외).
  // attachmentId 없는 항목(작은 인라인 파트를 Gmail이 body.data로 바로 실어 보낸 경우)은
  // 항상 inline:true로만 만들어지므로 여기엔 나타나지 않는다 — 타입만 좁혀준다.
  const items = (message.attachments ?? []).filter(
    (a): a is AttachmentInfo & { attachmentId: string } => !a.inline && !!a.attachmentId
  );
  if (items.length === 0) return null;
  return (
    <div data-testid="attachment-strip" className="mt-2 flex flex-col gap-1">
      {items.map((a) => (
        <AttachmentItem key={a.attachmentId} messageId={message.id} att={a} />
      ))}
    </div>
  );
}

function MessageCard({ message, isLast }: { message: MessageDetail; isLast: boolean }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [height, setHeight] = useState(120);
  const [inlineImages, setInlineImages] = useState<Map<string, string>>(new Map());
  const [remoteImages, setRemoteImages] = useState<Map<string, string>>(new Map());
  const frameRef = useRef<HTMLIFrameElement>(null);

  const theme = useMailStore((s) => s.theme);
  const fetchAttachmentImage = useMailStore((s) => s.fetchAttachmentImage);
  const autoLoadRemoteImages = useMailStore((s) => s.autoLoadRemoteImages);
  const fetchRemoteImage = useMailStore((s) => s.fetchRemoteImage);

  // 인라인 이미지 mimetype 첨부만 mount 시 병렬 fetch(D6). 도착하는 대로 contentId→dataUri 갱신 →
  // srcDoc 재계산(useMemo deps에 inlineImages). 실패는 조용히 스킵(cid는 alt로 남음).
  useEffect(() => {
    const inline = (message.attachments ?? []).filter(
      (a) => a.inline && a.contentId && a.mimeType.startsWith('image/')
    );
    if (inline.length === 0) return;

    // Gmail이 attachmentId 없이 body.data를 직접 실어 보낸 작은 인라인 파트(예: GitHub
    // Actions 알림 메일의 octicon)는 파싱 시점에 이미 data URI가 채워져 있다 — IPC 라운드
    // 트립 없이 바로 반영한다.
    const embedded = inline.filter((a) => a.inlineData);
    if (embedded.length > 0) {
      setInlineImages((prev) => {
        const next = new Map(prev);
        embedded.forEach((a) => next.set(a.contentId!, a.inlineData!));
        return next;
      });
    }

    const fetchable = inline.filter((a) => !a.inlineData && a.attachmentId);
    if (fetchable.length === 0) return;
    let cancelled = false;
    void Promise.all(
      fetchable.map(async (a) => {
        const res = await fetchAttachmentImage(message.id, a.attachmentId!, a.mimeType);
        if (!cancelled && 'dataUri' in res && a.contentId) {
          setInlineImages((prev) => new Map(prev).set(a.contentId!, res.dataUri));
        }
      })
    );
    return () => {
      cancelled = true;
    };
  // message.attachments는 deps에서 의도적으로 제외 — SWR revalidate로 참조가 매번 바뀌어도 message.id가 같으면 첨부 내용은 불변
  }, [message.id, fetchAttachmentImage]);

  // remote-image-prefetch: autoLoadRemoteImages가 true면 mount 시 본문의 원격 이미지를 병렬 요청
  // (거의 항상 캐시 hit — snooze.ts 데몬이 이미 프리페치해둠). false면 아무것도 하지 않고
  // 아래 "Load remote images" 버튼이 사용자가 눌렀을 때만 동일 로직을 1회 수행한다.
  const loadRemoteImages = useCallback(() => {
    const raw = message.bodyHtml || '';
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const urls = extractRemoteImageUrls(doc);
    if (urls.length === 0) return;
    let cancelled = false;
    void Promise.all(
      urls.map(async (url) => {
        const res = await fetchRemoteImage(url);
        if (!cancelled && 'dataUri' in res) {
          setRemoteImages((prev) => new Map(prev).set(url, res.dataUri));
        }
      })
    );
    return () => {
      cancelled = true;
    };
  }, [message.bodyHtml, fetchRemoteImage]);

  useEffect(() => {
    if (!autoLoadRemoteImages) return;
    return loadRemoteImages();
  }, [message.id, autoLoadRemoteImages, loadRemoteImages]);

  const { srcDoc, hasQuoted } = useMemo(
    () => prepareHtml(message, { showQuoted, theme }, inlineImages, remoteImages),
    [message, showQuoted, theme, inlineImages, remoteImages]
  );

  const hasRemoteImages = useMemo(() => {
    const doc = new DOMParser().parseFromString(message.bodyHtml || '', 'text/html');
    return extractRemoteImageUrls(doc).length > 0;
  }, [message.bodyHtml]);

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

      {hasRemoteImages && !autoLoadRemoteImages && remoteImages.size === 0 && (
        <button
          onClick={loadRemoteImages}
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

      <AttachmentStrip message={message} />

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
  const snippets = useMailStore((s) => s.snippets);
  const [body, setBody] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState(false);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const savedRangeRef = useRef<Range | null>(null);

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

  // Compose와 동일 패턴 포팅: 저장된 캐럿 복원 → execCommand 우선(1-스텝 undo) → 실패 시 Range 폴백
  const insertSnippet = (snippetBody: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel) return;
    let range = savedRangeRef.current;
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, snippetBody);
    } catch {
      inserted = false;
    }
    if (!inserted) {
      range.deleteContents();
      const frag = textToFragment(snippetBody);
      const last2 = frag.lastChild;
      range.insertNode(frag);
      if (last2) {
        range.setStartAfter(last2);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    savedRangeRef.current = null;
    setSnippetOpen(false);
  };

  return (
    <div className="border-t border-bg-border px-6 py-3">
      <div
        ref={editorRef}
        contentEditable
        data-placeholder={`Reply to ${last.from.name || replyTo}…`}
        onInput={(e) => setBody((e.target as HTMLDivElement).innerHTML)}
        onKeyDown={(e) => {
          if (e.metaKey && e.key === ';') {
            e.preventDefault();
            const sel = window.getSelection();
            savedRangeRef.current =
              sel && sel.rangeCount && editorRef.current?.contains(sel.anchorNode)
                ? sel.getRangeAt(0).cloneRange()
                : null;
            setSnippetOpen(true);
            return;
          }
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
      {snippetOpen && (
        <SnippetPicker
          snippets={snippets}
          onInsert={insertSnippet}
          onClose={() => {
            savedRangeRef.current = null;
            setSnippetOpen(false);
          }}
        />
      )}
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
