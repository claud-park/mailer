import { contextBridge, ipcRenderer } from 'electron';
import type {
  FetchThreadsRequest,
  ModifyLabelsRequest,
  SendRequest,
  SnoozeRequest,
  SplitDefinition,
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

  onThreadsUpdated: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('mail:threads-updated', listener);
    return () => ipcRenderer.removeListener('mail:threads-updated', listener);
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
};

// E2E-only debug hooks — main이 ZENMAIL_E2E_PORT일 때 additionalArguments로 전달한 플래그로 판별.
if (process.argv.includes('--zenmail-e2e')) {
  api.__debugSimulateReply = (threadId: string) =>
    ipcRenderer.invoke('mail:debug-simulate-reply', threadId);
  api.__debugTick = () => ipcRenderer.invoke('mail:debug-tick');
  api.__debugAddFollowupDueNow = (threadId: string) =>
    ipcRenderer.invoke('mail:debug-add-followup-due-now', threadId);
}

contextBridge.exposeInMainWorld('zenmail', api);
