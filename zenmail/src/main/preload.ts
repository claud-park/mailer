import { contextBridge, ipcRenderer } from 'electron';
import type {
  CreateEventInput,
  FetchThreadsRequest,
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
  getAccount: () => ipcRenderer.invoke('auth:get-account'),
  signIn: () => ipcRenderer.invoke('auth:sign-in'),
  signInDemo: () => ipcRenderer.invoke('auth:sign-in-demo'),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),

  fetchThreads: (req: FetchThreadsRequest) => ipcRenderer.invoke('mail:fetch-threads', req),
  fetchThread: (threadId: string) => ipcRenderer.invoke('mail:fetch-thread', threadId),
  fetchLabels: () => ipcRenderer.invoke('mail:fetch-labels'),
  send: (req: SendRequest) => ipcRenderer.invoke('mail:send', req),
  cancelSend: (sendId: string) => ipcRenderer.invoke('mail:cancel-send', sendId),
  modifyLabels: (req: ModifyLabelsRequest) => ipcRenderer.invoke('mail:modify-labels', req),
  snooze: (req: SnoozeRequest) => ipcRenderer.invoke('mail:snooze', req),
  searchLocal: (q: string) => ipcRenderer.invoke('mail:search-local', q),
  listContacts: (prefix: string) => ipcRenderer.invoke('mail:contacts', prefix),
  getSplits: () => ipcRenderer.invoke('mail:get-splits'),
  setSplits: (defs: SplitDefinition[]) => ipcRenderer.invoke('mail:set-splits', defs),
  getSetting: (key: string) => ipcRenderer.invoke('mail:get-setting', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('mail:set-setting', key, value),

  addFollowup: (threadId: string, remindDays: number) =>
    ipcRenderer.invoke('mail:add-followup', threadId, remindDays),
  cancelFollowup: (threadId: string) => ipcRenderer.invoke('mail:cancel-followup', threadId),
  dismissFollowup: (threadId: string) => ipcRenderer.invoke('mail:dismiss-followup', threadId),
  listFollowups: () => ipcRenderer.invoke('mail:list-followups'),

  listEvents: (timeMinISO: string, timeMaxISO: string) =>
    ipcRenderer.invoke('calendar:list-events', timeMinISO, timeMaxISO),
  respondToEvent: (iCalUID: string, response: RsvpResponse) =>
    ipcRenderer.invoke('calendar:respond', iCalUID, response),
  createEvent: (input: CreateEventInput) => ipcRenderer.invoke('calendar:create', input),

  notifyOnline: () => ipcRenderer.invoke('mail:renderer-online'),

  onThreadsChanged: (
    cb: (p: { upserts: ThreadSummary[]; removals: string[]; needsRefetch?: boolean }) => void
  ) => {
    const listener = (
      _e: unknown,
      p: { upserts: ThreadSummary[]; removals: string[]; needsRefetch?: boolean }
    ) => cb(p);
    ipcRenderer.on('mail:threads-changed', listener);
    return () => ipcRenderer.removeListener('mail:threads-changed', listener);
  },
  onThreadChanged: (cb: (p: { threadId: string; detail: ThreadDetail }) => void) => {
    const listener = (_e: unknown, p: { threadId: string; detail: ThreadDetail }) => cb(p);
    ipcRenderer.on('mail:thread-changed', listener);
    return () => ipcRenderer.removeListener('mail:thread-changed', listener);
  },
  onSnoozeFired: (cb: (threadId: string) => void) => {
    const listener = (_e: unknown, threadId: string) => cb(threadId);
    ipcRenderer.on('mail:snooze-fired', listener);
    return () => ipcRenderer.removeListener('mail:snooze-fired', listener);
  },
  onFollowupFired: (cb: (threadId: string) => void) => {
    const listener = (_e: unknown, threadId: string) => cb(threadId);
    ipcRenderer.on('mail:followup-fired', listener);
    return () => ipcRenderer.removeListener('mail:followup-fired', listener);
  },
  onSyncState: (cb: (s: { online: boolean; pending: number }) => void) => {
    const listener = (_e: unknown, s: { online: boolean; pending: number }) => cb(s);
    ipcRenderer.on('mail:sync-state', listener);
    return () => ipcRenderer.removeListener('mail:sync-state', listener);
  },
  onMutationPermanentFailed: (cb: (p: { threadId: string | null; kind: string }) => void) => {
    const listener = (_e: unknown, p: { threadId: string | null; kind: string }) => cb(p);
    ipcRenderer.on('mail:mutation-permanent-failed', listener);
    return () => ipcRenderer.removeListener('mail:mutation-permanent-failed', listener);
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
  api.__debugCalendarState = () => ipcRenderer.invoke('calendar:debug-state');
  api.__debugFailNextCalendar = () => ipcRenderer.invoke('calendar:debug-fail-next');
  api.__debugSetCalendarReady = (v: boolean) => ipcRenderer.invoke('calendar:debug-set-ready', v);
}

contextBridge.exposeInMainWorld('zenmail', api);
