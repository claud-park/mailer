import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
}

interface CoachActions {
  openCheatSheet: () => void;
  closeCheatSheet: () => void;
  openStats: () => void;
  closeStats: () => void;
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

export const useCoachStore = create<CoachState>()(
  persist(
    (set) => ({
      ...initialPersisted,
      cheatSheetOpen: false,
      statsOpen: false,

      openCheatSheet: () => set({ cheatSheetOpen: true }),
      closeCheatSheet: () => set({ cheatSheetOpen: false }),
      openStats: () => set({ statsOpen: true }),
      closeStats: () => set({ statsOpen: false }),
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
