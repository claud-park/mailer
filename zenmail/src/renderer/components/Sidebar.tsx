import { useEffect, useRef, useState } from 'react';
import { useMailStore, activeAccount } from '../store/mail';
import { useCoachStore } from '../store/coach';
import { SNOOZE_LABEL_NAME, type Label, type AccountInfo } from '../../shared/types';

const SYSTEM_ITEMS: { id: string; name: string }[] = [
  { id: 'INBOX', name: 'Inbox' },
  { id: 'STARRED', name: 'Starred' },
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

function AccountAvatar({ acct, index, active, onClick }: {
  acct: AccountInfo; index: number; active: boolean; onClick: () => void;
}) {
  const initial = (acct.demo ? acct.email.split('@')[0] : acct.email)[0]?.toUpperCase() ?? '?';
  return (
    <button
      onClick={onClick}
      title={`${acct.email} (⌃${index + 1})${acct.needsReauth ? ' — 재로그인 필요' : ''}`}
      aria-label={`Switch to ${acct.email}`}
      className={`relative flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold transition-colors ${
        active ? 'bg-accent text-white' : 'bg-bg-border text-text-secondary hover:text-text-primary'
      }`}
    >
      {acct.needsReauth ? '!' : initial}
      {acct.unreadCount > 0 && !active && (
        <span className="absolute -top-1 -right-1 min-w-[16px] rounded-full bg-accent px-1 text-center text-[9px] leading-4 text-white">
          {acct.unreadCount > 99 ? '99+' : acct.unreadCount}
        </span>
      )}
    </button>
  );
}

/** label-crud D3/D1: confirmation dialog mirroring SnoozePicker's modal-overlay pattern exactly. */
function DeleteLabelDialog({
  label,
  onCancel,
  onConfirm,
}: {
  label: Label;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        ref={panelRef}
        tabIndex={-1}
        className="zen-fade-in w-88 rounded-lg border border-bg-border bg-bg-subtle p-4 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // keep global single-key shortcuts (kbar) from firing behind the modal
          if (e.key === 'Escape') onCancel();
          e.stopPropagation();
        }}
      >
        <div className="px-1 pb-3 text-[13px] text-text-primary">
          '{label.name}' 라벨을 삭제하면 모든 메일에서 제거됩니다
        </div>
        <div className="flex justify-end gap-2 px-1">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-border hover:text-text-primary"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-accent px-3 py-1.5 text-[12px] text-white"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
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
  const accountEmail = useMailStore((s) => activeAccount(s)?.email);
  const accountDemo = useMailStore((s) => activeAccount(s)?.demo);
  const sync = useMailStore((s) => s.sync);
  const accounts = useMailStore((s) => s.accounts);
  const activeAccountId = useMailStore((s) => s.activeAccountId);
  const switchAccount = useMailStore((s) => s.switchAccount);
  const addAccount = useMailStore((s) => s.addAccount);
  const signOutSession = useMailStore((s) => s.signOutSession);
  const createLabel = useMailStore((s) => s.createLabel);
  const deleteLabel = useMailStore((s) => s.deleteLabel);

  const [creatingLabel, setCreatingLabel] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [confirmDeleteLabel, setConfirmDeleteLabel] = useState<Label | null>(null);

  const byId = new Map(labels.map((l) => [l.id, l]));
  const userLabels = labels.filter(
    (l) => l.type === 'user' && l.visible && l.name !== SNOOZE_LABEL_NAME
  );

  return (
    <aside className="relative flex h-full w-52 shrink-0 flex-col border-r border-bg-border bg-bg-subtle/50">
      {/* traffic-light spacer / drag region */}
      <div className="app-drag h-12 shrink-0" />

      {/* 계정 스위처 — drag region 아래 */}
      {accounts.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 pb-2">
          {accounts.map((a, i) => (
            <AccountAvatar
              key={a.email} acct={a} index={i} active={a.email === activeAccountId}
              onClick={() => {
                if (a.needsReauth) void addAccount(); // D4: reauth = OAuth 재실행
                else void switchAccount(a.email);
              }}
            />
          ))}
          <button
            onClick={() => void addAccount()}
            title="Add account"
            aria-label="Add account"
            className="flex h-7 w-7 items-center justify-center rounded-full text-[13px] text-text-muted hover:bg-bg-border hover:text-text-primary"
          >
            +
          </button>
        </div>
      )}

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
            unread={item.id === 'INBOX' || item.id === 'STARRED' ? byId.get(item.id)?.unreadCount : undefined}
          >
            {item.name}
          </SidebarRow>
        ))}

        <div className="mx-2.5 my-2 border-t border-bg-border" />
        <div className="flex items-center justify-between px-2.5 pb-1">
          {creatingLabel ? (
            <input
              autoFocus
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              onKeyDown={(e) => {
                // keep global single-key shortcuts (kbar) from firing behind this input
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const name = newLabelName.trim();
                  if (name) void createLabel(name);
                  setCreatingLabel(false);
                  setNewLabelName('');
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setCreatingLabel(false);
                  setNewLabelName('');
                }
                e.stopPropagation();
              }}
              placeholder="Label name"
              aria-label="New label name"
              className="w-full rounded border border-bg-border bg-bg px-1.5 py-0.5 text-[11px] text-text-primary outline-none"
            />
          ) : (
            <>
              <span className="text-[10px] font-semibold tracking-wider text-text-muted uppercase">
                Labels
              </span>
              <button
                onClick={() => setCreatingLabel(true)}
                aria-label="Add label"
                title="Add label"
                className="rounded px-1 text-[13px] leading-none text-text-muted hover:bg-bg-border hover:text-text-primary"
              >
                +
              </button>
            </>
          )}
        </div>
        {userLabels.map((label) => (
          <div key={label.id} className="group relative">
            <SidebarRow
              active={activeLabelId === label.id}
              onClick={() => setActiveLabel(label.id)}
              unread={label.unreadCount || undefined}
            >
              <LabelDot label={label} />
              <span className="truncate">{label.name}</span>
            </SidebarRow>
            {/* label-crud D3: delete icon hidden by default, hover-reveal only */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmDeleteLabel(label);
              }}
              aria-label={`Delete ${label.name}`}
              title={`Delete ${label.name}`}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded px-1 text-[11px] text-text-muted opacity-0 hover:bg-bg-border hover:text-text-primary group-hover:opacity-100"
            >
              ✕
            </button>
          </div>
        ))}
        {userLabels.length === 0 && (
          <div className="px-2.5 py-1 text-[12px] text-text-muted">No labels</div>
        )}
      </nav>

      {confirmDeleteLabel && (
        <DeleteLabelDialog
          label={confirmDeleteLabel}
          onCancel={() => setConfirmDeleteLabel(null)}
          onConfirm={() => {
            void deleteLabel(confirmDeleteLabel.id);
            setConfirmDeleteLabel(null);
          }}
        />
      )}

      <div className="border-t border-bg-border p-2">
        {sync.pending > 0 && (
          <div className="px-1 pb-1 text-[11px] text-text-muted" aria-live="polite">
            {sync.online ? `Syncing ${sync.pending}…` : `Offline — ${sync.pending} pending`}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="truncate text-[11px] text-text-muted" title={accountEmail}>
            {accountDemo ? 'demo mode' : accountEmail}
          </span>
          <button
            onClick={() => void signOutSession()}
            className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-text-secondary hover:bg-bg-border hover:text-text-primary"
          >
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
