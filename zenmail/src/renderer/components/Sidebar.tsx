import { useMailStore } from '../store/mail';
import { useCoachStore } from '../store/coach';
import { SNOOZE_LABEL_NAME, type Label } from '../../shared/types';

const SYSTEM_ITEMS: { id: string; name: string }[] = [
  { id: 'INBOX', name: 'Inbox' },
  { id: 'SENT', name: 'Sent' },
  { id: 'DRAFT', name: 'Drafts' },
];

function LabelDot({ label }: { label: Label }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: label.color?.backgroundColor ?? 'var(--color-text-muted)' }}
    />
  );
}

function SidebarRow({
  active,
  onClick,
  children,
  unread,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  unread?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        active
          ? 'bg-bg-border text-text-primary'
          : 'text-text-secondary hover:bg-bg-subtle hover:text-text-primary'
      }`}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span>
      {unread ? (
        <span className="rounded-full bg-bg-border px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
          {unread}
        </span>
      ) : null}
    </button>
  );
}

export function Sidebar() {
  const labels = useMailStore((s) => s.labels);
  const activeLabelId = useMailStore((s) => s.activeLabelId);
  const setActiveLabel = useMailStore((s) => s.setActiveLabel);
  const account = useMailStore((s) => s.account);
  const signOut = useMailStore((s) => s.signOut);
  const sync = useMailStore((s) => s.sync);

  const byId = new Map(labels.map((l) => [l.id, l]));
  const userLabels = labels.filter(
    (l) => l.type === 'user' && l.visible && l.name !== SNOOZE_LABEL_NAME
  );

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col border-r border-bg-border bg-bg-subtle/50">
      {/* traffic-light spacer / drag region */}
      <div className="app-drag h-12 shrink-0" />
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {SYSTEM_ITEMS.map((item) => (
          <SidebarRow
            key={item.id}
            active={activeLabelId === item.id}
            onClick={() => {
              setActiveLabel(item.id);
              useCoachStore.getState().recordMouse('goToLabel');
              useCoachStore.getState().maybeHint('goToLabel');
            }}
            unread={item.id === 'INBOX' ? byId.get('INBOX')?.unreadCount : undefined}
          >
            {item.name}
          </SidebarRow>
        ))}

        <div className="mx-2.5 my-2 border-t border-bg-border" />
        <div className="px-2.5 pb-1 text-[10px] font-semibold tracking-wider text-text-muted uppercase">
          Labels
        </div>
        {userLabels.map((label) => (
          <SidebarRow
            key={label.id}
            active={activeLabelId === label.id}
            onClick={() => setActiveLabel(label.id)}
            unread={label.unreadCount || undefined}
          >
            <LabelDot label={label} />
            <span className="truncate">{label.name}</span>
          </SidebarRow>
        ))}
        {userLabels.length === 0 && (
          <div className="px-2.5 py-1 text-[12px] text-text-muted">No labels</div>
        )}
      </nav>

      <div className="border-t border-bg-border p-2">
        {sync.pending > 0 && (
          <div className="px-1 pb-1 text-[11px] text-text-muted" aria-live="polite">
            {sync.online ? `Syncing ${sync.pending}…` : `Offline — ${sync.pending} pending`}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="truncate text-[11px] text-text-muted" title={account?.email}>
            {account?.demo ? 'demo mode' : account?.email}
          </span>
          <button
            onClick={() => void signOut()}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-text-secondary hover:bg-bg-border hover:text-text-primary"
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
