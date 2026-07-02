import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { partitionThreads, useMailStore } from '../store/mail';
import type { Label, ThreadSummary } from '../../shared/types';

const ROW_HEIGHT = 56;
const HEADER_HEIGHT = 32;
const SWIPE_THRESHOLD = 100;

type Item =
  | { kind: 'header'; title: string }
  | { kind: 'thread'; thread: ThreadSummary; index: number };

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
  labelsById,
}: {
  thread: ThreadSummary;
  selected: boolean;
  labelsById: Map<string, Label>;
}) {
  const openThread = useMailStore((s) => s.openThread);
  const archiveThread = useMailStore((s) => s.archiveThread);
  const openSnoozePicker = useMailStore((s) => s.openSnoozePicker);
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
      } else {
        useMailStore.setState({ selectedIndex: findIndexOf(thread.id) });
        openSnoozePicker(); // swipe left → snooze
      }
      st.total = 0;
      setOffset(0);
    }
  };

  const findIndexOf = (id: string) =>
    useMailStore.getState().threads.findIndex((t) => t.id === id);

  const chips = thread.labelIds
    .map((id) => labelsById.get(id))
    .filter((l): l is Label => !!l && l.type === 'user' && l.visible);

  return (
    <button
      onClick={() => void openThread(thread.id)}
      onWheel={onWheel}
      style={{ transform: offset ? `translateX(${offset}px)` : undefined }}
      className={`flex h-full w-full items-center gap-3 border-b border-bg-border/60 px-4 text-left transition-transform ${
        selected ? 'bg-bg-subtle' : 'hover:bg-bg-subtle/50'
      }`}
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${thread.unread ? 'bg-accent' : 'bg-transparent'}`}
      />
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
            background: `${l.color?.backgroundColor ?? '#2a2a2a'}33`,
            color: l.color?.backgroundColor ?? 'var(--color-text-secondary)',
          }}
        >
          {l.name}
        </span>
      ))}
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
  const searchQuery = useMailStore((s) => s.searchQuery);
  const labels = useMailStore((s) => s.labels);
  const loadMore = useMailStore((s) => s.loadMore);
  const activeThreadId = useMailStore((s) => s.activeThreadId);

  const labelsById = useMemo(() => new Map(labels.map((l) => [l.id, l])), [labels]);

  const items = useMemo<Item[]>(() => {
    const useSplit = splitInbox && activeLabelId === 'INBOX' && !searchQuery;
    if (!useSplit) {
      return threads.map((thread, index) => ({ kind: 'thread' as const, thread, index }));
    }
    const { primary, other } = partitionThreads(threads);
    const out: Item[] = [];
    // indices must match store.threads ordering for j/k selection
    const indexOf = new Map(threads.map((t, i) => [t.id, i]));
    if (primary.length) {
      out.push({ kind: 'header', title: 'Primary' });
      primary.forEach((thread) =>
        out.push({ kind: 'thread', thread, index: indexOf.get(thread.id)! })
      );
    }
    if (other.length) {
      out.push({ kind: 'header', title: 'Other' });
      other.forEach((thread) =>
        out.push({ kind: 'thread', thread, index: indexOf.get(thread.id)! })
      );
    }
    return out;
  }, [threads, splitInbox, activeLabelId, searchQuery]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (items[i].kind === 'header' ? HEADER_HEIGHT : ROW_HEIGHT),
    overscan: 12,
  });

  // keep the keyboard selection in view
  useEffect(() => {
    const itemIdx = items.findIndex((it) => it.kind === 'thread' && it.index === selectedIndex);
    if (itemIdx >= 0) virtualizer.scrollToIndex(itemIdx, { align: 'auto' });
  }, [selectedIndex, items, virtualizer]);

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

  if (!threadsLoading && threads.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-text-muted">
        <div className="text-3xl">🪷</div>
        <div className="text-[13px]">
          {searchQuery ? 'No results' : 'Inbox zero. Enjoy the quiet.'}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={`overflow-y-auto ${activeThreadId ? 'h-2/5 border-b border-bg-border' : 'flex-1'}`}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const item = items[vi.index];
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
              {item.kind === 'header' ? (
                <div className="flex h-full items-end px-4 pb-1 text-[10px] font-semibold tracking-wider text-text-muted uppercase">
                  {item.title}
                </div>
              ) : (
                <ThreadRow
                  thread={item.thread}
                  selected={item.index === selectedIndex}
                  labelsById={labelsById}
                />
              )}
            </div>
          );
        })}
      </div>
      {threadsLoading && (
        <div className="p-3 text-center text-[12px] text-text-muted">Loading…</div>
      )}
    </div>
  );
}
