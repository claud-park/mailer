import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DUAL_MODALITY, MODALITY_ACTION } from '../lib/shortcuts';
import { keyboardRatio, rollWeek } from '../lib/coach';

/** Persisted (localStorage) slice — coaching telemetry only, no main/IPC consumer (see DECISIONS D6). */
interface CoachPersisted {
  tutorialSeen: boolean;
  counters: Record<string, number>;
  keyboardCount: number;
  mouseCount: number;
  weekStart: string;
  weekProcessed: number;
  firsts: Record<string, boolean>;
  milestonesShown: string[];
  hintsShown: Record<string, number>;
  hintsMuted: boolean;
}

/** Volatile (in-memory only) slice. */
interface CoachVolatile {
  cheatSheetOpen: boolean;
  statsOpen: boolean;
  /** ids of hints already shown once this session — cleared on reload, not persisted (CP2). */
  hintsShownSession: string[];
}

interface CoachActions {
  openCheatSheet: () => void;
  closeCheatSheet: () => void;
  openStats: () => void;
  closeStats: () => void;
  /** Records a dual-modality action performed via keyboard (kbar perform / useKeyboard). */
  recordEfficient: (actionId: string) => void;
  /** Records a dual-modality action performed via mouse (onClick/swipe). */
  recordMouse: (actionId: string) => void;
  /** Totals funnel — called once at the end of every store/mail.ts terminal action. */
  bumpStat: (kind: string) => void;
  /** Derived keyboard-vs-mouse ratio over dual-modality actions only (D10). */
  ratio: () => number | null;
}

type CoachState = CoachPersisted & CoachVolatile & CoachActions;

const initialPersisted: CoachPersisted = {
  tutorialSeen: false,
  counters: {},
  keyboardCount: 0,
  mouseCount: 0,
  weekStart: '',
  weekProcessed: 0,
  firsts: {},
  milestonesShown: [],
  hintsShown: {},
  hintsMuted: false,
};

/** actions that roll into the weekly-processed counter (PRD §3-4). */
const WEEKLY_STATS = new Set(['archive', 'trash', 'snooze']);

export const useCoachStore = create<CoachState>()(
  persist(
    (set, get) => ({
      ...initialPersisted,
      cheatSheetOpen: false,
      statsOpen: false,
      hintsShownSession: [],

      openCheatSheet: () => set({ cheatSheetOpen: true }),
      closeCheatSheet: () => set({ cheatSheetOpen: false }),
      openStats: () => set({ statsOpen: true }),
      closeStats: () => set({ statsOpen: false }),

      recordEfficient: (actionId) => {
        const dualId = MODALITY_ACTION[actionId] ?? actionId;
        if (!DUAL_MODALITY.has(dualId)) return;
        set((s) => ({ keyboardCount: s.keyboardCount + 1 }));
      },

      recordMouse: (actionId) => {
        const dualId = MODALITY_ACTION[actionId] ?? actionId;
        if (!DUAL_MODALITY.has(dualId)) return;
        set((s) => ({ mouseCount: s.mouseCount + 1 }));
      },

      bumpStat: (kind) => {
        set((s) => {
          const counters = { ...s.counters, [kind]: (s.counters[kind] ?? 0) + 1 };
          const firsts = s.firsts[kind] ? s.firsts : { ...s.firsts, [kind]: true };
          let weekStart = s.weekStart;
          let weekProcessed = s.weekProcessed;
          if (WEEKLY_STATS.has(kind)) {
            const rolled = rollWeek({ weekStart: s.weekStart, weekProcessed: s.weekProcessed }, new Date());
            weekStart = rolled.weekStart;
            weekProcessed = rolled.weekProcessed + 1;
          }
          return { counters, firsts, weekStart, weekProcessed };
        });
      },

      ratio: () => {
        const s = get();
        return keyboardRatio(s.keyboardCount, s.mouseCount);
      },
    }),
    {
      name: 'zenmail-coach',
      version: 1,
      partialize: (s): CoachPersisted => ({
        tutorialSeen: s.tutorialSeen,
        counters: s.counters,
        keyboardCount: s.keyboardCount,
        mouseCount: s.mouseCount,
        weekStart: s.weekStart,
        weekProcessed: s.weekProcessed,
        firsts: s.firsts,
        milestonesShown: s.milestonesShown,
        hintsShown: s.hintsShown,
        hintsMuted: s.hintsMuted,
      }),
    }
  )
);
