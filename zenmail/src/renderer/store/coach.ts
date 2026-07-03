import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DUAL_MODALITY, HINTS, MODALITY_ACTION } from '../lib/shortcuts';
import { MILESTONES, crossedMilestone, keyboardRatio, meetsMinSample, rollWeek, shouldShowHint } from '../lib/coach';

/** A queued coaching toast (CP3 hint / CP4 milestone) — independent slot from store.toast (D9). */
export interface CoachToast {
  seq: number;
  kind: 'hint' | 'milestone';
  id: string;
  message: string;
  keys?: string[];
}

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
  /** Queued hint/milestone toasts (CP3+CP4) — CoachToastHost renders and dismisses these. */
  coachToasts: CoachToast[];
  /** Local monotonically-increasing id for coachToasts entries. */
  seq: number;
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
  /** Hint gating (CP3) — called from mouse-affordance onClick handlers, separate from recordMouse. */
  maybeHint: (hintId: string) => void;
  /** Dismisses a single queued coach toast (hint "Got it" / milestone auto-dismiss). */
  dismissCoachToast: (seq: number) => void;
  /** Global opt-out — persisted, no further hints ever shown. */
  muteHints: () => void;
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

interface MilestoneUpdate {
  seq: number;
  milestonesShown: string[];
  coachToasts: CoachToast[];
}

/** Checks the 'first' and 'count' MILESTONES for `kind` after a bumpStat, queuing toasts for any that fire. */
function applyStatMilestones(
  seq: number,
  milestonesShown: string[],
  coachToasts: CoachToast[],
  kind: string,
  prevCount: number,
  nextCount: number,
  isFirst: boolean
): MilestoneUpdate {
  let nextSeq = seq;
  let shown = milestonesShown;
  let toasts = coachToasts;
  for (const m of MILESTONES) {
    if (m.stat !== kind) continue;
    const fires =
      (m.kind === 'first' && isFirst && !shown.includes(m.id)) ||
      (m.kind === 'count' &&
        m.threshold !== undefined &&
        crossedMilestone(m.id, prevCount, nextCount, m.threshold, shown));
    if (!fires) continue;
    nextSeq += 1;
    shown = [...shown, m.id];
    toasts = [...toasts, { seq: nextSeq, kind: 'milestone', id: m.id, message: m.label }];
  }
  return { seq: nextSeq, milestonesShown: shown, coachToasts: toasts };
}

/** Checks the single 'ratio' milestone after a recordEfficient/recordMouse, guarded by a minimum sample size. */
function applyRatioMilestone(
  seq: number,
  milestonesShown: string[],
  coachToasts: CoachToast[],
  prevKeyboard: number,
  prevMouse: number,
  nextKeyboard: number,
  nextMouse: number
): MilestoneUpdate {
  const noop = { seq, milestonesShown, coachToasts };
  const ratioMilestone = MILESTONES.find((m) => m.kind === 'ratio');
  if (!ratioMilestone || milestonesShown.includes(ratioMilestone.id)) return noop;
  if (!meetsMinSample(nextKeyboard, nextMouse)) return noop;

  const threshold = ratioMilestone.threshold ?? 0.8;
  const prevRatio = keyboardRatio(prevKeyboard, prevMouse);
  const nextRatio = keyboardRatio(nextKeyboard, nextMouse);
  if (prevRatio !== null && prevRatio >= threshold) return noop;
  if (nextRatio === null || nextRatio < threshold) return noop;

  const nextSeq = seq + 1;
  return {
    seq: nextSeq,
    milestonesShown: [...milestonesShown, ratioMilestone.id],
    coachToasts: [
      ...coachToasts,
      { seq: nextSeq, kind: 'milestone', id: ratioMilestone.id, message: ratioMilestone.label },
    ],
  };
}

export const useCoachStore = create<CoachState>()(
  persist(
    (set, get) => ({
      ...initialPersisted,
      cheatSheetOpen: false,
      statsOpen: false,
      hintsShownSession: [],
      coachToasts: [],
      seq: 0,

      openCheatSheet: () => set({ cheatSheetOpen: true }),
      closeCheatSheet: () => set({ cheatSheetOpen: false }),
      openStats: () => set({ statsOpen: true }),
      closeStats: () => set({ statsOpen: false }),

      recordEfficient: (actionId) => {
        const dualId = MODALITY_ACTION[actionId] ?? actionId;
        if (!DUAL_MODALITY.has(dualId)) return;
        set((s) => {
          const keyboardCount = s.keyboardCount + 1;
          const milestoneUpdate = applyRatioMilestone(
            s.seq,
            s.milestonesShown,
            s.coachToasts,
            s.keyboardCount,
            s.mouseCount,
            keyboardCount,
            s.mouseCount
          );
          return { keyboardCount, ...milestoneUpdate };
        });
      },

      recordMouse: (actionId) => {
        const dualId = MODALITY_ACTION[actionId] ?? actionId;
        if (!DUAL_MODALITY.has(dualId)) return;
        set((s) => {
          const mouseCount = s.mouseCount + 1;
          const milestoneUpdate = applyRatioMilestone(
            s.seq,
            s.milestonesShown,
            s.coachToasts,
            s.keyboardCount,
            s.mouseCount,
            s.keyboardCount,
            mouseCount
          );
          return { mouseCount, ...milestoneUpdate };
        });
      },

      bumpStat: (kind) => {
        set((s) => {
          const prevCount = s.counters[kind] ?? 0;
          const nextCount = prevCount + 1;
          const counters = { ...s.counters, [kind]: nextCount };
          const isFirst = !s.firsts[kind];
          const firsts = isFirst ? { ...s.firsts, [kind]: true } : s.firsts;
          let weekStart = s.weekStart;
          let weekProcessed = s.weekProcessed;
          if (WEEKLY_STATS.has(kind)) {
            const rolled = rollWeek({ weekStart: s.weekStart, weekProcessed: s.weekProcessed }, new Date());
            weekStart = rolled.weekStart;
            weekProcessed = rolled.weekProcessed + 1;
          }
          const milestoneUpdate = applyStatMilestones(
            s.seq,
            s.milestonesShown,
            s.coachToasts,
            kind,
            prevCount,
            nextCount,
            isFirst
          );
          return { counters, firsts, weekStart, weekProcessed, ...milestoneUpdate };
        });
      },

      ratio: () => {
        const s = get();
        return keyboardRatio(s.keyboardCount, s.mouseCount);
      },

      maybeHint: (hintId) => {
        const hint = HINTS[hintId];
        if (!hint) return;
        set((s) => {
          const show = shouldShowHint({
            hintsMuted: s.hintsMuted,
            shownTotal: s.hintsShown[hintId] ?? 0,
            shownThisSession: s.hintsShownSession.includes(hintId),
          });
          if (!show) return s;
          const seq = s.seq + 1;
          return {
            hintsShown: { ...s.hintsShown, [hintId]: (s.hintsShown[hintId] ?? 0) + 1 },
            hintsShownSession: [...s.hintsShownSession, hintId],
            seq,
            coachToasts: [
              ...s.coachToasts,
              { seq, kind: 'hint', id: hintId, message: hint.message, keys: hint.keys },
            ],
          };
        });
      },

      dismissCoachToast: (seq) => {
        set((s) => ({ coachToasts: s.coachToasts.filter((t) => t.seq !== seq) }));
      },

      muteHints: () => set({ hintsMuted: true }),
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
