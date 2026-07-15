import { useMemo } from 'react';
import {
  KBarProvider,
  KBarPortal,
  KBarPositioner,
  KBarAnimator,
  KBarSearch,
  KBarResults,
  useMatches,
  useRegisterActions,
  type Action,
} from 'kbar';
import { useMailStore } from '../store/mail';
import { useCoachStore } from '../store/coach';

/** 계정 목록은 런타임 가변 — 정적 actions 배열 대신 useRegisterActions로 등록/갱신 */
function AccountActions() {
  const accounts = useMailStore((s) => s.accounts);
  const activeAccountId = useMailStore((s) => s.activeAccountId);
  const actions = useMemo<Action[]>(() => {
    const s = useMailStore.getState;
    return [
      ...accounts.map((a) => ({
        id: `switchAccount:${a.email}`,
        name: `Switch to ${a.email}${a.email === activeAccountId ? ' (current)' : ''}`,
        section: 'Accounts',
        // 단축키는 useKeyboard 소유(⌃N) — kbar shortcut 등록 금지(이중발화)
        perform: () => {
          if (a.needsReauth) void s().addAccount();
          else void s().switchAccount(a.email);
        },
      })),
      { id: 'addAccount', name: 'Add account…', section: 'Accounts', perform: () => void s().addAccount() },
      ...(activeAccountId
        ? [{
            id: 'removeAccount',
            name: `Sign out of ${activeAccountId}`,
            section: 'Accounts',
            perform: () => void s().removeAccount(activeAccountId),
          }]
        : []),
    ];
  }, [accounts, activeAccountId]);
  useRegisterActions(actions, [actions]);
  return null;
}

function RenderResults() {
  const { results } = useMatches();
  return (
    <KBarResults
      items={results}
      onRender={({ item, active }) =>
        typeof item === 'string' ? (
          <div className="px-4 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-text-muted uppercase">
            {item}
          </div>
        ) : (
          <div
            className={`flex cursor-pointer items-center justify-between px-4 py-2 text-[13px] ${
              active ? 'bg-bg-border text-text-primary' : 'text-text-secondary'
            }`}
          >
            <span>{item.name}</span>
            {item.shortcut?.length ? (
              <span className="flex gap-1">
                {item.shortcut.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-bg-border bg-bg px-1.5 py-0.5 font-sans text-[10px] text-text-muted"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            ) : null}
          </div>
        )
      }
    />
  );
}

export function CommandPalette({ children }: { children: React.ReactNode }) {
  // zustand actions are referentially stable, so this memo holds for the app's life
  const actions = useMemo<Action[]>(() => {
    const s = useMailStore.getState;
    return [
      { id: 'compose', name: 'Compose', shortcut: ['c'], section: 'Actions', perform: () => s().openCompose() },
      {
        id: 'archive',
        name: 'Archive',
        shortcut: ['e'],
        section: 'Actions',
        perform: () => {
          const st = s();
          if (st.bulkSelectedIds.size > 0) void st.archiveSelected();
          else void st.archiveThread();
        },
      },
      { id: 'reply', name: 'Reply', shortcut: ['r'], section: 'Actions', perform: () => s().openReply(false) },
      { id: 'replyAll', name: 'Reply all', shortcut: ['a'], section: 'Actions', perform: () => s().openReply(true) },
      { id: 'forward', name: 'Forward', shortcut: ['f'], section: 'Actions', perform: () => s().openForward() },
      { id: 'label', name: 'Apply label…', shortcut: ['l'], section: 'Actions', perform: () => s().openLabelPicker() },
      { id: 'snooze', name: 'Snooze…', shortcut: ['b'], section: 'Actions', perform: () => s().openSnoozePicker() },
      { id: 'remindMe', name: 'Remind me…', shortcut: ['h'], section: 'Actions', perform: () => s().openFollowupPicker() },
      { id: 'createEvent', name: 'Create event from email', section: 'Actions', perform: () => s().openEventComposer() },
      {
        id: 'trash',
        name: 'Move to trash',
        shortcut: ['#'],
        section: 'Actions',
        perform: () => {
          const st = s();
          if (st.bulkSelectedIds.size > 0) void st.trashSelected();
          else void st.trashThread();
        },
      },
      {
        id: 'star',
        name: 'Star / Unstar',
        shortcut: ['s'],
        section: 'Actions',
        perform: () => void s().toggleStar(),
      },
      {
        id: 'markRead',
        name: 'Mark as read',
        shortcut: ['I'],
        section: 'Actions',
        perform: () => {
          const st = s();
          if (st.bulkSelectedIds.size > 0) void st.markReadSelected(true);
          else void st.markRead(undefined, true);
        },
      },
      {
        id: 'markUnread',
        name: 'Mark as unread',
        shortcut: ['U'],
        section: 'Actions',
        perform: () => {
          const st = s();
          if (st.bulkSelectedIds.size > 0) void st.markReadSelected(false);
          else void st.markRead(undefined, false);
        },
      },
      { id: 'search', name: 'Search mail', shortcut: ['/'], section: 'Navigation', perform: () => s().focusSearch() },
      { id: 'inbox', name: 'Go to inbox', shortcut: ['g', 'i'], section: 'Navigation', perform: () => s().setActiveLabel('INBOX') },
      { id: 'sent', name: 'Go to sent', shortcut: ['g', 's'], section: 'Navigation', perform: () => s().setActiveLabel('SENT') },
      { id: 'drafts', name: 'Go to drafts', shortcut: ['g', 'd'], section: 'Navigation', perform: () => s().setActiveLabel('DRAFT') },
      { id: 'labelJump', name: 'Jump to label…', shortcut: ['g', 'l'], section: 'Navigation', perform: () => s().openLabelPicker() },
      { id: 'agenda', name: 'Open agenda', shortcut: ['g', 'c'], section: 'Navigation', perform: () => s().openAgenda() },
      { id: 'toggleSplit', name: 'Toggle split inbox', section: 'View', perform: () => s().toggleSplit() },
      // Tab/⇧Tab은 useKeyboard 소유 — kbar shortcut으로 등록하면 이중 발화한다. 팔레트 검색용 액션만 둔다.
      { id: 'nextSplit', name: 'Next split', section: 'View', perform: () => s().nextTab() },
      { id: 'prevSplit', name: 'Previous split', section: 'View', perform: () => s().prevTab() },
      {
        id: 'configureSplits',
        name: 'Configure splits…',
        section: 'View',
        perform: () => useMailStore.setState({ splitSettingsOpen: true }),
      },
      {
        id: 'snippets',
        name: 'Snippets…',
        section: 'View',
        perform: () => useMailStore.setState({ snippetsOpen: true }),
      },
      {
        id: 'toggleTheme',
        name: 'Toggle light/dark theme',
        section: 'View',
        perform: () => useMailStore.getState().toggleTheme(),
      },
      {
        id: 'cheatsheet',
        name: 'Keyboard shortcuts',
        shortcut: ['?'],
        section: 'Help',
        perform: () => useCoachStore.getState().openCheatSheet(),
      },
      {
        id: 'stats',
        name: 'Your stats',
        section: 'Help',
        perform: () => useCoachStore.getState().openStats(),
      },
      {
        id: 'tutorial',
        name: 'Start tutorial',
        section: 'Help',
        perform: () => useCoachStore.getState().startTutorial(),
      },
    ].map((a) => ({
      ...a,
      perform: () => {
        const result = a.perform?.();
        useCoachStore.getState().recordEfficient(a.id);
        return result;
      },
    }));
  }, []);

  return (
    <KBarProvider actions={actions} options={{ toggleShortcut: '$mod+k' }}>
      <AccountActions />
      <KBarPortal>
        <KBarPositioner className="z-50 bg-black/50">
          <KBarAnimator className="w-full max-w-lg overflow-hidden rounded-lg border border-bg-border bg-bg-subtle shadow-2xl">
            <KBarSearch
              className="w-full border-b border-bg-border bg-transparent px-4 py-3 text-[14px] text-text-primary outline-none placeholder:text-text-muted"
              defaultPlaceholder="Type a command…"
            />
            <div className="pb-2">
              <RenderResults />
            </div>
          </KBarAnimator>
        </KBarPositioner>
      </KBarPortal>
      {children}
    </KBarProvider>
  );
}
