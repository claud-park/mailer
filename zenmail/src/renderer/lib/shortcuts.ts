/**
 * Definitive keyboard shortcut catalog — single source of truth for the `?`
 * cheat sheet (CheatSheet.tsx). Labels mirror the kbar action `name` for
 * anything already registered in CommandPalette.tsx; the rest describe keys
 * owned directly by useKeyboard.ts or component-local handlers (Compose).
 */
export interface ShortcutDef {
  id: string;
  keys: string[]; // display tokens, e.g. ['g', 'i'], ['⌘', '⇧', 'I'], ['j']
  label: string;
  section: 'Actions' | 'Navigation' | 'View' | 'Help';
  hint?: string; // hint toast copy (used by CP3), e.g. 'Press C to compose'
}

export const SHORTCUTS: ShortcutDef[] = [
  // Actions (kbar-registered, CommandPalette.tsx)
  { id: 'compose', keys: ['c'], label: 'Compose', section: 'Actions' },
  { id: 'archive', keys: ['e'], label: 'Archive', section: 'Actions' },
  { id: 'reply', keys: ['r'], label: 'Reply', section: 'Actions' },
  { id: 'replyAll', keys: ['a'], label: 'Reply all', section: 'Actions' },
  { id: 'forward', keys: ['f'], label: 'Forward', section: 'Actions' },
  { id: 'label', keys: ['l'], label: 'Apply label…', section: 'Actions' },
  { id: 'snooze', keys: ['b'], label: 'Snooze…', section: 'Actions' },
  { id: 'remindMe', keys: ['h'], label: 'Remind me…', section: 'Actions' },
  { id: 'trash', keys: ['#'], label: 'Move to trash', section: 'Actions' },
  { id: 'markRead', keys: ['I'], label: 'Mark as read', section: 'Actions' },
  { id: 'markUnread', keys: ['U'], label: 'Mark as unread', section: 'Actions' },
  // Actions — Compose-local (Compose.tsx onKeyDown), not kbar
  { id: 'composeSend', keys: ['⌘', 'Enter'], label: 'Send', section: 'Actions' },
  { id: 'composeSendArchive', keys: ['⌘', '⇧', 'Enter'], label: 'Send and archive', section: 'Actions' },

  // Navigation (kbar-registered)
  { id: 'search', keys: ['/'], label: 'Search mail', section: 'Navigation' },
  { id: 'inbox', keys: ['g', 'i'], label: 'Go to inbox', section: 'Navigation' },
  { id: 'sent', keys: ['g', 's'], label: 'Go to sent', section: 'Navigation' },
  { id: 'drafts', keys: ['g', 'd'], label: 'Go to drafts', section: 'Navigation' },
  { id: 'labelJump', keys: ['g', 'l'], label: 'Jump to label…', section: 'Navigation' },
  // Navigation — owned by useKeyboard.ts
  { id: 'selectNext', keys: ['j'], label: 'Select next thread', section: 'Navigation' },
  { id: 'selectPrev', keys: ['k'], label: 'Select previous thread', section: 'Navigation' },
  { id: 'openSelected', keys: ['Enter'], label: 'Open selected thread', section: 'Navigation' },
  { id: 'nextThread', keys: [']'], label: 'Next thread', section: 'Navigation' },
  { id: 'prevThread', keys: ['['], label: 'Previous thread', section: 'Navigation' },
  { id: 'closeOrClear', keys: ['Esc'], label: 'Close thread / clear search', section: 'Navigation' },

  // View — kbar name reused, actual keys owned by useKeyboard.ts
  { id: 'toggleSplit', keys: ['⌘', '⇧', 'I'], label: 'Toggle split inbox', section: 'View' },
  { id: 'nextSplit', keys: ['Tab'], label: 'Next split', section: 'View' },
  { id: 'prevSplit', keys: ['⇧', 'Tab'], label: 'Previous split', section: 'View' },
  { id: 'splitTabJump', keys: ['⌘', '1–9'], label: 'Jump to split tab', section: 'View' },

  // Help
  { id: 'commandPalette', keys: ['⌘', 'K'], label: 'Command palette', section: 'Help' },
  { id: 'cheatsheet', keys: ['?'], label: 'Keyboard shortcuts', section: 'Help' },
];
