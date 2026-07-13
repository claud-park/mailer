import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMailStore } from '../store/mail';
import { useCoachStore } from '../store/coach';
import { selectVisibleThreads, INBOX_TAB } from '../lib/splits';
import { labelChipFallback } from '../lib/theme';
import { SplitTabBar } from './SplitTabBar';
import { BulkActionBanner } from './BulkActionBanner';
import type { FollowupInfo, Label, SplitDefinition, ThreadSummary } from '../../shared/types';

const ROW_HEIGHT = 56;
const COMPACT_ROW_HEIGHT = 64;
const SWIPE_THRESHOLD = 100;

/** fired follow-up thread ids — see docs/features/follow-up-reminders/DECISIONS.md D8 */
function firedFollowupIds(followups: Map<string, FollowupInfo>): Set<string> {
  const ids = new Set<string>();
  for (const f of followups.values()) {
    if (f.status === 'fired') ids.add(f.threadId);
  }
  return ids;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function ThreadRow({
  thread,
  selected,
  bulkSelected,
  labelsById,
  followup,
  compact,
}: {
  thread: ThreadSummary;
  selected: boolean;
  bulkSelected: boolean;
  labelsById: Map<string, Label>;
  followup?: FollowupInfo;
  compact: boolean;
}) {
  const openThread = useMailStore((s) => s.openThread);
  const archiveThread = useMailStore((s) => s.archiveThread);
  const openSnoozePicker = useMailStore((s) => s.openSnoozePicker);
  const theme = useMailStore((s) => s.theme);
  const [offset, setOffset] = useState(0);
  const swipe = useRef({ total: 0, fired: false, timer: 0 as number | ReturnType<typeof setTimeout> });

  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical scroll
    const st = swipe.current;
    st.total -= e.deltaX;
    setOffset(Math.max(-120, Math.min(120, st.total)));
    clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      st.total = 0;
      st.fired = false;
      setOffset(0);
    }, 250);
    if (!st.fired && Math.abs(st.total) > SWIPE_THRESHOLD) {
      st.fired = true;
      if (st.total > 0) {
        void archiveThread(thread.id); // swipe right → archive
        useCoachStore.getState().recordMouse('archive');
        useCoachStore.getState().maybeHint('archive');
      } else {
        useMailStore.setState({ selectedIndex: findIndexOf(thread.id) });
        openSnoozePicker(); // swipe left → snooze
      }
      st.total = 0;
      setOffset(0);
    }
  };

  // index within the currently visible (tab-filtered) list — matches selectedIndex's meaning
  const findIndexOf = (id: string) => {
    const st = useMailStore.getState();
    const pinned =
      st.activeLabelId === 'INBOX' && !st.searchQuery ? firedFollowupIds(st.followups) : undefined;
    const visible = selectVisibleThreads(
      st.threads,
      st.splitDefs,
      st.splitInbox && st.activeLabelId === 'INBOX' && !st.searchQuery ? st.activeSplitTab : INBOX_TAB,
      pinned
    );
    return visible.findIndex((t) => t.id === id);
  };

  const chips = thread.labelIds
    .map((id) => labelsById.get(id))
    .filter((l): l is Label => !!l && l.type === 'user' && l.visible);

  const dot = bulkSelected ? (
    <span className="flex h-2 w-2 shrink-0 items-center justify-center text-[11px] leading-none text-accent">
      ✓
    </span>
  ) : (
    <span
      className={`h-2 w-2 shrink-0 rounded-full ${thread.unread ? 'bg-accent' : 'bg-transparent'}`}
    />
  );

  if (compact) {
    return (
      <button
        onClick={() => {
          void openThread(thread.id);
          useCoachStore.getState().recordMouse('openThread');
          useCoachStore.getState().maybeHint('openThread');
        }}
        onWheel={onWheel}
        data-thread-id={thread.id}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
        className={`flex h-full w-full flex-col justify-center gap-0.5 border-b border-bg-border/60 px-4 text-left transition-transform ${
          bulkSelected ? 'bg-accent/10' : selected ? 'bg-bg-subtle' : 'hover:bg-bg-subtle/50'
        }`}
      >
        <span className="flex w-full items-center gap-2">
          {dot}
          <span
            className={`min-w-0 flex-1 truncate text-[13px] ${
              thread.unread ? 'font-medium text-text-primary' : 'text-text-secondary'
            }`}
          >
            {thread.from.name || thread.from.email}
            {thread.messageCount > 1 && (
              <span className="ml-1 text-[11px] text-text-muted">{thread.messageCount}</span>
            )}
          </span>
          {followup?.status === 'fired' && (
            <span className="shrink-0 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              No reply
            </span>
          )}
          <span className="shrink-0 text-[11px] text-text-muted">{formatDate(thread.date)}</span>
        </span>
        <span className="flex w-full min-w-0 items-baseline gap-2 pl-4">
          <span
            className={`shrink-0 truncate text-[12px] ${
              thread.unread ? 'font-medium text-text-primary' : 'font-normal text-text-primary/80'
            }`}
            style={{ maxWidth: '60%' }}
          >
            {thread.subject}
          </span>
          <span className="truncate text-[11px] text-text-muted">{thread.snippet}</span>
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={() => {
        void openThread(thread.id);
        useCoachStore.getState().recordMouse('openThread');
        useCoachStore.getState().maybeHint('openThread');
      }}
      onWheel={onWheel}
      data-thread-id={thread.id}
      style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
      className={`flex h-full w-full items-center gap-3 border-b border-bg-border/60 px-4 text-left transition-transform ${
        bulkSelected ? 'bg-accent/10' : selected ? 'bg-bg-subtle' : 'hover:bg-bg-subtle/50'
      }`}
    >
      {dot}
      <span
        className={`w-40 shrink-0 truncate text-[13px] ${
          thread.unread ? 'font-medium text-text-primary' : 'text-text-secondary'
        }`}
      >
        {thread.from.name || thread.from.email}
        {thread.messageCount > 1 && (
          <span className="ml-1 text-[11px] text-text-muted">{thread.messageCount}</span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span
          className={`shrink-0 truncate text-[13px] ${
            thread.unread ? 'font-medium text-text-primary' : 'font-normal text-text-primary/80'
          }`}
          style={{ maxWidth: '50%' }}
        >
          {thread.subject}
        </span>
        <span className="truncate text-[12px] text-text-muted">{thread.snippet}</span>
      </span>
      {chips.slice(0, 3).map((l) => (
        <span
          key={l.id}
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{
            background: `${l.color?.backgroundColor ?? labelChipFallback(theme)}33`,
            color: l.color?.backgroundColor ?? 'var(--color-text-secondary)',
          }}
        >
          {l.name}
        </span>
      ))}
      {followup?.status === 'fired' && (
        <span className="shrink-0 rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
          No reply
        </span>
      )}
      <span className="w-16 shrink-0 text-right text-[11px] text-text-muted">
        {formatDate(thread.date)}
      </span>
    </button>
  );
}

export function ThreadList() {
  const threads = useMailStore((s) => s.threads);
  const threadsLoading = useMailStore((s) => s.threadsLoading);
  const selectedIndex = useMailStore((s) => s.selectedIndex);
  const activeLabelId = useMailStore((s) => s.activeLabelId);
  const splitInbox = useMailStore((s) => s.splitInbox);
  const splitDefs = useMailStore((s) => s.splitDefs);
  const activeSplitTab = useMailStore((s) => s.activeSplitTab);
  const searchQuery = useMailStore((s) => s.searchQuery);
  const labels = useMailStore((s) => s.labels);
  const loadMore = useMailStore((s) => s.loadMore);
  const activeThreadId = useMailStore((s) => s.activeThreadId);
  const followups = useMailStore((s) => s.followups);
  const bulkSelectedIds = useMailStore((s) => s.bulkSelectedIds);

  const useSplit = splitInbox && activeLabelId === 'INBOX' && !searchQuery;

  const labelsById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);

  const visibleThreads = useMemo(() => {
    const pinned = activeLabelId === 'INBOX' && !searchQuery ? firedFollowupIds(followups) : undefined;
    return selectVisibleThreads(threads, splitDefs, useSplit ? activeSplitTab : INBOX_TAB, pinned);
  }, [threads, splitDefs, useSplit, activeSplitTab, activeLabelId, searchQuery, followups]);

  const compact = !!activeThreadId;
  const rowHeight = compact ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visibleThreads.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
  });

  // compact 전환 시 행 높이 재계산 — estimateSize 함수 교체만으로는 기존 측정값이 남는다
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  // keep the keyboard selection in view
  useEffect(() => {
    if (selectedIndex >= 0 && selectedIndex < visibleThreads.length) {
      virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
    }
  }, [selectedIndex, visibleThreads.length, virtualizer]);

  // infinite scroll
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_HEIGHT * 4) void loadMore();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [loadMore]);

  const emptyState = !threadsLoading && threads.length === 0;
  const emptyTab = !threadsLoading && threads.length > 0 && visibleThreads.length === 0;

  return (
    <section
      className={`flex min-h-0 flex-col ${
        activeThreadId ? 'w-2/5 shrink-0 border-r border-bg-border' : 'flex-1'
      }`}
    >
      <BulkActionBanner />
      {useSplit && <SplitTabBar />}
      {emptyState ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-text-muted">
          <div className="text-3xl">🪷</div>
          <div className="text-[13px]">
            {searchQuery ? 'No results' : 'Inbox zero. Enjoy the quiet.'}
          </div>
        </div>
      ) : emptyTab ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-text-muted">
          <div className="text-3xl">✨</div>
          <div className="text-[13px]">
            No {tabName(activeSplitTab, splitDefs)} mail — all clear.
          </div>
        </div>
      ) : (
        <div ref={parentRef} className="flex-1 overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const thread = visibleThreads[vi.index];
              return (
                <div
                  key={vi.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: vi.size,
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <ThreadRow
                    thread={thread}
                    selected={vi.index === selectedIndex}
                    bulkSelected={bulkSelectedIds.has(thread.id)}
                    labelsById={labelsById}
                    followup={followups.get(thread.id)}
                    compact={compact}
                  />
                </div>
              );
            })}
          </div>
          {threadsLoading && (
            <div className="p-3 text-center text-[12px] text-text-muted">Loading…</div>
          )}
        </div>
      )}
    </section>
  );
}

function tabName(id: string, splitDefs: SplitDefinition[]): string {
  return splitDefs.find((d) => d.id === id)?.name ?? 'Other';
}
