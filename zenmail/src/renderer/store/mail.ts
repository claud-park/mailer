import { create } from 'zustand';
import {
  SNOOZE_LABEL_NAME,
  type AccountInfo,
  type AccountsSnapshot,
  type CalendarEvent,
  type CreateEventInput,
  type FollowupInfo,
  type Label,
  type RsvpResponse,
  type SendRequest,
  type SnippetRecord,
  type SplitDefinition,
  type ThreadDetail,
  type ThreadSummary,
} from '../../shared/types';
import { inLabelView } from '../../shared/view';
import { computeSplits, selectVisibleThreads, INBOX_TAB } from '../lib/splits';
import {
  addLabelId,
  captureRemoval,
  reinsert,
  removeLabelId,
  toggleUnread,
  type RemovalCapture,
} from '../lib/optimistic';
import { parseSnippets, SNIPPETS_KEY } from '../lib/snippets';
import { detectIntro, type IntroSuggestion } from '../lib/intro';
import { useCoachStore } from './coach';
import { instrument, recordRollback } from './latency';

const api = () => window.zenmail;
const DAY_MS = 86_400_000;
export const CALENDAR_REAUTH_MSG = '캘린더 권한 필요 — 다시 로그인';

/** 활성 계정 셀렉터 — 구 `s.account` 참조처의 대체. */
export function activeAccount(s: Pick<MailState, 'accounts' | 'activeAccountId'>): AccountInfo | null {
  return s.accounts.find((a) => a.email === s.activeAccountId) ?? null;
}

/** 데이터 액션 진입 시점의 활성 계정 id — 없으면 로그인 전이므로 액션은 조용히 반환. */
function aid(s: Pick<MailState, 'activeAccountId'>): string | null {
  return s.activeAccountId;
}

/** 계정 종속 슬라이스 리셋 — 전환·제거 공용. threads/선택/상세/스플릿/검색/팔로우업/캘린더/벌크. */
const ACCOUNT_SCOPED_RESET = {
  labels: [] as Label[],
  threads: [] as ThreadSummary[],
  nextPageToken: undefined as string | undefined,
  activeThreadId: null as string | null,
  activeThread: null as ThreadDetail | null,
  threadLoading: false,
  selectedIndex: 0,
  splitDefs: [] as SplitDefinition[],
  activeSplitTab: INBOX_TAB,
  searchQuery: '',
  bulkSelectedIds: new Set<string>(),
  followups: new Map<string, FollowupInfo>(),
  rsvpStatus: new Map<string, RsvpResponse>(),
  snippets: [] as SnippetRecord[],
  agendaOpen: false,
  agendaEvents: [] as CalendarEvent[],
  agendaLoading: false,
  agendaError: null as string | null,
  composeInit: null as ComposeInit | null,
  snoozePickerOpen: false,
  labelPickerOpen: false,
  followupPickerOpen: false,
  eventComposerOpen: false,
  splitSettingsOpen: false,
  snippetsOpen: false,
};

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
  /** D5: 열린 시점의 활성 계정 — 전환 후 발신해도 이 계정으로 나간다. */
  accountId: string;
}

export interface PendingSend {
  sendId: string;
  /** D5: 발신 계정 — undo는 이 계정으로 cancelSend. */
  accountId: string;
  expiresAt: number;
}

interface MailState {
  accounts: AccountInfo[];
  activeAccountId: string | null;
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
  agendaOpen: boolean;
  agendaEvents: CalendarEvent[];
  agendaLoading: boolean;
  agendaError: string | null;
  eventComposerOpen: boolean;

  init(): Promise<void>;
  addAccount(): Promise<void>; // 구 signIn 대체 (Login 버튼·계정 추가 공용)
  signInDemo(): Promise<void>;
  removeAccount(email: string): Promise<void>; // 구 signOut 대체
  signOutSession(): Promise<void>; // 사이드바 "Sign out" — demo=세션 전체, real=활성 계정만(D8)
  switchAccount(email: string): Promise<void>;
  applyAccountsSnapshot(snap: AccountsSnapshot): void;

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
  toggleStar(threadId?: string): Promise<void>;
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
  fetchAttachmentImage(
    messageId: string,
    attachmentId: string,
    mimeType: string
  ): Promise<{ dataUri: string; mimeType: string } | { error: string }>;
  respondToInvite(iCalUID: string, response: RsvpResponse): Promise<void>;
  openAgenda(): Promise<void>;
  closeAgenda(): void;
  openEventComposer(): void;
  closeEventComposer(): void;
  createCalendarEvent(input: CreateEventInput): Promise<boolean>;

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

/** the loaded label whose name matches SNOOZE_LABEL_NAME, or null if unknown yet (inbox-zero-starred D6) */
function snoozeLabelIdOf(s: MailState): string | null {
  return s.labels.find((l) => l.name === SNOOZE_LABEL_NAME)?.id ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** openAgenda fetch 세대 카운터 — 닫기/재열기 시 in-flight 응답 무효화 (스토어 state 아님). */
let agendaFetchSeq = 0;

/** 아젠다 범위: 오늘 00:00 ~ 내일 24:00(모레 00:00). */
function agendaRange(): { timeMinISO: string; timeMaxISO: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * DAY_MS);
  return { timeMinISO: start.toISOString(), timeMaxISO: end.toISOString() };
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
    const a = aid(get());
    if (!a) return;
    try {
      const [splitDefs, splitInboxSetting, activeSplitTabSetting] = await Promise.all([
        api().getSplits(a),
        api().getSetting(a, 'splitInbox'),
        api().getSetting(a, 'activeSplitTab'),
      ]);
      if (get().activeAccountId !== a) return; // 전환 중 이전 계정 응답의 late-arrival 차단
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

  /** 활성 계정의 전 슬라이스 로드 — 전환·초기화·계정 추가 공용. 첫 페인트는 계정별 캐시에서 즉시. */
  async function loadActiveAccountData(): Promise<void> {
    await Promise.all([
      get().loadLabels(),
      get().loadThreads(),
      loadSplitState(),
      get().refreshFollowups(),
      get().loadSnippets(),
    ]);
  }

  /** Reinserts a captured removal (if any) and records the rollback (F4 CP3, DECISIONS D4). */
  function rollbackRemoval(capture: RemovalCapture | null, action: 'archive' | 'trash' | 'snooze' | 'star'): void {
    if (capture) {
      set((st) => ({ threads: reinsert(st.threads, capture) }));
    }
    recordRollback(action);
  }

  return {
    accounts: [],
    activeAccountId: null,
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
    agendaOpen: false,
    agendaEvents: [],
    agendaLoading: false,
    agendaError: null,
    eventComposerOpen: false,

    async init() {
      // theme boot — 저장값이 dark일 때만 전환, 기본 light (재기록 불필요라 persist:false). 전역 설정.
      try {
        if ((await api().getGlobalSetting('theme')) === 'dark') get().setTheme('dark', { persist: false });
      } catch {
        /* default light */
      }
      api().onFollowupFired((p) => {
        if (p.accountId !== get().activeAccountId) return; // 비활성 계정 발화는 배지(accounts-changed)로만
        const thread = get().threads.find((t) => t.id === p.threadId);
        get().showToast(
          thread
            ? `No reply yet — "${thread.subject}" is back`
            : 'No reply yet — thread is back in your inbox'
        );
        void get().refreshFollowups();
      });
      try {
        const snap = await api().listAccounts();
        set({ accounts: snap.accounts, activeAccountId: snap.activeEmail, accountLoading: false });
        if (snap.activeEmail) await loadActiveAccountData();
      } catch (err) {
        set({ accountLoading: false, authError: String(err) });
      }
    },

    applyAccountsSnapshot(snap) {
      set((st) => ({
        accounts: snap.accounts,
        // 활성 계정이 제거된 스냅샷이면 main이 정한 activeEmail로 따라간다(switchAccount가 후속 로드)
        activeAccountId: snap.accounts.some((a) => a.email === st.activeAccountId)
          ? st.activeAccountId
          : snap.activeEmail,
      }));
    },

    async addAccount() {
      set({ authError: null });
      try {
        const snap = await api().addAccount();
        get().applyAccountsSnapshot(snap);
        // 첫 로그인(이전에 계정 0)이면 새 계정으로 진입
        if (!get().activeAccountId && snap.activeEmail) {
          set({ activeAccountId: snap.activeEmail });
        }
        if (get().activeAccountId) await loadActiveAccountData();
      } catch (err) {
        set({ authError: err instanceof Error ? err.message : String(err) });
      }
    },

    async signInDemo() {
      const snap = await api().signInDemo();
      set({ accounts: snap.accounts, activeAccountId: snap.activeEmail, authError: null });
      await loadActiveAccountData();
    },

    async switchAccount(email) {
      const s = get();
      if (email === s.activeAccountId || !s.accounts.some((a) => a.email === email)) return;
      set({ activeAccountId: email, ...ACCOUNT_SCOPED_RESET });
      void api().setActiveAccount(email);
      await loadActiveAccountData(); // 계정별 캐시 SWR — 첫 페인트는 로컬에서 즉시
    },

    async removeAccount(email) {
      const snap = await api().removeAccount(email);
      if (snap.accounts.length === 0) {
        set({ accounts: [], activeAccountId: null, ...ACCOUNT_SCOPED_RESET });
        return;
      }
      const wasActive = get().activeAccountId === email;
      set({ accounts: snap.accounts });
      if (wasActive) {
        set({ activeAccountId: snap.activeEmail, ...ACCOUNT_SCOPED_RESET });
        await loadActiveAccountData();
      }
    },

    // 사이드바 "Sign out" = 세션 종료(D8). demo는 세션이 한 단위이므로 상주 mock 계정
    // 전부를 종료해야 로그인 화면에 닿는다 — real은 활성 계정 하나만 제거(레거시 단일
    // 계정 signOut의 파괴적 시맨틱을 계정 단위로 승계). per-account 제거는 kbar
    // "Sign out of <email>"(removeAccount 직접 호출)이 담당한다.
    async signOutSession() {
      const active = activeAccount(get());
      if (!active) return;
      if (active.demo) {
        const demoEmails = get().accounts.filter((a) => a.demo).map((a) => a.email);
        for (const email of demoEmails) {
          await get().removeAccount(email);
        }
      } else {
        await get().removeAccount(active.email);
      }
    },

    async loadLabels() {
      const a = aid(get());
      if (!a) return;
      const labels = await api().fetchLabels(a);
      if (get().activeAccountId !== a) return; // 전환 중 이전 계정 응답의 late-arrival 차단
      set({ labels });
    },

    async loadThreads() {
      const a = aid(get());
      if (!a) return;
      const { activeLabelId, searchQuery } = get();
      set({ threadsLoading: true });
      try {
        const res = await api().fetchThreads(a, {
          labelIds: searchQuery ? undefined : [activeLabelId],
          q: searchQuery || undefined,
        });
        if (get().activeAccountId !== a) return; // 전환 중 이전 계정 응답의 late-arrival 차단
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
        if (get().activeAccountId !== a) return; // 전환 후 도착한 실패가 새 계정 로딩 상태를 건드리지 않게
        set({ threadsLoading: false });
      }
    },

    async loadMore() {
      const a = aid(get());
      const { nextPageToken, activeLabelId, searchQuery, threadsLoading } = get();
      if (!a || !nextPageToken || threadsLoading) return;
      set({ threadsLoading: true });
      try {
        const res = await api().fetchThreads(a, {
          labelIds: searchQuery ? undefined : [activeLabelId],
          q: searchQuery || undefined,
          pageToken: nextPageToken,
        });
        if (get().activeAccountId !== a) return; // 전환 중 이전 계정 응답의 late-arrival 차단
        set((s) => ({
          threads: [...s.threads, ...res.threads],
          nextPageToken: res.nextPageToken,
          threadsLoading: false,
        }));
      } catch {
        if (get().activeAccountId !== a) return; // 전환 후 도착한 실패가 새 계정 로딩 상태를 건드리지 않게
        set({ threadsLoading: false });
      }
    },

    async refresh() {
      await Promise.all([get().loadThreads(), get().loadLabels()]);
    },

    /**
     * F6 CP5 (D1): merges a mutation-origin diff push straight into store.threads — never refetches.
     * removals drop the ids. Each upsert is resolved against the *current view label* (main doesn't
     * know the view) via the shared inLabelView predicate: present + still in view → replace in place;
     * present + view membership lost → drop (archive lands here, unless the thread is starred — see
     * archiveThread's D5 branch); absent + in view → insert at date-sorted position. For the INBOX view,
     * "in view" is the shared predicate INBOX∪STARRED−TRASH/SPAM−snoozed (DECISIONS D1/D5), not a plain
     * label include — a starred-but-archived upsert stays. Search results are a static snapshot, so
     * diffs are ignored while a search is active. selectedIndex is re-clamped after.
     */
    applyThreadsDiff(upserts, removals) {
      set((st) => {
        if (st.searchQuery) return {}; // search results are a frozen snapshot — ignore live diffs
        const viewLabel = st.activeLabelId || 'INBOX';
        const snoozeLabelId = snoozeLabelIdOf(st);
        const rm = new Set(removals);
        let threads = st.threads.filter((t) => !rm.has(t.id));
        for (const u of upserts) {
          const exists = threads.some((t) => t.id === u.id);
          const inView = inLabelView(u.labelIds, viewLabel, snoozeLabelId);
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
      const a = aid(get());
      if (a) void api().setSetting(a, 'splitInbox', get().splitInbox ? '1' : '0');
    },

    switchTab(id) {
      set({ activeSplitTab: id, selectedIndex: 0 });
      const a = aid(get());
      if (a) void api().setSetting(a, 'activeSplitTab', id);
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
      const a = aid(get());
      if (a) await api().setSplits(a, defs);
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
      const a = aid(get());
      if (!a) return;
      try {
        const detail = await api().fetchThread(a, id);
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
      const a = aid(s);
      if (!a) return;

      // D5: a starred thread stays visible after archive (INBOX∪STARRED predicate) — update the
      // row in place instead of removing it, but only while the INBOX view (no search) is on screen.
      const thread = s.threads.find((t) => t.id === id);
      const nextLabels = thread ? thread.labelIds.filter((l) => l !== 'INBOX') : null;
      const keepInPlace =
        nextLabels !== null &&
        inLabelView(nextLabels, 'INBOX', snoozeLabelIdOf(s)) &&
        (s.activeLabelId === 'INBOX' || !s.activeLabelId) &&
        !s.searchQuery;

      if (keepInPlace) {
        set((st) => ({ threads: st.threads.map((t) => (t.id === id ? { ...t, labelIds: nextLabels! } : t)) }));
        done();
        try {
          await api().modifyLabels(a, { threadId: id, addLabelIds: [], removeLabelIds: ['INBOX'] });
        } catch (err) {
          console.error('archiveThread failed', err);
          set((st) => ({ threads: addLabelId(st.threads, id, 'INBOX') }));
          recordRollback('archive');
          get().showToast('Archive failed — restored');
          void get().refresh();
          return;
        }
        if (!opts?.silent) get().showToast('Archived');
        useCoachStore.getState().bumpStat('archive');
        return;
      }

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
        await api().modifyLabels(a, { threadId: id, addLabelIds: [], removeLabelIds: ['INBOX'] });
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
      const a = aid(s);
      if (!a) return;
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
        await api().modifyLabels(a, { threadId: id, addLabelIds: ['TRASH'], removeLabelIds: ['INBOX'] });
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

    /**
     * D7: minimal star toggle. Starring always updates in place. Unstarring drops the row only when
     * it would fall out of the INBOX view predicate (archived-starred in the INBOX view, D5's mirror
     * on the way out) — everywhere else (search, non-INBOX view, or still-in-INBOX) it's in-place too.
     */
    async toggleStar(threadId) {
      const done = instrument('star');
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      const a = aid(s);
      if (!a) return;
      const thread = s.threads.find((t) => t.id === id);
      if (!thread) return;
      const isStarred = thread.labelIds.includes('STARRED');

      const setActiveLabels = (st: MailState, labelIds: string[]) =>
        st.activeThreadId === id && st.activeThread
          ? { activeThread: { ...st.activeThread, labelIds } }
          : {};

      if (!isStarred) {
        set((st) => ({
          threads: addLabelId(st.threads, id, 'STARRED'),
          ...setActiveLabels(st, [...thread.labelIds, 'STARRED']),
        }));
        done();
        try {
          await api().modifyLabels(a, { threadId: id, addLabelIds: ['STARRED'], removeLabelIds: [] });
        } catch (err) {
          console.error('toggleStar failed', err);
          set((st) => ({
            threads: removeLabelId(st.threads, id, 'STARRED'),
            ...setActiveLabels(st, thread.labelIds),
          }));
          recordRollback('star');
          get().showToast('Star failed — restored');
          void get().refresh();
          return;
        }
        get().showToast('Starred');
        return;
      }

      const nextLabels = thread.labelIds.filter((l) => l !== 'STARRED');
      const viewLabel = s.activeLabelId || 'INBOX';
      const keepInPlace =
        !!s.searchQuery || viewLabel !== 'INBOX' || inLabelView(nextLabels, 'INBOX', snoozeLabelIdOf(s));

      if (keepInPlace) {
        set((st) => ({
          threads: removeLabelId(st.threads, id, 'STARRED'),
          ...setActiveLabels(st, nextLabels),
        }));
        done();
        try {
          await api().modifyLabels(a, { threadId: id, addLabelIds: [], removeLabelIds: ['STARRED'] });
        } catch (err) {
          console.error('toggleStar failed', err);
          set((st) => ({
            threads: addLabelId(st.threads, id, 'STARRED'),
            ...setActiveLabels(st, thread.labelIds),
          }));
          recordRollback('star');
          get().showToast('Unstar failed — restored');
          void get().refresh();
          return;
        }
        get().showToast('Unstarred');
        return;
      }

      // archived-starred thread leaving the INBOX view on unstar (D5 mirror)
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
        await api().modifyLabels(a, { threadId: id, addLabelIds: [], removeLabelIds: ['STARRED'] });
      } catch (err) {
        console.error('toggleStar failed', err);
        rollbackRemoval(capture, 'star');
        get().showToast('Unstar failed — restored');
        void get().refresh();
        return;
      }
      get().showToast('Unstarred');
    },

    async markRead(threadId, read = true, _opts) {
      const done = instrument('markRead');
      const s = get();
      const id = targetThreadId(s, threadId);
      if (!id) return;
      const a = aid(s);
      if (!a) return;
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
        await api().modifyLabels(a, {
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
      const a = aid(s);
      if (!a) return;
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
        await api().modifyLabels(a, { threadId: id, addLabelIds: [labelId], removeLabelIds: [] });
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
      const a = aid(s);
      if (!a) return;
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
        await api().snooze(a, { threadId: id, until: until.toISOString() });
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
      const accountId = get().activeAccountId;
      if (!accountId) return; // 로그인 전이면 작성 불가
      set({
        composeInit: {
          mode: 'new',
          to: [],
          cc: [],
          subject: '',
          accountId, // D5: 열림 시점 계정 캡처
          ...init,
        },
      });
    },

    openReply(all = false) {
      const detail = get().activeThread;
      if (!detail) return;
      const last = detail.messages[detail.messages.length - 1];
      if (!last) return;
      const me = activeAccount(get())?.email;
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
      // D5: 열림 시점의 계정으로 발신 — 전환 후 눌러도 원래 계정으로 나간다.
      const a = get().composeInit?.accountId ?? aid(get());
      if (!a) return;
      const receipt = await api().send(a, req);
      set({ composeInit: null });
      done();
      useCoachStore.getState().bumpStat('send');
      if (req.sendAt) {
        get().showToast(`Scheduled for ${new Date(req.sendAt).toLocaleString()}`);
      } else {
        set({ pendingSend: { sendId: receipt.sendId, accountId: a, expiresAt: receipt.sendAt } });
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
      await api().cancelSend(pending.accountId, pending.sendId);
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
      const a = aid(get());
      if (!a) return;
      try {
        const list = await api().listFollowups(a);
        if (get().activeAccountId !== a) return; // 전환 중 이전 계정 응답의 late-arrival 차단
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
      const a = aid(s);
      if (!a) return;
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
        await api().addFollowup(a, id, days);
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
      const a = aid(s);
      if (!a) return;
      const previous = s.followups.get(id);
      set((st) => {
        const followups = new Map(st.followups);
        followups.delete(id);
        return { followups, followupPickerOpen: false };
      });
      done();
      try {
        await api().cancelFollowup(a, id);
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
      const a = aid(s);
      if (!a) return;
      const previous = s.followups.get(id);
      set((st) => {
        const followups = new Map(st.followups);
        followups.delete(id);
        return { followups };
      });
      done();
      try {
        await api().dismissFollowup(a, id);
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

    async fetchAttachmentImage(messageId, attachmentId, mimeType) {
      const a = aid(get());
      if (!a) return { error: 'no account' };
      try {
        // IPC 핸들러가 실패를 {error}로 흡수하지만, needsReauth 등 throw 경로도 방어한다.
        return await api().getAttachmentImage(a, messageId, attachmentId, mimeType);
      } catch (err) {
        console.error('getAttachmentImage failed', err);
        return { error: String(err) };
      }
    },

    async respondToInvite(iCalUID, response) {
      const a = aid(get());
      if (!a || !activeAccount(get())?.calendarReady) {
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
        await api().respondToEvent(a, iCalUID, response);
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

    async openAgenda() {
      const a = aid(get());
      if (!a || !activeAccount(get())?.calendarReady) {
        get().showToast(CALENDAR_REAUTH_MSG);
        return;
      }
      const seq = ++agendaFetchSeq;
      set({ agendaOpen: true, agendaLoading: true, agendaError: null, agendaEvents: [] });
      const { timeMinISO, timeMaxISO } = agendaRange();
      try {
        const events = await api().listEvents(a, timeMinISO, timeMaxISO);
        if (seq !== agendaFetchSeq || !get().agendaOpen) return; // 닫힘/재열기 뒤 도착한 응답 무시
        set({ agendaEvents: events, agendaLoading: false });
      } catch (err) {
        console.error('listEvents failed', err);
        if (seq !== agendaFetchSeq || !get().agendaOpen) return;
        set({ agendaError: '일정을 불러오지 못했어요', agendaLoading: false });
      }
    },

    closeAgenda() {
      agendaFetchSeq++; // in-flight fetch 무효화
      set({ agendaOpen: false });
    },

    openEventComposer() {
      const s = get();
      if (!s.activeThread) return; // 프리필 소스(activeThread)와 가드 일치 — 열려 있는 메일이 전제
      if (!activeAccount(s)?.calendarReady) {
        s.showToast(CALENDAR_REAUTH_MSG);
        return;
      }
      set({ eventComposerOpen: true });
    },

    closeEventComposer() {
      set({ eventComposerOpen: false });
    },

    async createCalendarEvent(input) {
      const a = aid(get());
      if (!a || !activeAccount(get())?.calendarReady) {
        get().showToast(CALENDAR_REAUTH_MSG);
        return false;
      }
      try {
        await api().createEvent(a, input);
      } catch (err) {
        console.error('createEvent failed', err);
        get().showToast('이벤트 생성 실패');
        return false; // 폼은 열린 채 유지(입력 보존)
      }
      set({ eventComposerOpen: false });
      get().showToast('이벤트가 생성됐어요');
      return true;
    },

    async loadSnippets() {
      const a = aid(get());
      if (!a) return;
      try {
        const raw = await api().getSetting(a, SNIPPETS_KEY);
        if (get().activeAccountId !== a) return; // 전환 중 이전 계정 응답의 late-arrival 차단
        set({ snippets: parseSnippets(raw) });
      } catch (err) {
        console.error('loadSnippets failed', err);
      }
    },

    async saveSnippets(list) {
      set({ snippets: list });
      const a = aid(get());
      if (a) await api().setSetting(a, SNIPPETS_KEY, JSON.stringify(list));
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
      if (opts?.persist !== false) void api().setGlobalSetting('theme', theme);
    },

    toggleTheme() {
      get().setTheme(get().theme === 'dark' ? 'light' : 'dark');
    },
  };
});
