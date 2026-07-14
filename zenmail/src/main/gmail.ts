import { google, gmail_v1, Auth } from 'googleapis';
import {
  CATEGORY_LABELS,
  SNOOZE_LABEL_NAME,
  type Contact,
  type FetchThreadsRequest,
  type FetchThreadsResponse,
  type Label,
  type ModifyLabelsRequest,
  type SendRequest,
  type SendResult,
  type ThreadDetail,
  type ThreadSummary,
} from '../shared/types';
import { isInInboxView } from '../shared/view';
import { extractInvite } from './ics';

export interface GmailProvider {
  readonly email: string;
  readonly demo: boolean;
  listThreads(req: FetchThreadsRequest): Promise<FetchThreadsResponse>;
  getThread(threadId: string): Promise<ThreadDetail>;
  listLabels(): Promise<Label[]>;
  send(req: SendRequest): Promise<SendResult>;
  modifyThread(req: ModifyLabelsRequest): Promise<void>;
  /** id of the zenmail/snoozed label, creating it if needed */
  snoozeLabelId(): Promise<string>;
}

// ---------------------------------------------------------------------------
// Real Gmail provider
// ---------------------------------------------------------------------------

function parseAddress(raw: string): Contact {
  const m = raw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim() };
  const email = raw.trim();
  return { name: email, email };
}

function parseAddressList(raw: string | undefined): Contact[] {
  if (!raw) return [];
  // split on commas not inside quotes
  return raw
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseAddress);
}

function header(msg: gmail_v1.Schema$Message, name: string): string | undefined {
  return msg.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())
    ?.value ?? undefined;
}

function decodeBody(data: string | null | undefined): string {
  if (!data) return '';
  return Buffer.from(data, 'base64url').toString('utf8');
}

function extractBodies(part: gmail_v1.Schema$MessagePart | undefined): {
  html: string;
  text: string;
  ics: string;
} {
  let html = '';
  let text = '';
  let ics = '';
  const walk = (p: gmail_v1.Schema$MessagePart | undefined) => {
    if (!p) return;
    const mime = (p.mimeType ?? '').toLowerCase();
    if (mime === 'text/html' && p.body?.data) html ||= decodeBody(p.body.data);
    else if (mime === 'text/plain' && p.body?.data) text ||= decodeBody(p.body.data);
    else if ((mime === 'text/calendar' || mime === 'application/ics') && p.body?.data)
      ics ||= decodeBody(p.body.data);
    p.parts?.forEach(walk);
  };
  walk(part);
  return { html, text, ics };
}

function toBase64Url(s: string): string {
  return Buffer.from(s).toString('base64url');
}

export function buildMime(req: SendRequest, from: string): string {
  const boundary = `zenmail_${Math.random().toString(36).slice(2)}`;
  const headers = [
    `From: ${from}`,
    `To: ${req.to.join(', ')}`,
    req.cc?.length ? `Cc: ${req.cc.join(', ')}` : '',
    req.bcc?.length ? `Bcc: ${req.bcc.join(', ')}` : '',
    `Subject: =?UTF-8?B?${Buffer.from(req.subject).toString('base64')}?=`,
    req.inReplyTo ? `In-Reply-To: ${req.inReplyTo}` : '',
    req.inReplyTo ? `References: ${req.inReplyTo}` : '',
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);

  const textBody = req.body
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  return [
    headers.join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(textBody).toString('base64'),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(req.body).toString('base64'),
    `--${boundary}--`,
  ].join('\r\n');
}

export class RealGmailProvider implements GmailProvider {
  readonly demo = false;
  private gmail: gmail_v1.Gmail;
  private cachedSnoozeLabelId: string | null = null;

  constructor(
    auth: Auth.OAuth2Client,
    readonly email: string
  ) {
    this.gmail = google.gmail({ version: 'v1', auth });
  }

  async listThreads(req: FetchThreadsRequest): Promise<FetchThreadsResponse> {
    // inbox-zero-starred D2: 인박스 뷰 술어를 프로바이더 내부에서만 Gmail q로 번역한다. q를 IPC
    // 요청(req.q)에 싣지 않으므로 SWR warm-cache 자격(!req.q)이 보존된다 — 요청에 q가 실리면
    // 인박스 웜캐시 읽기 전체가 무력화된다. threads.list의 labelIds는 순수 AND라 (INBOX ∨ STARRED)를
    // 표현 못 해 q로 번역하고, pageToken은 그대로 통과시킨다.
    const isInboxView = req.labelIds?.length === 1 && req.labelIds[0] === 'INBOX' && !req.q;
    const res = await this.gmail.users.threads.list({
      userId: 'me',
      labelIds: isInboxView ? undefined : req.labelIds,
      q: isInboxView
        ? `(in:inbox OR is:starred) -in:trash -in:spam -label:${SNOOZE_LABEL_NAME}`
        : req.q,
      pageToken: req.pageToken,
      maxResults: 50,
    });
    const ids = (res.data.threads ?? []).map((t) => t.id!).filter(Boolean);

    // hydrate summaries with limited concurrency
    const threads: ThreadSummary[] = [];
    const CONCURRENCY = 8;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const chunk = await Promise.all(
        ids.slice(i, i + CONCURRENCY).map((id) => this.threadSummary(id))
      );
      threads.push(...chunk.filter((t): t is ThreadSummary => t !== null));
    }
    return { threads, nextPageToken: res.data.nextPageToken ?? undefined };
  }

  private async threadSummary(id: string): Promise<ThreadSummary | null> {
    try {
      const res = await this.gmail.users.threads.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date'],
      });
      const msgs = res.data.messages ?? [];
      if (!msgs.length) return null;
      const last = msgs[msgs.length - 1];
      const labelIds = [...new Set(msgs.flatMap((m) => m.labelIds ?? []))];
      return {
        id,
        subject: header(msgs[0], 'Subject') ?? '(no subject)',
        from: parseAddress(header(last, 'From') ?? ''),
        snippet: last.snippet ?? '',
        date: Number(last.internalDate ?? Date.now()),
        unread: labelIds.includes('UNREAD'),
        labelIds,
        messageCount: msgs.length,
      };
    } catch (err) {
      console.warn('[gmail] threadSummary failed', id, err);
      return null;
    }
  }

  async getThread(threadId: string): Promise<ThreadDetail> {
    const res = await this.gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    });
    const msgs = res.data.messages ?? [];
    return {
      id: threadId,
      subject: msgs.length ? header(msgs[0], 'Subject') ?? '(no subject)' : '',
      labelIds: [...new Set(msgs.flatMap((m) => m.labelIds ?? []))],
      messages: msgs.map((m) => {
        const bodies = extractBodies(m.payload);
        const invite = bodies.ics ? extractInvite(bodies.ics) : undefined;
        return {
          id: m.id!,
          threadId,
          from: parseAddress(header(m, 'From') ?? ''),
          to: parseAddressList(header(m, 'To')),
          cc: parseAddressList(header(m, 'Cc')),
          date: Number(m.internalDate ?? 0),
          snippet: m.snippet ?? '',
          bodyHtml: bodies.html,
          bodyText: bodies.text,
          labelIds: m.labelIds ?? [],
          ...(invite ? { invite } : {}),
        };
      }),
    };
  }

  async listLabels(): Promise<Label[]> {
    const res = await this.gmail.users.labels.list({ userId: 'me' });
    const raw = res.data.labels ?? [];
    // labels.list does not include counts — fetch each label (small N, parallel)
    const detailed = await Promise.all(
      raw.map(async (l) => {
        try {
          const d = await this.gmail.users.labels.get({ userId: 'me', id: l.id! });
          return d.data;
        } catch {
          return l;
        }
      })
    );
    return detailed.map((l) => ({
      id: l.id!,
      name: l.name ?? '',
      type: (l.type as 'system' | 'user') ?? 'user',
      color: l.color
        ? {
            textColor: l.color.textColor ?? '#8a8a8a',
            backgroundColor: l.color.backgroundColor ?? '#2a2a2a',
          }
        : undefined,
      unreadCount: l.threadsUnread ?? 0,
      visible: l.labelListVisibility !== 'labelHide',
    }));
  }

  async send(req: SendRequest): Promise<SendResult> {
    const res = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: toBase64Url(buildMime(req, this.email)),
        threadId: req.threadId,
      },
    });
    if (!res.data.threadId || !res.data.id) {
      throw new Error('Gmail send response missing threadId/id');
    }
    return { threadId: res.data.threadId, messageId: res.data.id };
  }

  async modifyThread(req: ModifyLabelsRequest): Promise<void> {
    await this.gmail.users.threads.modify({
      userId: 'me',
      id: req.threadId,
      requestBody: {
        addLabelIds: req.addLabelIds,
        removeLabelIds: req.removeLabelIds,
      },
    });
  }

  async snoozeLabelId(): Promise<string> {
    if (this.cachedSnoozeLabelId) return this.cachedSnoozeLabelId;
    const res = await this.gmail.users.labels.list({ userId: 'me' });
    const existing = res.data.labels?.find((l) => l.name === SNOOZE_LABEL_NAME);
    if (existing?.id) {
      this.cachedSnoozeLabelId = existing.id;
      return existing.id;
    }
    const created = await this.gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name: SNOOZE_LABEL_NAME,
        labelListVisibility: 'labelHide',
        messageListVisibility: 'hide',
      },
    });
    this.cachedSnoozeLabelId = created.data.id!;
    return this.cachedSnoozeLabelId;
  }
}

// ---------------------------------------------------------------------------
// Demo (mock) provider — lets the whole UI run without an OAuth client ID.
// ---------------------------------------------------------------------------

const DEMO_SNOOZE_LABEL_ID = 'Label_snoozed';

/** sender seeded as the VIP split's default in demo mode (see buildDemoData senders[0]) */
export const DEMO_VIP_EMAIL = 'ana@linearly.dev';

interface MockThread {
  summary: ThreadSummary;
  detail: ThreadDetail;
}

function demoBody(paragraphs: string[], quoted?: string): string {
  const quote = quoted
    ? `<blockquote class="gmail_quote" style="border-left:2px solid #ccc;padding-left:12px;color:#666">${quoted}</blockquote>`
    : '';
  return `<div>${paragraphs.map((p) => `<p>${p}</p>`).join('')}${quote}</div>`;
}

function buildDemoData(): { threads: MockThread[]; labels: Label[]; senders: Contact[] } {
  const labels: Label[] = [
    { id: 'INBOX', name: 'Inbox', type: 'system', unreadCount: 0, visible: true },
    { id: 'SENT', name: 'Sent', type: 'system', unreadCount: 0, visible: true },
    { id: 'DRAFT', name: 'Drafts', type: 'system', unreadCount: 0, visible: true },
    { id: 'TRASH', name: 'Trash', type: 'system', unreadCount: 0, visible: false },
    { id: 'UNREAD', name: 'Unread', type: 'system', unreadCount: 0, visible: false },
    ...CATEGORY_LABELS.map((id) => ({
      id,
      name: id.replace('CATEGORY_', '').toLowerCase(),
      type: 'system' as const,
      unreadCount: 0,
      visible: false,
    })),
    {
      id: 'Label_work',
      name: 'Work',
      type: 'user',
      color: { textColor: '#ffffff', backgroundColor: '#3b82f6' },
      unreadCount: 0,
      visible: true,
    },
    {
      id: 'Label_finance',
      name: 'Finance',
      type: 'user',
      color: { textColor: '#ffffff', backgroundColor: '#22c55e' },
      unreadCount: 0,
      visible: true,
    },
    {
      id: 'Label_travel',
      name: 'Travel',
      type: 'user',
      color: { textColor: '#ffffff', backgroundColor: '#a855f7' },
      unreadCount: 0,
      visible: true,
    },
    {
      id: DEMO_SNOOZE_LABEL_ID,
      name: SNOOZE_LABEL_NAME,
      type: 'user',
      unreadCount: 0,
      visible: false,
    },
  ];

  const now = Date.now();
  const h = 3600_000;
  const senders: Contact[] = [
    { name: 'Ana Torres', email: 'ana@linearly.dev' },
    { name: 'Ben Okafor', email: 'ben@northwind.io' },
    { name: 'Chris Park', email: 'chris.park@dreamus.io' },
    { name: 'Dana Kim', email: 'dana@figma-mail.com' },
    { name: 'GitHub', email: 'notifications@github.com' },
    { name: 'Stripe', email: 'receipts@stripe.com' },
    { name: 'Koreana Air', email: 'booking@koreana.example' },
    { name: 'Product Hunt Daily', email: 'hello@producthunt.example' },
    { name: 'LinkedIn', email: 'updates@linkedin.example' },
    { name: 'Weekly Dev Digest', email: 'digest@devnews.example' },
    // same domain as the demo account (demo@zenmail.app) — powers the Team split demo
    { name: 'Mina Cho', email: 'mina@zenmail.app' },
    { name: 'Jordan Lee', email: 'jordan@zenmail.app' },
    { name: 'Priya Shah', email: 'priya@zenmail.app' },
    { name: 'Sam Rivera', email: 'sam@zenmail.app' },
  ];

  const mk = (
    i: number,
    from: Contact,
    subject: string,
    snippet: string,
    labelIds: string[],
    ageHours: number,
    paragraphs: string[],
    opts: { quoted?: string; messageCount?: number } = {}
  ): MockThread => {
    const id = `demo_${i}`;
    const date = now - ageHours * h;
    const unread = labelIds.includes('UNREAD');
    const messageCount = opts.messageCount ?? 1;
    const messages = Array.from({ length: messageCount }, (_, mi) => ({
      id: `${id}_m${mi}`,
      threadId: id,
      from: mi % 2 === 1 ? { name: 'You', email: 'demo@zenmail.app' } : from,
      to: [{ name: 'You', email: 'demo@zenmail.app' }],
      cc: [] as Contact[],
      date: date - (messageCount - 1 - mi) * h,
      snippet,
      bodyHtml: demoBody(paragraphs, mi === messageCount - 1 ? opts.quoted : undefined),
      bodyText: paragraphs.join('\n\n'),
      labelIds,
    }));
    return {
      summary: {
        id,
        subject,
        from,
        snippet,
        date,
        unread,
        labelIds,
        messageCount,
      },
      detail: { id, subject, labelIds, messages },
    };
  };

  const threads: MockThread[] = [
    mk(1, senders[0], 'Q3 roadmap review — comments due Friday', 'Left a few comments on the density section, mostly around the thread list…', ['INBOX', 'UNREAD', 'Label_work'], 1, [
      'Left a few comments on the density section, mostly around the thread list virtualization budget.',
      'Can you take a pass before Friday standup? The open question is whether we ship split inbox in the first beta.',
    ]),
    mk(2, senders[2], 'Re: keyboard shortcut audit', 'Agreed — ] and [ for thread nav matches Superhuman, let\'s keep it.', ['INBOX', 'Label_work'], 3, [
      'Agreed — ] and [ for thread nav matches Superhuman, let\'s keep it.',
      'One more thing: ⌘⇧I for split toggle conflicts with nothing on macOS, verified against the system list.',
    ], { quoted: 'On Tue, you wrote:<br>Should we mirror Gmail or Superhuman for bracket nav?', messageCount: 3 }),
    mk(3, senders[3], 'Design tokens v2', 'Updated the accent indigo ramp and the label palette, file attached in Figma…', ['INBOX', 'UNREAD', 'Label_work'], 5, [
      'Updated the accent indigo ramp and the label palette — link in the usual Figma project.',
      'The muted text color moves from #555 to #5a5a5a for AA on the subtle background.',
    ]),
    mk(4, senders[4], '[zenmail/zenmail] PR #42: snooze daemon', 'ci: all checks passed. 2 approvals. Ready to merge.', ['INBOX', 'UNREAD', 'CATEGORY_UPDATES'], 2, [
      'All checks have passed on <b>snooze-daemon</b>.',
      '2 approvals — ready to merge when you are.',
    ]),
    mk(5, senders[5], 'Your receipt from Stripe #2044-8821', 'Amount paid: $12.00 — Thanks for your business!', ['INBOX', 'CATEGORY_UPDATES', 'Label_finance'], 8, [
      'Amount paid: <b>$12.00</b>',
      'Invoice #2044-8821 · Card ending 4242.',
    ]),
    mk(6, senders[6], 'E-ticket: ICN → SFO, Jul 18', 'Your booking is confirmed. Check-in opens 24h before departure.', ['INBOX', 'UNREAD', 'CATEGORY_UPDATES', 'Label_travel'], 26, [
      'Your booking is confirmed: ICN → SFO, Jul 18, 10:40 KST.',
      'Check-in opens 24 hours before departure. Baggage allowance 23kg × 2.',
    ]),
    mk(7, senders[7], '😸 Today: a calmer email client', 'ZenMail — Linear density meets Superhuman shortcuts, no AI, no subscription.', ['INBOX', 'CATEGORY_PROMOTIONS'], 12, [
      'ZenMail — Linear density meets Superhuman shortcuts, no AI, no subscription.',
      'Plus 9 other launches you missed today.',
    ]),
    mk(8, senders[8], 'You appeared in 12 searches this week', 'See who\'s looking at your profile…', ['INBOX', 'CATEGORY_SOCIAL'], 30, [
      'You appeared in 12 searches this week.',
    ]),
    mk(9, senders[9], 'Issue #204: Electron 33, SQLite WAL mode, kbar patterns', 'This week: why WAL mode matters for desktop apps, kbar action trees…', ['INBOX', 'CATEGORY_FORUMS'], 50, [
      'This week: why WAL mode matters for desktop apps, kbar action trees, and PKCE loopback flows.',
    ]),
    mk(10, senders[1], 'Coffee next week?', 'In town Tue–Thu. Wednesday afternoon still your quiet block?', ['INBOX', 'UNREAD'], 7, [
      'In town Tue–Thu. Wednesday afternoon still your quiet block?',
      'There\'s a new place near the station — supposedly the best pour-over in the city.',
    ], { messageCount: 2 }),
    mk(11, senders[2], 'Standup notes 6/30', 'Cache layer done, FTS search next. Blocked on OAuth client id for staging.', ['INBOX', 'Label_work'], 49, [
      'Cache layer done, FTS search next. Blocked on OAuth client id for staging.',
    ]),
    mk(12, senders[5], 'Upcoming invoice: your plan renews Jul 15', 'Your Pro plan ($12/mo) renews on Jul 15.', ['INBOX', 'CATEGORY_UPDATES', 'Label_finance'], 72, [
      'Your Pro plan ($12/mo) renews on Jul 15.',
    ]),
    mk(13, senders[0], 'Re: offsite agenda', 'Day 2 afternoon is still open — thoughts on a keyboard-shortcut golf session?', ['INBOX'], 96, [
      'Day 2 afternoon is still open — thoughts on a keyboard-shortcut golf session?',
    ], { quoted: 'Draft agenda attached. Day 1: roadmap. Day 2: hack time.', messageCount: 4 }),
    mk(14, senders[3], 'Sent you the empty-state illustrations', 'Three options: minimal line, duotone, and a very zen rock garden.', ['INBOX', 'UNREAD'], 11, [
      'Three options: minimal line, duotone, and a very zen rock garden.',
      'The rock garden one is obviously correct.',
    ]),
    mk(15, senders[1], 'Your draft: investor update', '(draft) June metrics: retention up 4pts, burn flat…', ['DRAFT'], 20, [
      'June metrics: retention up 4pts, burn flat.',
    ]),
    mk(16, { name: 'You', email: 'demo@zenmail.app' }, 'Re: contract renewal', 'Signed copy attached. Same terms, 12 months.', ['SENT'], 15, [
      'Signed copy attached. Same terms, 12 months.',
    ]),
    mk(17, senders[10], 'Sprint 14 planning — capacity check', 'Pulled everyone\'s PTO into the capacity sheet, we\'re at 34 points this sprint…', ['INBOX', 'UNREAD', 'Label_work'], 4, [
      'Pulled everyone\'s PTO into the capacity sheet — we\'re at 34 points this sprint, down from 40.',
      'Can you flag anything from the split-inbox backlog that should slip to Sprint 15?',
    ], { messageCount: 2 }),
    mk(18, senders[11], 'Postmortem: snooze daemon missed wake at 3am', 'Root cause was a stale setTimeout across sleep/wake, fix is up for review…', ['INBOX', 'UNREAD', 'Label_work'], 9, [
      'Root cause: a stale setTimeout survived the laptop sleep/wake cycle, so the daemon missed the 3am wake.',
      'Fix replaces the timer with a periodic re-check against wall-clock time — PR is up for review.',
    ]),
    mk(19, senders[12], 'Re: interview loop for the design role', 'Panel is set for Thursday — I\'ll take the portfolio review slot.', ['INBOX', 'Label_work'], 33, [
      'Panel is set for Thursday — I\'ll take the portfolio review slot, you take culture add.',
      'Sharing the take-home brief now so we\'re aligned before the debrief.',
    ], { quoted: 'On Mon, you wrote:<br>Can we finalize the interview loop by Wednesday?', messageCount: 3 }),
  ];

  // F5 CP4 (Instant Intro, DECISIONS D8): a short double opt-in intro — one message, from a third
  // party, cc'ing another third party, subject reads as an intro. Deliberately from a sender that
  // matches none of the default split rules (not ana@linearly.dev, not the @zenmail.app domain, not
  // a newsletter-pattern address) so it lands in the Other tab and doesn't disturb VIP/Team/Newsletter
  // counts or ordering relied on elsewhere in the demo data / E2E suite.
  const introFrom: Contact = { name: 'Jamie Wu', email: 'jamie@indiehatch.dev' };
  const introOther: Contact = { name: 'Yuna Cho', email: 'yuna.cho@partnerco.dev' };
  const introSubject = 'Intro: Yuna <> ZenMail team';
  const introSnippet = 'Meet Yuna — she leads partnerships at Partner Co and has been asking about our API.';
  const introParagraphs = [
    'Meet Yuna — she leads partnerships at Partner Co and has been asking about our API.',
    'Yuna, meet the ZenMail team. I\'ll let you two take it from here!',
  ];
  const introId = 'demo_20';
  const introLabelIds = ['INBOX'];
  const introMessage = {
    id: `${introId}_m0`,
    threadId: introId,
    from: introFrom,
    to: [{ name: 'You', email: 'demo@zenmail.app' }],
    cc: [introOther],
    // oldest seed on purpose: keeps demo_20 at the bottom of the INBOX so the
    // index/order assumptions of earlier E2E scenarios (F2 TC-FUP-*) are undisturbed
    date: now - 120 * h,
    snippet: introSnippet,
    bodyHtml: demoBody(introParagraphs),
    bodyText: introParagraphs.join('\n\n'),
    labelIds: introLabelIds,
  };
  threads.push({
    summary: {
      id: introId,
      subject: introSubject,
      from: introFrom,
      snippet: introSnippet,
      date: introMessage.date,
      unread: false,
      labelIds: introLabelIds,
      messageCount: 1,
    },
    detail: { id: introId, subject: introSubject, labelIds: introLabelIds, messages: [introMessage] },
  });

  // calendar-integration: 초대 메일 시드. events@calendly.example 은 어떤 split 규칙에도 매칭되지
  // 않고(도메인/VIP/newsletter 아님), 최고령 date라 기존 split 카운트/순서(F1~F6 E2E)를 건드리지 않는다.
  const inviteFrom: Contact = { name: 'Calendly', email: 'events@calendly.example' };
  const icsRequest = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    'UID:demo-evt-standup', 'SUMMARY:Sprint 14 planning', 'DTSTART:20260716T090000Z',
    'DTEND:20260716T093000Z', 'ORGANIZER;CN=Ana Torres:mailto:ana@linearly.dev',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const inviteA = extractInvite(icsRequest);
  const calId = 'demo_cal_1';
  const calBase = now - 118 * h;
  const calMessages = [0, 1].map((mi) => ({
    id: `${calId}_m${mi}`,
    threadId: calId,
    from: inviteFrom,
    to: [{ name: 'You', email: 'demo@zenmail.app' }],
    cc: [] as Contact[],
    date: calBase + mi * h, // m1이 최신 — A3에서 최신 invite 1건만 노출
    snippet: 'You are invited: Sprint 14 planning',
    bodyHtml: demoBody(['You are invited to Sprint 14 planning.', mi === 1 ? '(Updated time)' : '']),
    bodyText: 'You are invited to Sprint 14 planning.',
    labelIds: ['INBOX'],
    ...(inviteA ? { invite: inviteA } : {}),
  }));
  threads.push({
    summary: {
      id: calId, subject: 'Invitation: Sprint 14 planning', from: inviteFrom,
      snippet: 'You are invited: Sprint 14 planning', date: calMessages[1].date,
      unread: false, labelIds: ['INBOX'], messageCount: 2,
    },
    detail: { id: calId, subject: 'Invitation: Sprint 14 planning', labelIds: ['INBOX'], messages: calMessages },
  });

  // A4: 날짜 해석 불가 ICS — extractInvite가 undefined → invite 미노출(배너 없음), 크래시 없음.
  const icsBad = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    'UID:demo-evt-bad', 'SUMMARY:Broken invite', 'DTSTART:not-a-real-date',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const inviteBad = extractInvite(icsBad); // undefined
  const badId = 'demo_cal_2';
  const badMessage = {
    id: `${badId}_m0`, threadId: badId, from: inviteFrom,
    to: [{ name: 'You', email: 'demo@zenmail.app' }], cc: [] as Contact[],
    date: now - 119 * h, snippet: 'Broken invite', bodyHtml: demoBody(['Broken invite.']),
    bodyText: 'Broken invite.', labelIds: ['INBOX'],
    ...(inviteBad ? { invite: inviteBad } : {}),
  };
  threads.push({
    summary: {
      id: badId, subject: 'Invitation: Broken invite', from: inviteFrom,
      snippet: 'Broken invite', date: badMessage.date, unread: false,
      labelIds: ['INBOX'], messageCount: 1,
    },
    detail: { id: badId, subject: 'Invitation: Broken invite', labelIds: ['INBOX'], messages: [badMessage] },
  });

  // inbox-zero-starred (TC-IZ-B*): starred 시맨틱 검증용 2건. 발신자는 어떤 split 규칙에도 안 걸리고
  // (VIP ana@linearly.dev·Team @zenmail.app·newsletter 패턴 아님), date는 기존 최고령(120h, demo_20)
  // 보다 더 오래됐다 — 기존 E2E 카운트/순서 불변식을 건드리지 않는다(F5 시드 관례).
  const starredKeep: Contact = { name: 'Riley Fox', email: 'riley@quietmail.example' };
  const starredArchived: Contact = { name: 'Morgan Vale', email: 'morgan@stillhere.example' };
  threads.push(
    mk(21, starredKeep, 'Starred: keep me visible', 'Starred while still in the inbox — stays with a ★.', ['INBOX', 'STARRED'], 130, [
      'This one is starred and still in the inbox.',
    ]),
    mk(22, starredArchived, 'Starred archived: still here', 'Archived elsewhere but starred — must remain in the inbox view.', ['STARRED'], 132, [
      'This one was archived but kept its star, so the inbox view still shows it.',
    ])
  );

  return { threads, labels, senders };
}

export class MockGmailProvider implements GmailProvider {
  readonly demo = true;
  readonly email = 'demo@zenmail.app';
  private threads: MockThread[];
  private labels: Label[];
  private senders: Contact[];
  /** F6 CP2/D13 offline simulation — when true, network-shaped methods coded-throw ECONNRESET. */
  offline = false;
  /** E2E-only (TC-SY-B5): one-shot — makes the next modifyThread for this exact threadId throw a
   *  permanent (coded {status:400}) error. Unlike ipc.ts's debugFailNextModify (scoped to the
   *  modify-labels/snooze IPC handlers), this fires *inside the provider*, so it also reaches the
   *  daemon drain loop (snooze.ts calls provider.modifyThread directly) — the only place a queued
   *  offline mutation can hit a permanent 4xx and get dropped. Consumed on the matching call. */
  private failModifyForThread: string | null = null;
  /** E2E-only (TC-SY-D1): per-method invocation counters, read via mail:debug-provider-calls. */
  readonly callCounts: Record<string, number> = {};

  constructor() {
    const data = buildDemoData();
    this.threads = data.threads;
    this.labels = data.labels;
    this.senders = data.senders;
  }

  setOffline(v: boolean): void {
    this.offline = v;
  }

  /** E2E-only (TC-SY-B5): arm a one-shot permanent (4xx) failure for the next modifyThread on `id`. */
  failNextModifyForThread(id: string): void {
    this.failModifyForThread = id;
  }

  /** After the round-trip delay, throw a transient coded error so classifyError → 'transient'. */
  private failIfOffline(): void {
    if (!this.offline) return;
    const e = new Error('offline (mock)') as Error & { code: string };
    e.code = 'ECONNRESET';
    throw e;
  }

  private async delay(): Promise<void> {
    await new Promise((r) => setTimeout(r, 120));
  }

  async listThreads(req: FetchThreadsRequest): Promise<FetchThreadsResponse> {
    this.callCounts.listThreads = (this.callCounts.listThreads ?? 0) + 1;
    await this.delay();
    this.failIfOffline();
    // !req.q mirrors RealGmailProvider's routing guard (D2) — a combined labelIds+q request must
    // fall through to the plain AND-match + substring-filter path on both providers, not diverge.
    const isInboxView = req.labelIds?.length === 1 && req.labelIds[0] === 'INBOX' && !req.q;
    let rows = this.threads.filter((t) => !t.summary.labelIds.includes('TRASH') || req.labelIds?.includes('TRASH'));
    if (isInboxView) {
      // inbox-zero-starred D1: 인박스 뷰 술어 공유 — (INBOX ∨ STARRED) − TRASH − SPAM − snoozed.
      rows = rows.filter((t) => isInInboxView(t.summary.labelIds, DEMO_SNOOZE_LABEL_ID));
    } else if (req.labelIds?.length) {
      rows = rows.filter((t) => req.labelIds!.every((l) => t.summary.labelIds.includes(l)));
    }
    if (req.q) {
      const q = req.q.toLowerCase();
      rows = rows.filter(
        (t) =>
          t.summary.subject.toLowerCase().includes(q) ||
          t.summary.snippet.toLowerCase().includes(q) ||
          t.summary.from.name.toLowerCase().includes(q) ||
          t.summary.from.email.toLowerCase().includes(q)
      );
    }
    rows = [...rows].sort((a, b) => b.summary.date - a.summary.date);
    return { threads: rows.map((t) => ({ ...t.summary, labelIds: [...t.summary.labelIds] })) };
  }

  async getThread(threadId: string): Promise<ThreadDetail> {
    this.callCounts.getThread = (this.callCounts.getThread ?? 0) + 1;
    await this.delay();
    this.failIfOffline();
    const t = this.threads.find((t) => t.summary.id === threadId);
    if (!t) throw new Error(`Unknown thread ${threadId}`);
    return JSON.parse(JSON.stringify(t.detail));
  }

  async listLabels(): Promise<Label[]> {
    await this.delay();
    return this.labels.map((l) => ({
      ...l,
      unreadCount: this.threads.filter(
        (t) => t.summary.unread && t.summary.labelIds.includes(l.id)
      ).length,
    }));
  }

  async send(req: SendRequest): Promise<SendResult> {
    this.callCounts.send = (this.callCounts.send ?? 0) + 1;
    await this.delay();
    this.failIfOffline();
    const id = `demo_sent_${Date.now()}`;
    const from = { name: 'You', email: this.email };
    const to = req.to.map((e) => ({ name: e, email: e }));
    const msg = {
      id: `${id}_m0`,
      threadId: req.threadId ?? id,
      from,
      to,
      cc: (req.cc ?? []).map((e) => ({ name: e, email: e })),
      date: Date.now(),
      snippet: req.body.replace(/<[^>]+>/g, '').slice(0, 100),
      bodyHtml: req.body,
      bodyText: req.body.replace(/<[^>]+>/g, ''),
      labelIds: ['SENT'],
    };
    if (req.threadId) {
      const t = this.threads.find((t) => t.summary.id === req.threadId);
      if (t) {
        t.detail.messages.push(msg);
        t.summary.messageCount += 1;
        t.summary.date = msg.date;
        t.summary.snippet = msg.snippet;
        return { threadId: t.summary.id, messageId: msg.id };
      }
    }
    this.threads.push({
      summary: {
        id,
        subject: req.subject || '(no subject)',
        from,
        snippet: msg.snippet,
        date: msg.date,
        unread: false,
        labelIds: ['SENT'],
        messageCount: 1,
      },
      detail: { id, subject: req.subject, labelIds: ['SENT'], messages: [msg] },
    });
    return { threadId: id, messageId: msg.id };
  }

  /** E2E/demo helper: inject an inbound reply from a non-me participant into a thread. */
  simulateReply(threadId: string): void {
    const t = this.threads.find((t) => t.summary.id === threadId);
    if (!t) return;
    const meEmail = this.email.toLowerCase();
    const existingNonMe = [...t.detail.messages]
      .reverse()
      .find((m) => m.from.email.toLowerCase() !== meEmail)?.from;
    const from =
      existingNonMe ?? (t.summary.from.email.toLowerCase() !== meEmail ? t.summary.from : this.senders[0]);
    const date = Date.now();
    const snippet = 'Sounds good, thanks for the update!';
    const msg = {
      id: `${threadId}_reply_${date}`,
      threadId,
      from,
      to: [{ name: 'You', email: this.email }],
      cc: [] as Contact[],
      date,
      snippet,
      bodyHtml: `<div><p>${snippet}</p></div>`,
      bodyText: snippet,
      labelIds: ['INBOX', 'UNREAD'],
    };
    t.detail.messages.push(msg);
    t.summary.date = date;
    t.summary.unread = true;
    t.summary.snippet = snippet;
  }

  /**
   * inbox-zero-starred (TC-IZ-A1/A2): "Gmail 웹에서 아카이브" 재현 — provider 저장소에서만 INBOX를
   * 제거한다(modifyThread 부기·캐시·mutations 큐 우회). 다음 revalidate가 뷰 부재를 감지해 캐시/리스트
   * 에서 수렴시켜야 한다는 것을 검증하기 위한 E2E 전용 훅. mock 전용(real provider엔 없음).
   */
  externalArchive(threadId: string): void {
    const t = this.threads.find((t) => t.summary.id === threadId);
    if (!t) return;
    t.summary.labelIds = t.summary.labelIds.filter((l) => l !== 'INBOX');
    t.detail.labelIds = t.detail.labelIds.filter((l) => l !== 'INBOX');
  }

  async modifyThread(req: ModifyLabelsRequest): Promise<void> {
    this.callCounts.modifyThread = (this.callCounts.modifyThread ?? 0) + 1;
    await this.delay();
    if (this.failModifyForThread && req.threadId === this.failModifyForThread) {
      this.failModifyForThread = null;
      const e = new Error('permanent modify failure (mock 400)') as Error & { status: number };
      e.status = 400;
      throw e;
    }
    this.failIfOffline();
    const t = this.threads.find((t) => t.summary.id === req.threadId);
    if (!t) return;
    const set = new Set(t.summary.labelIds);
    req.removeLabelIds.forEach((l) => set.delete(l));
    req.addLabelIds.forEach((l) => set.add(l));
    t.summary.labelIds = [...set];
    t.summary.unread = set.has('UNREAD');
    t.detail.labelIds = [...set];
  }

  async snoozeLabelId(): Promise<string> {
    return DEMO_SNOOZE_LABEL_ID;
  }
}
