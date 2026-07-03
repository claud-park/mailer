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

/**
 * Actions that genuinely have both a keyboard and a mouse path (PRD §4-1 Layer B,
 * DECISIONS D10). Only these count toward the keyboard-ratio denominator — actions
 * with no mouse equivalent (reply/snooze/label/...) would otherwise inflate the ratio.
 */
export const DUAL_MODALITY: Set<string> = new Set([
  'compose',
  'toggleSplit',
  'openThread',
  'goToLabel',
  'switchTab',
  'archive',
]);

/**
 * Normalizes kbar action ids that map onto a dual-modality id used elsewhere
 * (e.g. Sidebar's mouse click on Inbox/Sent/Drafts records as 'goToLabel', so the
 * kbar 'inbox'/'sent'/'drafts' actions must record under the same id to compare).
 */
export const MODALITY_ACTION: Record<string, string> = {
  inbox: 'goToLabel',
  sent: 'goToLabel',
  drafts: 'goToLabel',
  nextSplit: 'switchTab',
  prevSplit: 'switchTab',
};

/**
 * Hint toast copy (CP3, PRD §3-3), keyed by the same dualId passed to
 * recordMouse/maybeHint at each of the 6 mouse-affordance call sites.
 */
export const HINTS: Record<string, { keys: string[]; message: string }> = {
  compose: { keys: ['C'], message: 'Press C to compose' },
  toggleSplit: { keys: ['⌘', '⇧', 'I'], message: 'Press ⌘⇧I to toggle split inbox' },
  goToLabel: { keys: ['g', 'i'], message: 'Try g then i / s / d to jump' },
  openThread: { keys: ['j', 'k', '↵'], message: 'Use j / k to move, Enter to open' },
  switchTab: { keys: ['Tab'], message: 'Press Tab or ⌘1–9 to switch splits' },
  archive: { keys: ['E'], message: 'Press E to archive' },
};
