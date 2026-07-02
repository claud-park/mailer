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
}

export interface SendReceipt {
  /** id used to cancel within the undo window */
  sendId: string;
  /** epoch ms when the mail will actually go out */
  sendAt: number;
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

  onThreadsUpdated(cb: () => void): () => void;
  onSnoozeFired(cb: (threadId: string) => void): () => void;
}

export const SNOOZE_LABEL_NAME = 'zenmail/snoozed';

/** Gmail category labels excluded from the Primary section of the split inbox */
export const CATEGORY_LABELS = [
  'CATEGORY_SOCIAL',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_UPDATES',
  'CATEGORY_FORUMS',
];
