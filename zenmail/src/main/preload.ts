import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccountsSnapshot,
  CreateEventInput,
  FetchThreadsRequest,
  Label,
  ModifyLabelsRequest,
  RsvpResponse,
  SendRequest,
  SnoozeRequest,
  SplitDefinition,
  ThreadDetail,
  ThreadSummary,
  ZenmailApi,
} from '../shared/types';

const api: ZenmailApi = {
  listAccounts: () => ipcRenderer.invoke('auth:list-accounts'),
  addAccount: () => ipcRenderer.invoke('auth:add-account'),
  signInDemo: () => ipcRenderer.invoke('auth:sign-in-demo'),
  removeAccount: (email: string) => ipcRenderer.invoke('auth:remove-account', email),
  setActiveAccount: (email: string) => ipcRenderer.invoke('auth:set-active-account', email),

  fetchThreads: (accountId: string, req: FetchThreadsRequest) =>
    ipcRenderer.invoke('mail:fetch-threads', accountId, req),
  fetchThread: (accountId: string, threadId: string) =>
    ipcRenderer.invoke('mail:fetch-thread', accountId, threadId),
  fetchLabels: (accountId: string) => ipcRenderer.invoke('mail:fetch-labels', accountId),
  createLabel: (accountId: string, name: string): Promise<Label> =>
    ipcRenderer.invoke('mail:create-label', accountId, name),
  deleteLabel: (accountId: string, labelId: string) => ipcRenderer.invoke('mail:delete-label', accountId, labelId),
  send: (accountId: string, req: SendRequest) => ipcRenderer.invoke('mail:send', accountId, req),
  cancelSend: (accountId: string, sendId: string) => ipcRenderer.invoke('mail:cancel-send', accountId, sendId),
  modifyLabels: (accountId: string, req: ModifyLabelsRequest) =>
    ipcRenderer.invoke('mail:modify-labels', accountId, req),
  snooze: (accountId: string, req: SnoozeRequest) => ipcRenderer.invoke('mail:snooze', accountId, req),
  cancelSnooze: (accountId: string, threadId: string) =>
    ipcRenderer.invoke('mail:cancel-snooze', accountId, threadId),
  searchLocal: (accountId: string, q: string) => ipcRenderer.invoke('mail:search-local', accountId, q),
  listContacts: (accountId: string, prefix: string) => ipcRenderer.invoke('mail:contacts', accountId, prefix),
  getSplits: (accountId: string) => ipcRenderer.invoke('mail:get-splits', accountId),
  setSplits: (accountId: string, defs: SplitDefinition[]) => ipcRenderer.invoke('mail:set-splits', accountId, defs),
  getSetting: (accountId: string, key: string) => ipcRenderer.invoke('mail:get-setting', accountId, key),
  setSetting: (accountId: string, key: string, value: string) =>
    ipcRenderer.invoke('mail:set-setting', accountId, key, value),
  getGlobalSetting: (key: string) => ipcRenderer.invoke('settings:get-global', key),
  setGlobalSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set-global', key, value),

  addFollowup: (accountId: string, threadId: string, remindDays: number) =>
    ipcRenderer.invoke('mail:add-followup', accountId, threadId, remindDays),
  cancelFollowup: (accountId: string, threadId: string) =>
    ipcRenderer.invoke('mail:cancel-followup', accountId, threadId),
  dismissFollowup: (accountId: string, threadId: string) =>
    ipcRenderer.invoke('mail:dismiss-followup', accountId, threadId),
  listFollowups: (accountId: string) => ipcRenderer.invoke('mail:list-followups', accountId),

  listEvents: (accountId: string, timeMinISO: string, timeMaxISO: string) =>
    ipcRenderer.invoke('calendar:list-events', accountId, timeMinISO, timeMaxISO),
  respondToEvent: (accountId: string, iCalUID: string, response: RsvpResponse) =>
    ipcRenderer.invoke('calendar:respond', accountId, iCalUID, response),
  createEvent: (accountId: string, input: CreateEventInput) =>
    ipcRenderer.invoke('calendar:create', accountId, input),

  getAttachmentImage: (accountId: string, messageId: string, attachmentId: string, mimeType: string) =>
    ipcRenderer.invoke('mail:get-attachment-image', accountId, messageId, attachmentId, mimeType),
  downloadAttachment: (accountId: string, messageId: string, attachmentId: string, filename: string) =>
    ipcRenderer.invoke('mail:download-attachment', accountId, messageId, attachmentId, filename),

  notifyOnline: () => ipcRenderer.invoke('mail:renderer-online'),

  onThreadsChanged: (
    cb: (p: { accountId: string; upserts: ThreadSummary[]; removals: string[]; needsRefetch?: boolean }) => void
  ) => {
    const listener = (
      _e: unknown,
      p: { accountId: string; upserts: ThreadSummary[]; removals: string[]; needsRefetch?: boolean }
    ) => cb(p);
    ipcRenderer.on('mail:threads-changed', listener);
    return () => ipcRenderer.removeListener('mail:threads-changed', listener);
  },
  onThreadChanged: (cb: (p: { accountId: string; threadId: string; detail: ThreadDetail }) => void) => {
    const listener = (_e: unknown, p: { accountId: string; threadId: string; detail: ThreadDetail }) => cb(p);
    ipcRenderer.on('mail:thread-changed', listener);
    return () => ipcRenderer.removeListener('mail:thread-changed', listener);
  },
  onSnoozeFired: (cb: (p: { accountId: string; threadId: string }) => void) => {
    const listener = (_e: unknown, p: { accountId: string; threadId: string }) => cb(p);
    ipcRenderer.on('mail:snooze-fired', listener);
    return () => ipcRenderer.removeListener('mail:snooze-fired', listener);
  },
  onFollowupFired: (cb: (p: { accountId: string; threadId: string }) => void) => {
    const listener = (_e: unknown, p: { accountId: string; threadId: string }) => cb(p);
    ipcRenderer.on('mail:followup-fired', listener);
    return () => ipcRenderer.removeListener('mail:followup-fired', listener);
  },
  onSyncState: (cb: (s: { online: boolean; pending: number }) => void) => {
    const listener = (_e: unknown, s: { online: boolean; pending: number }) => cb(s);
    ipcRenderer.on('mail:sync-state', listener);
    return () => ipcRenderer.removeListener('mail:sync-state', listener);
  },
  onMutationPermanentFailed: (cb: (p: { accountId: string; threadId: string | null; kind: string }) => void) => {
    const listener = (_e: unknown, p: { accountId: string; threadId: string | null; kind: string }) => cb(p);
    ipcRenderer.on('mail:mutation-permanent-failed', listener);
    return () => ipcRenderer.removeListener('mail:mutation-permanent-failed', listener);
  },
  onAccountsChanged: (cb: (snap: AccountsSnapshot) => void) => {
    const listener = (_e: unknown, snap: AccountsSnapshot) => cb(snap);
    ipcRenderer.on('auth:accounts-changed', listener);
    return () => ipcRenderer.removeListener('auth:accounts-changed', listener);
  },
};

// E2E-only debug hooks — main이 ZENMAIL_E2E_PORT일 때 additionalArguments로 전달한 플래그로 판별.
if (process.argv.includes('--zenmail-e2e')) {
  api.__debugSimulateReply = (threadId: string) =>
    ipcRenderer.invoke('mail:debug-simulate-reply', threadId);
  api.__debugTick = () => ipcRenderer.invoke('mail:debug-tick');
  api.__debugAddFollowupDueNow = (threadId: string) =>
    ipcRenderer.invoke('mail:debug-add-followup-due-now', threadId);
  api.__debugFailNextModify = () => ipcRenderer.invoke('mail:debug-fail-next-modify');
  api.__debugFailNextModifyForThread = (threadId: string) =>
    ipcRenderer.invoke('mail:debug-fail-next-modify-for-thread', threadId);
  api.__debugSetOnline = (v: boolean) => ipcRenderer.invoke('mail:debug-set-online', v);
  api.__debugQueueDepth = () => ipcRenderer.invoke('mail:debug-queue-depth');
  api.__debugProviderCalls = () => ipcRenderer.invoke('mail:debug-provider-calls');
  api.__debugExternalArchive = (threadId: string) =>
    ipcRenderer.invoke('mail:debug-external-archive', threadId);
  api.__debugExternalUnstar = (threadId: string) =>
    ipcRenderer.invoke('mail:debug-external-unstar', threadId);
  api.__debugCalendarState = () => ipcRenderer.invoke('calendar:debug-state');
  api.__debugFailNextCalendar = () => ipcRenderer.invoke('calendar:debug-fail-next');
  api.__debugSetCalendarReady = (v: boolean) => ipcRenderer.invoke('calendar:debug-set-ready', v);
  api.__debugFailNextAttachment = () => ipcRenderer.invoke('mail:debug-fail-next-attachment');
  api.__debugSetDownloadDir = (dir: string) => ipcRenderer.invoke('mail:debug-set-download-dir', dir);
}

contextBridge.exposeInMainWorld('zenmail', api);
