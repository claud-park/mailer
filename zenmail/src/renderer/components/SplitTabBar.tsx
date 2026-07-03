import { useMemo } from 'react';
import { useMailStore } from '../store/mail';
import { computeSplits, INBOX_TAB, OTHER_TAB } from '../lib/splits';
import type { SplitDefinition } from '../../shared/types';

function tabLabel(id: string, splitDefs: SplitDefinition[]): string {
  if (id === INBOX_TAB) return 'Inbox';
  if (id === OTHER_TAB) return 'Other';
  return splitDefs.find((d) => d.id === id)?.name ?? id;
}

export function SplitTabBar() {
  const threads = useMailStore((s) => s.threads);
  const splitDefs = useMailStore((s) => s.splitDefs);
  const activeSplitTab = useMailStore((s) => s.activeSplitTab);
  const switchTab = useMailStore((s) => s.switchTab);
  const nextPageToken = useMailStore((s) => s.nextPageToken);

  const { order, counts } = useMemo(() => computeSplits(threads, splitDefs), [threads, splitDefs]);

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-bg-border px-2">
      <div className="flex flex-1 items-center gap-1 overflow-x-auto">
        {order.map((id) => {
          const active = id === activeSplitTab;
          const unread = counts.get(id)?.unread ?? 0;
          const badge = nextPageToken ? `${unread}+` : `${unread}`;
          return (
            <button
              key={id}
              onClick={() => switchTab(id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                active
                  ? 'bg-bg-border text-text-primary'
                  : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary'
              }`}
            >
              {tabLabel(id, splitDefs)}
              {unread > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                    active ? 'bg-accent/20 text-accent' : 'bg-bg-border text-text-muted'
                  }`}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => useMailStore.setState({ splitSettingsOpen: true })}
        title="Configure splits…"
        className="shrink-0 rounded-md px-2 py-1 text-text-secondary hover:bg-bg-subtle hover:text-text-primary"
      >
        ⚙︎
      </button>
    </div>
  );
}
