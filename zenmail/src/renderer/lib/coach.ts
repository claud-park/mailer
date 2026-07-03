/**
 * Pure coaching-logic helpers — no React/store imports (see PRD §4-2, DECISIONS D10).
 * Consumed by store/coach.ts and exercised directly by coach.test.ts.
 */

export interface WeekState {
  weekStart: string;
  weekProcessed: number;
}

/** Monday (local time) of the week containing `now`, formatted 'YYYY-MM-DD'. */
export function isoWeekStart(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = d.getDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Resets weekProcessed to 0 (and adopts the new weekStart) once the ISO week boundary is crossed. */
export function rollWeek(state: WeekState, now: Date): WeekState {
  const currentWeekStart = isoWeekStart(now);
  if (state.weekStart === currentWeekStart) return state;
  return { weekStart: currentWeekStart, weekProcessed: 0 };
}

/** Keyboard usage ratio over dual-modality actions only. null when no data yet (D10). */
export function keyboardRatio(keyboardCount: number, mouseCount: number): number | null {
  const total = keyboardCount + mouseCount;
  if (total === 0) return null;
  return keyboardCount / total;
}

/**
 * Minimum sample size (total dual-modality actions) required before the ratio
 * milestone (CP4) is allowed to fire — guards against a tiny, unrepresentative
 * sample (e.g. 1 keyboard action) reading as "80% keyboard".
 */
export function meetsMinSample(keyboardCount: number, mouseCount: number, min = 20): boolean {
  return keyboardCount + mouseCount >= min;
}

/** Hint visibility gating: global mute, lifetime cap (3), and one-per-session cap. */
export function shouldShowHint(args: {
  hintsMuted: boolean;
  shownTotal: number;
  shownThisSession: boolean;
}): boolean {
  if (args.hintsMuted) return false;
  if (args.shownTotal >= 3) return false;
  if (args.shownThisSession) return false;
  return true;
}

/** True exactly when `prev -> next` crosses `threshold` and the milestone hasn't already fired. */
export function crossedMilestone(
  id: string,
  prev: number,
  next: number,
  threshold: number,
  shown: string[]
): boolean {
  if (shown.includes(id)) return false;
  return prev < threshold && next >= threshold;
}

export interface MilestoneDef {
  id: string;
  label: string;
  kind: 'first' | 'count' | 'ratio';
  stat?: string;
  threshold?: number;
}

/** Catalog of one-time milestone toasts (PRD §3 "마일스톤", DECISIONS D10). */
export const MILESTONES: MilestoneDef[] = [
  { id: 'firstArchive', label: 'First archive — e is the fastest way through your inbox', kind: 'first', stat: 'archive' },
  { id: 'firstSnooze', label: 'First snooze — it’ll come back when you need it', kind: 'first', stat: 'snooze' },
  { id: 'firstFollowup', label: 'First reminder — h keeps threads from slipping', kind: 'first', stat: 'followup' },
  { id: 'firstPalette', label: 'First command palette — ⌘K finds anything', kind: 'first', stat: 'palette' },
  { id: 'firstSearch', label: 'First search — / jumps straight there', kind: 'first', stat: 'search' },
  { id: 'archive100', label: '100 archives — inbox zero is a habit now', kind: 'count', stat: 'archive', threshold: 100 },
  { id: 'ratio80', label: 'Keyboard ratio crossed 80% — you barely touch the mouse anymore', kind: 'ratio', threshold: 0.8 },
];
