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

export interface AttachmentInfo {
  /** Gmail attachment id — getAttachment가 바이트를 가져오는 키 */
  attachmentId: string;
  filename: string;
  mimeType: string;
  /** 바이트 크기 (body.size) */
  size: number;
  /** 'Content-ID' 헤더(양끝 <> 제거) — 인라인 이미지에만 존재 */
  contentId?: string;
  /** Content-Disposition:inline && contentId 존재 → 본문 cid 참조(스트립에서 제외) */
  inline: boolean;
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
  /** 첨부 파트 메타데이터(바이트 아님). 첨부 없으면 미노출(invite와 동일 optional 패턴). */
  attachments?: AttachmentInfo[];
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
  /** calendar.events scope 보유 여부. false면 캘린더 기능만 비활성(메일 무영향). 데모는 항상 true. */
  calendarReady: boolean;
  /** INBOX 안읽음 스레드 수 — 사이드바 계정 배지. 데몬 틱/최초 스냅샷에서 갱신. */
  unreadCount: number;
  /** 토큰 복원/갱신 실패 — 이 계정의 mail IPC는 reject, 다른 계정 무영향. 재로그인(addAccount)으로 복구. */
  needsReauth: boolean;
}

export interface AccountsSnapshot {
  accounts: AccountInfo[];
  activeEmail: string | null;
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

/** API surface exposed on window.zenmail via contextBridge (accountId는 항상 첫 인자, string 필수) */
export interface ZenmailApi {
  listAccounts(): Promise<AccountsSnapshot>;
  /** real OAuth 플로우 기동 — 성공 시 계정 추가(동일 email 재로그인 = 토큰 갱신/reauth) */
  addAccount(): Promise<AccountsSnapshot>;
  /** 데모 세션 기동 — mock 계정 2개(demo@zenmail.app, work@zenmail.app) 생성, active=demo */
  signInDemo(): Promise<AccountsSnapshot>;
  /** 해당 계정만 제거: keytar 토큰 삭제 + accounts.json 제거 + 계정 DB 파일 삭제 */
  removeAccount(email: string): Promise<AccountsSnapshot>;
  /** accounts.json activeEmail 영속화(실계정 한정 — 데모 계정은 in-memory) */
  setActiveAccount(email: string): Promise<void>;

  fetchThreads(accountId: string, req: FetchThreadsRequest): Promise<FetchThreadsResponse>;
  fetchThread(accountId: string, threadId: string): Promise<ThreadDetail>;
  fetchLabels(accountId: string): Promise<Label[]>;
  send(accountId: string, req: SendRequest): Promise<SendReceipt>;
  cancelSend(accountId: string, sendId: string): Promise<boolean>;
  modifyLabels(accountId: string, req: ModifyLabelsRequest): Promise<void>;
  snooze(accountId: string, req: SnoozeRequest): Promise<void>;
  searchLocal(accountId: string, q: string): Promise<ThreadSummary[]>;
  listContacts(accountId: string, prefix: string): Promise<Contact[]>;
  getSplits(accountId: string): Promise<SplitDefinition[]>;
  setSplits(accountId: string, defs: SplitDefinition[]): Promise<void>;
  getSetting(accountId: string, key: string): Promise<string | null>;
  setSetting(accountId: string, key: string, value: string): Promise<void>;
  /** 앱 전역 설정(테마 등) — userData/settings.json. 계정 DB 아님. */
  getGlobalSetting(key: string): Promise<string | null>;
  setGlobalSetting(key: string, value: string): Promise<void>;

  addFollowup(accountId: string, threadId: string, remindDays: number): Promise<void>;
  cancelFollowup(accountId: string, threadId: string): Promise<void>;
  dismissFollowup(accountId: string, threadId: string): Promise<void>;
  listFollowups(accountId: string): Promise<FollowupInfo[]>;

  listEvents(accountId: string, timeMinISO: string, timeMaxISO: string): Promise<CalendarEvent[]>;
  respondToEvent(accountId: string, iCalUID: string, response: RsvpResponse): Promise<void>;
  createEvent(accountId: string, input: CreateEventInput): Promise<CalendarEvent>;

  /** 이미지 첨부 바이트를 data URI로 가져온다(인라인 cid 렌더 + 스트립 썸네일). mimeType은 렌더러가
   *  AttachmentInfo로 이미 아는 값을 전달(Gmail attachments.get이 mimeType을 안 주기 때문). */
  getAttachmentImage(
    accountId: string,
    messageId: string,
    attachmentId: string,
    mimeType: string
  ): Promise<{ dataUri: string; mimeType: string } | { error: string }>;
  /** 첨부를 다운로드 폴더로 저장(다이얼로그 없음, 충돌 시 (1) 리네임). */
  downloadAttachment(
    accountId: string,
    messageId: string,
    attachmentId: string,
    filename: string
  ): Promise<{ savedPath: string } | { error: string }>;

  /** D9 accelerator: tells main the renderer regained connectivity, forcing an immediate drain. */
  notifyOnline(): Promise<void>;

  /**
   * The single change-propagation channel (F6 CP5, D1): main pushes a thread-list diff. Mutation-origin
   * payloads carry {upserts, removals} the renderer merges without any refetch; daemon-origin payloads
   * set needsRefetch so the renderer does a full refresh() instead. accountId scopes the diff to one account.
   */
  onThreadsChanged(
    cb: (p: { accountId: string; upserts: ThreadSummary[]; removals: string[]; needsRefetch?: boolean }) => void
  ): () => void;
  /** SWR revalidate push (F6 CP4, D11): main sends the fresh detail when a cache-hit read diverged. */
  onThreadChanged(cb: (p: { accountId: string; threadId: string; detail: ThreadDetail }) => void): () => void;
  onSnoozeFired(cb: (p: { accountId: string; threadId: string }) => void): () => void;
  onFollowupFired(cb: (p: { accountId: string; threadId: string }) => void): () => void;
  /** D10: sidebar sync line data push — {online, pending queue depth}. 전역 합산. */
  onSyncState(cb: (s: { online: boolean; pending: number }) => void): () => void;
  /** D10: a queued mutation or send exhausted retries (or hit a permanent error) — renderer
   *  reconciles with a refresh() + toast rather than trusting its stale optimistic state. */
  onMutationPermanentFailed(cb: (p: { accountId: string; threadId: string | null; kind: string }) => void): () => void;
  /** 배지/needsReauth/계정 목록 변화 push — 데몬 틱·addAccount·removeAccount에서 발화 */
  onAccountsChanged(cb: (snap: AccountsSnapshot) => void): () => void;

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
  /** E2E-only (inbox-zero-starred TC-IZ-A1/A2): "Gmail 웹에서 아카이브" 재현 — mock provider에서만
   *  INBOX를 벗겨(캐시·modifyThread 우회) 외부 변경 수렴을 검증한다. real provider에선 no-op. */
  __debugExternalArchive?(threadId: string): Promise<void>;
  /** E2E-only (starred-view TC-STAR-C1): "Gmail 웹에서 별표 해제" 재현 — mock provider에서만
   *  STARRED를 벗겨(캐시·modifyThread 우회) 외부 변경 수렴을 검증한다. real provider에선 no-op. */
  __debugExternalUnstar?(threadId: string): Promise<void>;
  /** E2E-only: mock 캘린더 상태 스냅샷(시드 이벤트 + 기록된 RSVP 응답). */
  __debugCalendarState?(): Promise<{ events: CalendarEvent[]; responses: Record<string, string> }>;
  /** E2E-only: 다음 calendar:* 호출 1회를 실패시킴(one-shot). */
  __debugFailNextCalendar?(): Promise<void>;
  /** E2E-only: 데모 세션의 calendarReady 게이트 시뮬레이션(재시작/재로그인 전까지 유지). */
  __debugSetCalendarReady?(v: boolean): Promise<void>;
  /** E2E-only: 다음 getAttachment 호출 1회를 실패시킴(one-shot). */
  __debugFailNextAttachment?(): Promise<void>;
  /** E2E-only: 다운로드 저장 디렉터리 오버라이드(실제 Downloads 오염 방지 + 저장 경로/리네임 검증). */
  __debugSetDownloadDir?(dir: string): Promise<void>;
}

export const SNOOZE_LABEL_NAME = 'zenmail/snoozed';

/** Gmail category labels excluded from the Primary section of the split inbox */
export const CATEGORY_LABELS = [
  'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
];
