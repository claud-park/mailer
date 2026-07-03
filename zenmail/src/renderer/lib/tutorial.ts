/**
 * Interactive-tutorial step catalog — pure data, no React/store imports
 * (mirrors lib/coach.ts / lib/shortcuts.ts). Consumed by store/coach.ts
 * (step count/index) and components/Tutorial.tsx (copy + key mediation).
 *
 * See docs/features/keyboard-mastery/PRD.md §3-1 and DECISIONS.md D7 for the
 * "real inbox + destructive-key intercept" design this encodes.
 */
export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  /** Keys (e.key, compared case-insensitively) that advance this step. */
  keys: string[];
  /** Visual anchor — v1 renders the coach bubble at a fixed position regardless
   *  of anchor (no spotlight/arrow, YAGNI per the build brief); kept for a
   *  future positioning pass. */
  anchor: 'list' | 'thread' | 'toolbar';
  /** true only for the archive step — Tutorial.tsx always swallows e/# tutorial-wide,
   *  but only this step's copy explains *why* nothing happened. */
  intercept?: boolean;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'move-down',
    title: 'Move down',
    body: 'Press j to select the next thread.',
    keys: ['j'],
    anchor: 'list',
  },
  {
    id: 'move-up',
    title: 'Move up',
    body: 'Press k to select the previous thread.',
    keys: ['k'],
    anchor: 'list',
  },
  {
    id: 'open',
    title: 'Open it',
    body: 'Press Enter to open the selected thread.',
    keys: ['Enter'],
    anchor: 'thread',
  },
  {
    id: 'close',
    title: 'Close it',
    body: 'Press Esc to close the thread.',
    keys: ['Escape'],
    anchor: 'thread',
  },
  {
    id: 'archive',
    title: 'Archive',
    body: 'E archives — the fastest way through your inbox. (Not really archived during the tour.)',
    keys: ['e'],
    anchor: 'list',
    intercept: true,
  },
  {
    id: 'compose',
    title: 'Compose',
    body: 'Press c to start a new message.',
    keys: ['c'],
    anchor: 'toolbar',
  },
  {
    id: 'discard',
    title: 'Discard',
    body: 'Press Esc to discard this draft.',
    keys: ['Escape'],
    anchor: 'toolbar',
  },
];
