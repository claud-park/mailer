import { useMemo } from 'react';
import {
  KBarProvider,
  KBarPortal,
  KBarPositioner,
  KBarAnimator,
  KBarSearch,
  KBarResults,
  useMatches,
  type Action,
} from 'kbar';
import { useMailStore } from '../store/mail';
import { useCoachStore } from '../store/coach';

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
      { id: 'archive', name: 'Archive', shortcut: ['e'], section: 'Actions', perform: () => void s().archiveThread() },
      { id: 'reply', name: 'Reply', shortcut: ['r'], section: 'Actions', perform: () => s().openReply(false) },
      { id: 'replyAll', name: 'Reply all', shortcut: ['a'], section: 'Actions', perform: () => s().openReply(true) },
      { id: 'forward', name: 'Forward', shortcut: ['f'], section: 'Actions', perform: () => s().openForward() },
      { id: 'label', name: 'Apply label…', shortcut: ['l'], section: 'Actions', perform: () => s().openLabelPicker() },
      { id: 'snooze', name: 'Snooze…', shortcut: ['b'], section: 'Actions', perform: () => s().openSnoozePicker() },
      { id: 'remindMe', name: 'Remind me…', shortcut: ['h'], section: 'Actions', perform: () => s().openFollowupPicker() },
      { id: 'trash', name: 'Move to trash', shortcut: ['#'], section: 'Actions', perform: () => void s().trashThread() },
      { id: 'markRead', name: 'Mark as read', shortcut: ['I'], section: 'Actions', perform: () => void s().markRead(undefined, true) },
      { id: 'markUnread', name: 'Mark as unread', shortcut: ['U'], section: 'Actions', perform: () => void s().markRead(undefined, false) },
      { id: 'search', name: 'Search mail', shortcut: ['/'], section: 'Navigation', perform: () => s().focusSearch() },
      { id: 'inbox', name: 'Go to inbox', shortcut: ['g', 'i'], section: 'Navigation', perform: () => s().setActiveLabel('INBOX') },
      { id: 'sent', name: 'Go to sent', shortcut: ['g', 's'], section: 'Navigation', perform: () => s().setActiveLabel('SENT') },
      { id: 'drafts', name: 'Go to drafts', shortcut: ['g', 'd'], section: 'Navigation', perform: () => s().setActiveLabel('DRAFT') },
      { id: 'labelJump', name: 'Jump to label…', shortcut: ['g', 'l'], section: 'Navigation', perform: () => s().openLabelPicker() },
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
        id: 'cheatsheet',
        name: 'Keyboard shortcuts',
        shortcut: ['?'],
        section: 'Help',
        perform: () => useCoachStore.getState().openCheatSheet(),
      },
    ];
  }, []);

  return (
    <KBarProvider actions={actions} options={{ toggleShortcut: '$mod+k' }}>
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
