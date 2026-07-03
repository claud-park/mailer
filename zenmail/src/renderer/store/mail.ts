import { create } from 'zustand';
import {
  type AccountInfo,
  type FollowupInfo,
  type Label,
  type SendRequest,
  type SplitDefinition,
  type ThreadDetail,
  type ThreadSummary,
} from '../../shared/types';
import { computeSplits, selectVisibleThreads, INBOX_TAB } from '../lib/splits';

const api = () => window.zenmail;

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

export interface ComposeInit {
  mode: ComposeMode;
  to: string[];
  cc: string[];
  subject: string;
  quotedHtml?: string;
  threadId?: string;
  inReplyTo?: string;
}

export interface PendingSend {
  sendId: string;
  expiresAt: number;
}

interface MailState {
  account: AccountInfo | null;
  accountLoading: boolean;
  authError: string | null;

  labels: Label[];
  threads: ThreadSummary[];
  threadsLoading: boolean;
  nextPageToken?: string;

  activeLabelId: string;
  splitInbox: boolean;
  splitDefs: SplitDefinition[];
  activeSplitTab: string;
  splitSettingsOpen: boolean;
  searchQuery: string;
  searchFocusTick: number;

  activeThreadId: string | null;
  activeThread: ThreadDetail | null;
  threadLoading: boolean;
  selectedIndex: number;

  composeInit: ComposeInit | null;
  snoozePickerOpen: boolean;
  labelPickerOpen: boolean;
  followupPickerOpen: boolean;
  followups: Map<string, FollowupInfo>;
  pendingSend: PendingSend | null;
  toast: string | null;

  init(): Promise<void>;
  signIn(): Promise<void>;
  signInDemo(): Promise<void>;
  signOut(): Promise<void>;

  loadLabels(): Promise<void>;
  loadThreads(): Promise<void>;
  loadMore(): Promise<void>;
  refresh(): Promise<void>;

  setActiveLabel(id: string): void;
  toggleSplit(): void;
  switchTab(id: string): void;
  nextTab(): void;
  prevTab(): void;
  saveSplits(defs: SplitDefinition[]): Promise<void>;
  closeSplitSettings(): void;
  setSearchQuery(q: string): void;
  submitSearch(q: string): void;
  clearSearch(): void;
  focusSearch(): void;

  moveSelection(delta: number): void;
  openSelected(): void;
  openThread(id: string): Promise<void>;
  closeThread(): void;
  nextThread(): void;
  prevThread(): void;

  archiveThread(threadId?: string): Promise<void>;
  trashThread(threadId?: string): Promise<void>;
  markRead(threadId?: string, read?: boolean): Promise<void>;
  applyLabel(labelId: string, threadId?: string): Promise<void>;
  snoozeThread(until: Date, threadId?: string): Promise<void>;

  openCompose(init?: Partial<ComposeInit>): void;
  openReply(all?: boolean): void;
  openForward(): void;
  closeCompose(): void;
  send(req: SendRequest): Promise<void>;
  undoSend(): Promise<void>;

  openSnoozePicker(): void;
  closeSnoozePicker(): void;
  openLabelPicker(): void;
  closeLabelPicker(): void;
  openFollowupPicker(): void;
  closeFollowupPicker(): void;
  refreshFollowups(): Promise<void>;
  scheduleFollowup(days: number, threadId?: string): Promise<void>;
  cancelFollowup(threadId?: string): Promise<void>;
  dismissFollowup(threadId?: string): Promise<void>;
  showToast(msg: string): void;
}

/** true when the split tab bar is the thing driving what's on screen (see ThreadList's `useSplit`) */
function splitViewActive(s: MailState): boolean {
  return s.splitInbox && s.activeLabelId === 'INBOX' && !s.searchQuery;
}

/**
 * fired follow-up thread ids to pin at the top of the list — only while viewing INBOX (any split
 * tab), never during search or a non-INBOX label (see docs/features/follow-up-reminders/DECISIONS.md D8).
 * Derived fresh each call — no store-cached derived state (F1 D6 convention).
 */
function pinnedFollowupIds(s: MailState): Set<string> | undefined {
  if (s.activeLabelId !== 'INBOX' || s.searchQuery) return undefined;
  const ids = new Set<string>();
  for (const f of s.followups.values()) {
    if (f.status === 'fired') ids.add(f.threadId);
  }
  return ids;
}

/** the thread list actually on screen right now — selectedIndex is always an index into this */
function visibleThreads(s: MailState): ThreadSummary[] {
  return selectVisibleThreads(
    s.threads,
    s.splitDefs,
    splitViewActive(s) ? s.activeSplitTab : INBOX_TAB,
    pinnedFollowupIds(s)
  );
}

/** clamp selectedIndex into range after a mutation that may have shrunk/reshuffled the visible list */
function clampSelection(s: MailState): number {
  const len = visibleThreads(s).length;
  return Math.max(0, Math.min(s.selectedIndex, len - 1));
}

/** thread id the current single-thread actions should target */
function targetThreadId(s: MailState, explicit?: string): string | null {
  return explicit ?? s.activeThreadId ?? visibleThreads(s)[s.selectedIndex]?.id ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function quoteHtml(detail: ThreadDetail): string {
  const last = detail.messages[detail.messages.length - 1];
  if (!last) return '';
  const when = new Date(last.date).toLocaleString();
  return `<br><br><div class="gmail_quote">On ${escapeHtml(when)}, ${escapeHtml(
    last.from.name
  )} &lt;${escapeHtml(last.from.email)}&gt; wrote:<blockquote style="border-left:2px solid #2a2a2a;margin:0;padding-left:12px">${
    last.bodyHtml || escapeHtml(last.bodyText)
  }</blockquote></div>`;
}

export const useMailStore = create<MailState>((set, get) => {
  /** loads splitDefs + persisted view state (activeSplitTab/splitInbox); called after account load */
  async function loadSplitState(): Promise<void> {
    try {
      const [splitDefs, splitInboxSetting, activeSplitTabSetting] = await Promise.all([
        api().getSplits(),
        api().getSetting('splitInbox'),
        api().getSetting('activeSplitTab'),
      ]);
      set((s) => {
        const { order } = computeSplits(s.threads, splitDefs);
        const activeSplitTab =
          activeSplitTabSetting && order.includes(activeSplitTabSetting) ? activeSplitTabSetting : INBOX_TAB;
        return {
          splitDefs,
          activeSplitTab,
          splitInbox: splitInboxSetting != null ? splitInboxSetting === '1' : s.splitInbox,
        };
      });
    } catch (err) {
      console.error('loadSplitState failed', err);
    }
  }

  return {
    account: null,
    accountLoading: true,
    authError: null,

    labels: [],
    threads: [],
    threadsLoading: false,
    nextPageToken: undefined,

    activeLabelId: 'INBOX',
    splitInbox: true,
    splitDefs: [],
    activeSplitTab: INBOX_TAB,
    splitSettingsOpen: false,
    searchQuery: '',
    searchFocusTick: 0,

    activeThreadId: null,
    activeThread: null,
    threadLoading: false,
    selectedIndex: 0,

    composeInit: null,
    snoozePickerOpen: false,
    labelPickerOpen: false,
    followupPickerOpen: false,
    followups: new Map(),
    pendingSend: null,
    toast: null,

    async init() {
      api().onFollowupFired((threadId) => {
        const thread = get().threads.find((t) => t.id === threadId);
        get().showToast(
          thread
            ? `No reply yet — "${thread.subject}" is back`
            : 'No reply yet — thread is back in your inbox'
        );
        void get().refreshFollowups();
      });
      try {
        const account = await api().getAccount();
        set({ account, accountLoading: false });
        if (account) {
          await Promise.all([get().loadLabels(), get().loadThreads(), loadSplitState(), get().refreshFollowups()]);
        }
      } catch (err) {
        set({ accountLoading: false, authError: String(err) });
      }
    },

    async signIn() {
      set({ authError: null });
      try {
        const account = await api().signIn();
        set({ account });
        await Promise.all([get().loadLabels(), get().loadThreads(), loadSplitState(), get().refreshFollowups()]);
      } catch (err) {
        set({ authError: err instanceof Error ? err.message : String(err) });
      }
    },

    async signInDemo() {
      const account = await api().signInDemo();
      set({ account, authError: null });
      await Promise.all([get().loadLabels(), get().loadThreads(), loadSplitState(), get().refreshFollowups()]);
    },

    async signOut() {
      await api().signOut();
      set({
        account: null,
        threads: [],
        labels: [],
        activeThreadId: null,
        activeThread: null,
        followups: new Map(),
      });
    },

    async loadLabels() {
      const labels = await api().fetchLabels();
      set({ labels });
    },

    async loadThreads() {
      const { activeLabelId, searchQuery } = get();
      set({ threadsLoading: true });
      try {
        const res = await api().fetchThreads({
          labelIds: searchQuery ? undefined : [activeLabelId],
          q: searchQuery || undefined,
        });
        set((s) => {
          const next = { ...s, threads: res.threads };
          return {
            threads: res.threads,
            nextPageToken: res.nextPageToken,
            threadsLoading: false,
            selectedIndex: clampSelection(next),
          };
        });
      } catch (err) {
        console.error('loadThreads failed', err);
        set({ threadsLoading: false });
      }
    },

    async loadMore() {
      const { nextPageToken, activeLabelId, searchQuery, threadsLoading } = get();
      if (!nextPageToken || threadsLoading) return;
      set({ threadsLoading: true });
      try {
        const res = await api().fetchThreads({
          labelIds: searchQuery ? undefined : [activeLabelId],
          q: searchQuery || undefined,
          pageToken: nextPageToken,
        });
        set((s) => ({
          threads: [...s.threads, ...res.threads],
          nextPageToken: res.nextPageToken,
          threadsLoading: false,
        }));
      } catch {
        set({ threadsLoading: false });
      }
    },

    async refresh() {
      await Promise.all([get().loadThreads(), get().loadLabels()]);
    },

    setActiveLabel(id) {
      set({ activeLabelId: id, searchQuery: '', selectedIndex: 0, activeThreadId: null, activeThread: null });
      void get().loadThreads();
    },

    toggleSplit() {
      set((s) => ({ splitInbox: !s.splitInbox }));
      void api().setSetting('splitInbox', get().splitInbox ? '1' : '0');
    },

    switchTab(id) {
      set({ activeSplitTab: id, selectedIndex: 0 });
      void api().setSetting('activeSplitTab', id);
    },

    nextTab() {
      const s = get();
      const { order } = computeSplits(s.threads, s.splitDefs);
      if (order.length === 0) return;
      const idx = order.indexOf(s.activeSplitTab);
      s.switchTab(order[(idx + 1 + order.length) % order.length]);
    },

    prevTab() {
      const s = get();
      const { order } = computeSplits(s.threads, s.splitDefs);
      if (order.length === 0) return;
      const idx = order.indexOf(s.activeSplitTab);
      s.switchTab(order[(idx - 1 + order.length) % order.length]);
    },

    async saveSplits(defs) {
      set((s) => {
        const { order } = computeSplits(s.threads, defs);
        const activeSplitTab = order.includes(s.activeSplitTab) ? s.activeSplitTab : INBOX_TAB;
        return { splitDefs: defs, activeSplitTab };
      });
      await api().setSplits(defs);
    },

    closeSplitSettings() {
      set({ splitSettingsOpen: false });
    },

    setSearchQuery(q) {
      set({ searchQuery: q });
    },

    submitSearch(q) {
      set({ searchQuery: q, selectedIndex: 0, activeThreadId: null, activeThread: null });
      void get().loadThreads();
    },

    clearSearch() {
      if (!get().searchQuery) return;
      set({ searchQuery: '', selectedIndex: 0 });
      void get().loadThreads();
    },

    focusSearch() {
      set((s) => ({ searchFocusTick: s.searchFocusTick + 1 }));
    },

    moveSelection(delta) {
      set((s) => {
        const max = visibleThreads(s).length - 1;
        if (max < 0) return {};
        const next = Math.max(0, Math.min(max, s.selectedIndex + delta));
        return { selectedIndex: next };
      });
      const s = get();
      if (s.activeThreadId) {
        // when a thread is open, moving selection follows into the reading pane
        const t = visibleThreads(s)[s.selectedIndex];
        if (t && t.id !== s.activeThreadId) void s.openThread(t.id);
      }
    },

    openSelected() {
      const s = get();
      const t = visibleThreads(s)[s.selectedIndex];
      if (t) void s.openThread(t.id);
    },

    async openThread(id) {
      const idx = visibleThreads(get()).findIndex((t) => t.id === id);
      set({
        activeThreadId: id,
        threadLoading: true,
        ...(idx >= 0 ? { selectedIndex: idx } : {}),
      });
      try {
        const detail = await api().fetchThread(id);
        if (get().activeThreadId !== id) return; // stale response
        set({ activeThread: detail, threadLoading: false });
        const summary = get().threads.find((t) => t.id === id);
        if (summary?.unread) void get().markRead(id, true);
      } catch (err) {
        console.error('openThread failed', err);
        set({ threadLoading: false });
      }
    },

    closeThread() {
      set({ activeThreadId: null, activeThread: null });
    },

    nextThread() {
      if (!get().activeThreadId) return;
      get().moveSelection(1);
    },

    prevThread() {
      if (!get().activeThreadId) return;
      get().moveSelection(-1);
    },

    async archiveThread(threadId) {
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      set((st) => {
        const threads = st.threads.filter((t) => t.id !== id);
        const next = { ...st, threads };
        return {
          threads,
          selectedIndex: clampSelection(next),
          ...(st.activeThreadId === id ? { activeThreadId: null, activeThread: null } : {}),
        };
      });
      await api().modifyLabels({ threadId: id, addLabelIds: [], removeLabelIds: ['INBOX'] });
      get().showToast('Archived');
    },

    async trashThread(threadId) {
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      set((st) => {
        const threads = st.threads.filter((t) => t.id !== id);
        const next = { ...st, threads };
        return {
          threads,
          selectedIndex: clampSelection(next),
          ...(st.activeThreadId === id ? { activeThreadId: null, activeThread: null } : {}),
        };
      });
      await api().modifyLabels({ threadId: id, addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] });
      get().showToast('Moved to trash');
    },

    async markRead(threadId, read = true) {
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      set((st) => ({
        threads: st.threads.map((t) =>
          t.id === id
            ? {
                ...t,
                unread: !read,
                labelIds: read ? t.labelIds.filter((l) => l !== 'UNREAD') : [...t.labelIds, 'UNREAD'],
              }
            : t
        ),
      }));
      await api().modifyLabels({
        threadId: id,
        addLabelIds: read ? [] : ['UNREAD'],
        removeLabelIds: read ? ['UNREAD'] : [],
      });
      void get().loadLabels();
    },

    async applyLabel(labelId, threadId) {
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      set({ labelPickerOpen: false });
      set((st) => {
        const threads = st.threads.map((t) =>
          t.id === id && !t.labelIds.includes(labelId)
            ? { ...t, labelIds: [...t.labelIds, labelId] }
            : t
        );
        const next = { ...st, threads };
        return { threads, selectedIndex: clampSelection(next) };
      });
      await api().modifyLabels({ threadId: id, addLabelIds: [labelId], removeLabelIds: [] });
      get().showToast('Label applied');
    },

    async snoozeThread(until, threadId) {
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      set((st) => {
        const threads = st.threads.filter((t) => t.id !== id);
        const next = { ...st, threads };
        return {
          snoozePickerOpen: false,
          threads,
          selectedIndex: clampSelection(next),
          ...(st.activeThreadId === id ? { activeThreadId: null, activeThread: null } : {}),
        };
      });
      await api().snooze({ threadId: id, until: until.toISOString() });
      get().showToast(`Snoozed until ${until.toLocaleString()}`);
    },

    openCompose(init) {
      set({
        composeInit: {
          mode: 'new',
          to: [],
          cc: [],
          subject: '',
          ...init,
        },
      });
    },

    openReply(all = false) {
      const detail = get().activeThread;
      if (!detail) return;
      const last = detail.messages[detail.messages.length - 1];
      if (!last) return;
      const me = get().account?.email;
      const to = [last.from.email];
      const cc = all
        ? [...last.to, ...last.cc].map((c) => c.email).filter((e) => e !== me && e !== last.from.email)
        : [];
      get().openCompose({
        mode: all ? 'replyAll' : 'reply',
        to,
        cc,
        subject: detail.subject.startsWith('Re:') ? detail.subject : `Re: ${detail.subject}`,
        quotedHtml: quoteHtml(detail),
        threadId: detail.id,
        inReplyTo: last.id,
      });
    },

    openForward() {
      const detail = get().activeThread;
      if (!detail) return;
      get().openCompose({
        mode: 'forward',
        to: [],
        subject: detail.subject.startsWith('Fwd:') ? detail.subject : `Fwd: ${detail.subject}`,
        quotedHtml: quoteHtml(detail),
      });
    },

    closeCompose() {
      set({ composeInit: null });
    },

    async send(req) {
      const receipt = await api().send(req);
      set({ composeInit: null });
      if (req.sendAt) {
        get().showToast(`Scheduled for ${new Date(req.sendAt).toLocaleString()}`);
      } else {
        set({ pendingSend: { sendId: receipt.sendId, expiresAt: receipt.sendAt } });
        setTimeout(() => {
          if (get().pendingSend?.sendId === receipt.sendId) set({ pendingSend: null });
          // archive-on-send is applied by the main process after the undo window;
          // the follow-up threads-updated event refreshes the list
        }, receipt.sendAt - Date.now());
      }
    },

    async undoSend() {
      const pending = get().pendingSend;
      if (!pending) return;
      await api().cancelSend(pending.sendId);
      set({ pendingSend: null });
      get().showToast('Send cancelled');
    },

    openSnoozePicker() {
      if (targetThreadId(get())) set({ snoozePickerOpen: true });
    },
    closeSnoozePicker() {
      set({ snoozePickerOpen: false });
    },
    openLabelPicker() {
      if (targetThreadId(get())) set({ labelPickerOpen: true });
    },
    closeLabelPicker() {
      set({ labelPickerOpen: false });
    },
    openFollowupPicker() {
      if (targetThreadId(get())) set({ followupPickerOpen: true });
    },
    closeFollowupPicker() {
      set({ followupPickerOpen: false });
    },

    async refreshFollowups() {
      try {
        const list = await api().listFollowups();
        set({ followups: new Map(list.map((f) => [f.threadId, f])) });
      } catch (err) {
        console.error('refreshFollowups failed', err);
      }
    },

    async scheduleFollowup(days, threadId) {
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      set({ followupPickerOpen: false });
      await api().addFollowup(id, days);
      await get().refreshFollowups();
      get().showToast(`Reminder set — ${days} days`);
    },

    async cancelFollowup(threadId) {
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      set({ followupPickerOpen: false });
      await api().cancelFollowup(id);
      await get().refreshFollowups();
    },

    async dismissFollowup(threadId) {
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      await api().dismissFollowup(id);
      await get().refreshFollowups();
    },

    showToast(msg) {
      set({ toast: msg });
      setTimeout(() => {
        if (get().toast === msg) set({ toast: null });
      }, 2500);
    },
  };
});
