// Shared types between main and renderer processes.

export interface Contact {
  name: string;
  email: string;
}

export interface Label {
  id: string;
  name: string;
  type: 'system' | 'user';
  color?: { textColor: string; backgroundColor: string };
  unreadCount: number;
  visible: boolean;
}

export interface ThreadSummary {
  id: string;
  subject: string;
  from: Contact;
  snippet: string;
  /** epoch ms of the latest message */
  date: number;
  unread: boolean;
  labelIds: string[];
  messageCount: number;
}

export interface InviteInfo {
  /** ICS UID — respondToEvent가 이벤트를 특정하는 키 */
  iCalUID: string;
  summary: string;
  /** ISO 8601 (UTC 또는 TZID 해석 결과) */
  startISO: string;
  endISO?: string;
  /** organizer 이메일 (mailto: 접두 제거) */
  organizer?: string;
  /** 'REQUEST'만 노출 (범위 밖 CANCEL/REPLY는 extractInvite에서 걸러짐) */
  method: string;
}

export type RsvpResponse = 'accepted' | 'tentative' | 'declined';

export interface CalendarEvent {
  id: string;
  iCalUID?: string;
  summary: string;
  /** ISO 8601 시작 */
  startISO: string;
  endISO?: string;
  allDay: boolean;
  organizer?: string;
}

export interface CreateEventInput {
  summary: string;
  /** ISO 8601 */
  startISO: string;
  endISO: string;
  /** 참석자 이메일 목록 (본인 제외) */
  attendees: string[];
}

export interface MessageDetail {
  id: string;
  threadId: string;
  from: Contact;
  to: Contact[];
  cc: Contact[];
  date: number;
  snippet: string;
  bodyHtml: string;
  bodyText: string;
  labelIds: string[];
  /** METHOD:REQUEST ICS가 붙은 메시지에만 존재 (초대 배너용). extractInvite fail-safe로 파싱 실패 시 undefined. */
  invite?: InviteInfo;
}

export interface ThreadDetail {
  id: string;
  subject: string;
  labelIds: string[];
  messages: MessageDetail[];
}

export interface FetchThreadsRequest {
  labelIds?: string[];
  q?: string;
  pageToken?: string;
}

export interface FetchThreadsResponse {
  threads: ThreadSummary[];
  nextPageToken?: string;
}

export interface SendRequest {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** HTML body */
  body: string;
  /** set when replying/forwarding within a thread */
  threadId?: string;
  inReplyTo?: string;
  /** ISO datetime — schedule send instead of sending now */
  sendAt?: string;
  /** archive the thread right after sending */
  archive?: boolean;
  /** remind me if no reply within N days (follow-up reminder) */
  remindDays?: number;
}

export interface SendReceipt {
  /** id used to cancel within the undo window */
  sendId: string;
  /** epoch ms when the mail will actually go out */
  sendAt: number;
}

/** result of an actual GmailProvider.send() call (main-process internal only) */
export interface SendResult {
  threadId: string;
  messageId: string;
}

export interface ModifyLabelsRequest {
  threadId: string;
  addLabelIds: string[];
  removeLabelIds: string[];
}

export interface SnoozeRequest {
  threadId: string;
  /** ISO datetime */
  until: string;
}

export interface AccountInfo {
  email: string;
  demo: boolean;
}

export type SplitRule =
  | { kind: 'senders'; emails: string[] }
  | { kind: 'domains'; domains: string[] }
  | { kind: 'labels'; labelIds: string[] }
  | { kind: 'newsletter' };

export interface SplitDefinition {
  id: string;
  name: string;
  position: number; // 정렬 = 우선순위 = ⌘N 매핑
  enabled: boolean;
  rule: SplitRule;
}

export interface FollowupInfo {
  threadId: string;
  status: 'pending' | 'fired';
  dueAt: number;
}

export interface SnippetRecord {
  id: string;
  name: string;
  body: string;
  createdAt: number;
}

/** API surface exposed on window.zenmail via contextBridge */
export interface ZenmailApi {
  getAccount(): Promise<AccountInfo | null>;
  signIn(): Promise<AccountInfo>;
  signInDemo(): Promise<AccountInfo>;
  signOut(): Promise<void>;

  fetchThreads(req: FetchThreadsRequest): Promise<FetchThreadsResponse>;
  fetchThread(threadId: string): Promise<ThreadDetail>;
  fetchLabels(): Promise<Label[]>;
  send(req: SendRequest): Promise<SendReceipt>;
  cancelSend(sendId: string): Promise<boolean>;
  modifyLabels(req: ModifyLabelsRequest): Promise<void>;
  snooze(req: SnoozeRequest): Promise<void>;
  searchLocal(q: string): Promise<ThreadSummary[]>;
  listContacts(prefix: string): Promise<Contact[]>;
  getSplits(): Promise<SplitDefinition[]>;
  setSplits(defs: SplitDefinition[]): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;

  addFollowup(threadId: string, remindDays: number): Promise<void>;
  cancelFollowup(threadId: string): Promise<void>;
  dismissFollowup(threadId: string): Promise<void>;
  listFollowups(): Promise<FollowupInfo[]>;

  /** D9 accelerator: tells main the renderer regained connectivity, forcing an immediate drain. */
  notifyOnline(): Promise<void>;

  /**
   * The single change-propagation channel (F6 CP5, D1): main pushes a thread-list diff. Mutation-origin
   * payloads carry {upserts, removals} the renderer merges without any refetch; daemon-origin payloads
   * set needsRefetch so the renderer does a full refresh() instead.
   */
  onThreadsChanged(
    cb: (p: { upserts: ThreadSummary[]; removals: string[]; needsRefetch?: boolean }) => void
  ): () => void;
  /** SWR revalidate push (F6 CP4, D11): main sends the fresh detail when a cache-hit read diverged. */
  onThreadChanged(cb: (p: { threadId: string; detail: ThreadDetail }) => void): () => void;
  onSnoozeFired(cb: (threadId: string) => void): () => void;
  onFollowupFired(cb: (threadId: string) => void): () => void;
  /** D10: sidebar sync line data push — {online, pending queue depth}. */
  onSyncState(cb: (s: { online: boolean; pending: number }) => void): () => void;
  /** D10: a queued mutation or send exhausted retries (or hit a permanent error) — renderer
   *  reconciles with a refresh() + toast rather than trusting its stale optimistic state. */
  onMutationPermanentFailed(cb: (p: { threadId: string | null; kind: string }) => void): () => void;

  /** E2E-only debug hooks — only present when ZENMAIL_E2E_PORT is set (see preload.ts) */
  __debugSimulateReply?(threadId: string): Promise<void>;
  __debugTick?(): Promise<void>;
  /** E2E-only: force-add/replace a followup whose baseline+due are both "now" (bypasses the
   *  FollowupPicker's day-count-only input so tests can exercise the due-in-the-past path). */
  __debugAddFollowupDueNow?(threadId: string): Promise<void>;
  /** E2E-only: makes the next mail:modify-labels or mail:snooze call throw (one-shot, consumed on use). */
  __debugFailNextModify?(): Promise<void>;
  /** E2E-only (TC-SY-B5): one-shot permanent (4xx) failure for the next modifyThread on `threadId`,
   *  fired inside the provider so it also reaches the daemon drain loop (queued-mutation drop path). */
  __debugFailNextModifyForThread?(threadId: string): Promise<void>;
  /** E2E-only: toggle simulated connectivity — false makes the mock provider coded-throw ECONNRESET (D13). */
  __debugSetOnline?(v: boolean): Promise<void>;
  /** E2E-only: current mutation-queue depth. */
  __debugQueueDepth?(): Promise<number>;
  /** E2E-only: MockGmailProvider network-method call counts (e.g. listThreads) — used to prove
   *  a mutation's diff-push does NOT trigger a list refetch (TC-SY-D1). */
  __debugProviderCalls?(): Promise<Record<string, number>>;
}

export const SNOOZE_LABEL_NAME = 'zenmail/snoozed';

/** Gmail category labels excluded from the Primary section of the split inbox */
export const CATEGORY_LABELS = [
  'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
];
