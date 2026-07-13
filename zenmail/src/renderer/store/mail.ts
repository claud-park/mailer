import { create } from 'zustand';
import {
  type AccountInfo,
  type FollowupInfo,
  type Label,
  type RsvpResponse,
  type SendRequest,
  type SnippetRecord,
  type SplitDefinition,
  type ThreadDetail,
  type ThreadSummary,
} from '../../shared/types';
import { computeSplits, selectVisibleThreads, INBOX_TAB } from '../lib/splits';
import { captureRemoval, reinsert, removeLabelId, toggleUnread, type RemovalCapture } from '../lib/optimistic';
import { parseSnippets, SNIPPETS_KEY } from '../lib/snippets';
import { detectIntro, type IntroSuggestion } from '../lib/intro';
import { useCoachStore } from './coach';
import { instrument, recordRollback } from './latency';

const api = () => window.zenmail;
const DAY_MS = 86_400_000;
export const CALENDAR_REAUTH_MSG = '캘린더 권한 필요 — 다시 로그인';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

export interface ComposeInit {
  mode: ComposeMode;
  to: string[];
  cc: string[];
  subject: string;
  quotedHtml?: string;
  threadId?: string;
  inReplyTo?: string;
  intro?: IntroSuggestion;
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
  snippetsOpen: boolean;
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
  snippets: SnippetRecord[];
  /** D10: sidebar sync line data — set from useThreads' onSyncState subscription. */
  sync: { online: boolean; pending: number };
  bulkSelectedIds: Set<string>;
  theme: 'light' | 'dark';
  /** iCalUID → 현재 RSVP 응답 상태(낙관 반영). 초대 배너가 읽는다. */
  rsvpStatus: Map<string, RsvpResponse>;

  init(): Promise<void>;
  signIn(): Promise<void>;
  signInDemo(): Promise<void>;
  signOut(): Promise<void>;

  loadLabels(): Promise<void>;
  loadThreads(): Promise<void>;
  loadMore(): Promise<void>;
  refresh(): Promise<void>;
  applyThreadsDiff(upserts: ThreadSummary[], removals: string[]): void;

  setActiveLabel(id: string): void;
  toggleSplit(): void;
  switchTab(id: string): void;
  nextTab(): void;
  prevTab(): void;
  saveSplits(defs: SplitDefinition[]): Promise<void>;
  closeSplitSettings(): void;
  closeSnippets(): void;
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

  archiveThread(threadId?: string, opts?: { silent?: boolean }): Promise<void>;
  trashThread(threadId?: string, opts?: { silent?: boolean }): Promise<void>;
  markRead(threadId?: string, read?: boolean, opts?: { silent?: boolean }): Promise<void>;
  applyLabel(labelId: string, threadId?: string, opts?: { silent?: boolean }): Promise<void>;
  snoozeThread(until: Date, threadId?: string, opts?: { silent?: boolean }): Promise<void>;

  selectAllVisible(): void;
  clearBulkSelection(): void;
  archiveSelected(): Promise<void>;
  trashSelected(): Promise<void>;
  markReadSelected(read: boolean): Promise<void>;
  applyLabelSelected(labelId: string): Promise<void>;
  snoozeSelected(until: Date): Promise<void>;

  setTheme(theme: 'light' | 'dark', opts?: { persist?: boolean }): void;
  toggleTheme(): void;

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
  respondToInvite(iCalUID: string, response: RsvpResponse): Promise<void>;

  loadSnippets(): Promise<void>;
  saveSnippets(list: SnippetRecord[]): Promise<void>;
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
  )} &lt;${escapeHtml(last.from.email)}&gt; wrote:<blockquote style="border-left:2px solid #cccccc;margin:0;padding-left:12px">${
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

  /** Reinserts a captured removal (if any) and records the rollback (F4 CP3, DECISIONS D4). */
  function rollbackRemoval(capture: RemovalCapture | null, action: 'archive' | 'trash' | 'snooze'): void {
    if (capture) {
      set((st) => ({ threads: reinsert(st.threads, capture) }));
    }
    recordRollback(action);
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
    snippetsOpen: false,
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
    snippets: [],
    sync: { online: true, pending: 0 },
    bulkSelectedIds: new Set(),
    theme: 'light',
    rsvpStatus: new Map(),

    async init() {
      // theme boot — 저장값이 dark일 때만 전환, 기본 light (재기록 불필요라 persist:false)
      try {
        if ((await api().getSetting('theme')) === 'dark') get().setTheme('dark', { persist: false });
      } catch {
        /* default light */
      }
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
          await Promise.all([get().loadLabels(), get().loadThreads(), loadSplitState(), get().refreshFollowups(), get().loadSnippets()]);
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
        await Promise.all([get().loadLabels(), get().loadThreads(), loadSplitState(), get().refreshFollowups(), get().loadSnippets()]);
      } catch (err) {
        set({ authError: err instanceof Error ? err.message : String(err) });
      }
    },

    async signInDemo() {
      const account = await api().signInDemo();
      set({ account, authError: null });
      await Promise.all([get().loadLabels(), get().loadThreads(), loadSplitState(), get().refreshFollowups(), get().loadSnippets()]);
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

    /**
     * F6 CP5 (D1): merges a mutation-origin diff push straight into store.threads — never refetches.
     * removals drop the ids. Each upsert is resolved against the *current view label* (main doesn't
     * know the view): present + still in view → replace in place; present + label gone → drop (archive
     * lands here); absent + in view → insert at date-sorted position. Search results are a static
     * snapshot, so diffs are ignored while a search is active. selectedIndex is re-clamped after.
     */
    applyThreadsDiff(upserts, removals) {
      set((st) => {
        if (st.searchQuery) return {}; // search results are a frozen snapshot — ignore live diffs
        const viewLabel = st.activeLabelId || 'INBOX';
        const rm = new Set(removals);
        let threads = st.threads.filter((t) => !rm.has(t.id));
        for (const u of upserts) {
          const exists = threads.some((t) => t.id === u.id);
          const inView = u.labelIds.includes(viewLabel);
          if (exists) {
            threads = inView
              ? threads.map((t) => (t.id === u.id ? u : t))
              : threads.filter((t) => t.id !== u.id);
          } else if (inView) {
            threads = [...threads, u].sort((a, b) => b.date - a.date);
          }
        }
        const next = { ...st, threads };
        return { threads, selectedIndex: clampSelection(next) };
      });
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

    closeSnippets() {
      set({ snippetsOpen: false });
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
      useCoachStore.getState().bumpStat('search');
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
      const doneSelect = instrument('openThread:select');
      const doneContent = instrument('openThread:content');
      const idx = visibleThreads(get()).findIndex((t) => t.id === id);
      set({
        activeThreadId: id,
        threadLoading: true,
        ...(idx >= 0 ? { selectedIndex: idx } : {}),
      });
      doneSelect();
      try {
        const detail = await api().fetchThread(id);
        if (get().activeThreadId !== id) return; // stale response
        set({ activeThread: detail, threadLoading: false });
        doneContent();
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

    async archiveThread(threadId, opts) {
      const done = instrument('archive');
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      const capture = captureRemoval(s.threads, id);
      set((st) => {
        const threads = st.threads.filter((t) => t.id !== id);
        const next = { ...st, threads };
        return {
          threads,
          selectedIndex: clampSelection(next),
          ...(st.activeThreadId === id ? { activeThreadId: null, activeThread: null } : {}),
        };
      });
      done();
      try {
        await api().modifyLabels({ threadId: id, addLabelIds: [], removeLabelIds: ['INBOX'] });
      } catch (err) {
        console.error('archiveThread failed', err);
        rollbackRemoval(capture, 'archive');
        get().showToast('Archive failed — restored');
        void get().refresh();
        return;
      }
      if (!opts?.silent) get().showToast('Archived');
      useCoachStore.getState().bumpStat('archive');
    },

    async trashThread(threadId, opts) {
      const done = instrument('trash');
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      const capture = captureRemoval(s.threads, id);
      set((st) => {
        const threads = st.threads.filter((t) => t.id !== id);
        const next = { ...st, threads };
        return {
          threads,
          selectedIndex: clampSelection(next),
          ...(st.activeThreadId === id ? { activeThreadId: null, activeThread: null } : {}),
        };
      });
      done();
      try {
        await api().modifyLabels({ threadId: id, addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] });
      } catch (err) {
        console.error('trashThread failed', err);
        rollbackRemoval(capture, 'trash');
        get().showToast('Trash failed — restored');
        void get().refresh();
        return;
      }
      if (!opts?.silent) get().showToast('Moved to trash');
      useCoachStore.getState().bumpStat('trash');
    },

    async markRead(threadId, read = true, _opts) {
      const done = instrument('markRead');
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      const prevUnread = s.threads.find((t) => t.id === id)?.unread ?? !read;
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
      done();
      try {
        await api().modifyLabels({
          threadId: id,
          addLabelIds: read ? [] : ['UNREAD'],
          removeLabelIds: read ? ['UNREAD'] : [],
        });
      } catch (err) {
        console.error('markRead failed', err);
        set((st) => ({ threads: toggleUnread(st.threads, id, prevUnread) }));
        recordRollback('markRead');
        get().showToast('Mark as read failed — restored');
        void get().refresh();
        return;
      }
      void get().loadLabels();
    },

    async applyLabel(labelId, threadId, opts) {
      const done = instrument('applyLabel');
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
      done();
      try {
        await api().modifyLabels({ threadId: id, addLabelIds: [labelId], removeLabelIds: [] });
      } catch (err) {
        console.error('applyLabel failed', err);
        set((st) => ({ threads: removeLabelId(st.threads, id, labelId) }));
        recordRollback('applyLabel');
        get().showToast('Apply label failed — restored');
        void get().refresh();
        return;
      }
      if (!opts?.silent) get().showToast('Label applied');
    },

    async snoozeThread(until, threadId, opts) {
      const done = instrument('snooze');
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      const capture = captureRemoval(s.threads, id);
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
      done();
      try {
        await api().snooze({ threadId: id, until: until.toISOString() });
      } catch (err) {
        console.error('snoozeThread failed', err);
        rollbackRemoval(capture, 'snooze');
        get().showToast('Snooze failed — restored');
        void get().refresh();
        return;
      }
      if (!opts?.silent) get().showToast(`Snoozed until ${until.toLocaleString()}`);
      useCoachStore.getState().bumpStat('snooze');
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
        intro: all && me ? detectIntro(detail, me) ?? undefined : undefined,
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
      const done = instrument('send');
      const receipt = await api().send(req);
      set({ composeInit: null });
      done();
      useCoachStore.getState().bumpStat('send');
      if (req.sendAt) {
        get().showToast(`Scheduled for ${new Date(req.sendAt).toLocaleString()}`);
      } else {
        set({ pendingSend: { sendId: receipt.sendId, expiresAt: receipt.sendAt } });
        setTimeout(() => {
          if (get().pendingSend?.sendId === receipt.sendId) set({ pendingSend: null });
          // archive-on-send is applied by the main process after the undo window;
          // the follow-up mail:threads-changed (needsRefetch) event refreshes the list
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
      const done = instrument('followup:add');
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      const previous = s.followups.get(id);
      const optimistic: FollowupInfo = {
        threadId: id,
        status: 'pending',
        dueAt: Date.now() + days * DAY_MS,
      };
      set((st) => {
        const followups = new Map(st.followups);
        followups.set(id, optimistic);
        return { followups, followupPickerOpen: false };
      });
      done();
      try {
        await api().addFollowup(id, days);
        void get().refreshFollowups();
      } catch (err) {
        console.error('scheduleFollowup failed', err);
        set((st) => {
          const followups = new Map(st.followups);
          if (previous) followups.set(id, previous);
          else followups.delete(id);
          return { followups };
        });
        recordRollback('followup:add');
        get().showToast('Reminder failed — restored');
        return;
      }
      get().showToast(`Reminder set — ${days} days`);
      useCoachStore.getState().bumpStat('followup');
    },

    async cancelFollowup(threadId) {
      const done = instrument('followup:cancel');
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      const previous = s.followups.get(id);
      set((st) => {
        const followups = new Map(st.followups);
        followups.delete(id);
        return { followups, followupPickerOpen: false };
      });
      done();
      try {
        await api().cancelFollowup(id);
        void get().refreshFollowups();
      } catch (err) {
        console.error('cancelFollowup failed', err);
        set((st) => {
          const followups = new Map(st.followups);
          if (previous) followups.set(id, previous);
          return { followups };
        });
        recordRollback('followup:cancel');
        get().showToast('Cancel reminder failed — restored');
      }
    },

    async dismissFollowup(threadId) {
      const done = instrument('followup:dismiss');
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      const previous = s.followups.get(id);
      set((st) => {
        const followups = new Map(st.followups);
        followups.delete(id);
        return { followups };
      });
      done();
      try {
        await api().dismissFollowup(id);
        void get().refreshFollowups();
      } catch (err) {
        console.error('dismissFollowup failed', err);
        set((st) => {
          const followups = new Map(st.followups);
          if (previous) followups.set(id, previous);
          return { followups };
        });
        recordRollback('followup:dismiss');
        get().showToast('Dismiss reminder failed — restored');
      }
    },

    showToast(msg) {
      set({ toast: msg });
      setTimeout(() => {
        if (get().toast === msg) set({ toast: null });
      }, 2500);
    },

    async respondToInvite(iCalUID, response) {
      if (!get().account?.calendarReady) {
        get().showToast(CALENDAR_REAUTH_MSG);
        return;
      }
      const done = instrument('rsvp');
      const previous = get().rsvpStatus.get(iCalUID);
      set((st) => {
        const rsvpStatus = new Map(st.rsvpStatus);
        rsvpStatus.set(iCalUID, response);
        return { rsvpStatus };
      });
      done();
      try {
        await api().respondToEvent(iCalUID, response);
      } catch (err) {
        console.error('respondToInvite failed', err);
        set((st) => {
          const rsvpStatus = new Map(st.rsvpStatus);
          if (previous) rsvpStatus.set(iCalUID, previous);
          else rsvpStatus.delete(iCalUID);
          return { rsvpStatus };
        });
        recordRollback('rsvp');
        get().showToast('RSVP failed — restored');
      }
    },

    async loadSnippets() {
      try {
        const raw = await api().getSetting(SNIPPETS_KEY);
        set({ snippets: parseSnippets(raw) });
      } catch (err) {
        console.error('loadSnippets failed', err);
      }
    },

    async saveSnippets(list) {
      set({ snippets: list });
      await api().setSetting(SNIPPETS_KEY, JSON.stringify(list));
    },

    selectAllVisible() {
      set((s) => ({ bulkSelectedIds: new Set(visibleThreads(s).map((t) => t.id)) }));
    },

    clearBulkSelection() {
      set({ bulkSelectedIds: new Set() });
    },

    async archiveSelected() {
      const ids = Array.from(get().bulkSelectedIds);
      if (ids.length === 0) return;
      for (const id of ids) {
        await get().archiveThread(id, { silent: true });
      }
      get().showToast(`${ids.length}개 아카이브됨`);
      get().clearBulkSelection();
    },

    async trashSelected() {
      const ids = Array.from(get().bulkSelectedIds);
      if (ids.length === 0) return;
      for (const id of ids) {
        await get().trashThread(id, { silent: true });
      }
      get().showToast(`${ids.length}개 트래시로 이동`);
      get().clearBulkSelection();
    },

    async markReadSelected(read) {
      const ids = Array.from(get().bulkSelectedIds);
      if (ids.length === 0) return;
      for (const id of ids) {
        await get().markRead(id, read, { silent: true });
      }
      get().showToast(`${ids.length}개 읽음 처리됨`);
      get().clearBulkSelection();
    },

    async applyLabelSelected(labelId) {
      const ids = Array.from(get().bulkSelectedIds);
      if (ids.length === 0) return;
      for (const id of ids) {
        await get().applyLabel(labelId, id, { silent: true });
      }
      get().showToast(`${ids.length}개 라벨 적용됨`);
      get().clearBulkSelection();
    },

    async snoozeSelected(until) {
      const ids = Array.from(get().bulkSelectedIds);
      if (ids.length === 0) return;
      for (const id of ids) {
        await get().snoozeThread(until, id, { silent: true });
      }
      get().showToast(`${ids.length}개 스누즈됨`);
      get().clearBulkSelection();
    },

    setTheme(theme, opts) {
      set({ theme });
      document.documentElement.dataset.theme = theme;
      if (opts?.persist !== false) void api().setSetting('theme', theme);
    },

    toggleTheme() {
      get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
    },
  };
});
