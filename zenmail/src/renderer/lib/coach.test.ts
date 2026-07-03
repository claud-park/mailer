import { describe, expect, it } from 'vitest';
import {
  crossedMilestone,
  isoWeekStart,
  keyboardRatio,
  meetsMinSample,
  rollWeek,
  shouldShowHint,
} from './coach';

describe('isoWeekStart', () => {
  it('returns the Monday of the same week', () => {
    // 2026-07-03 is a Friday
    expect(isoWeekStart(new Date(2026, 6, 3))).toBe('2026-06-29');
  });

  it('returns itself for a Monday', () => {
    expect(isoWeekStart(new Date(2026, 6, 6))).toBe('2026-07-06');
  });

  it('rolls Sunday back to the preceding Monday', () => {
    expect(isoWeekStart(new Date(2026, 6, 12))).toBe('2026-07-06');
  });

  it('handles a year boundary correctly', () => {
    // 2026-01-01 is a Thursday; week starts Monday 2025-12-29
    expect(isoWeekStart(new Date(2026, 0, 1))).toBe('2025-12-29');
  });
});

describe('rollWeek', () => {
  it('keeps weekProcessed when still inside the same week', () => {
    const state = { weekStart: '2026-06-29', weekProcessed: 5 };
    const next = rollWeek(state, new Date(2026, 6, 3));
    expect(next).toEqual({ weekStart: '2026-06-29', weekProcessed: 5 });
  });

  it('resets weekProcessed once the week boundary is crossed', () => {
    const state = { weekStart: '2026-06-29', weekProcessed: 5 };
    const next = rollWeek(state, new Date(2026, 6, 6)); // next Monday
    expect(next).toEqual({ weekStart: '2026-07-06', weekProcessed: 0 });
  });

  it('resets across a year boundary', () => {
    const state = { weekStart: '2025-12-22', weekProcessed: 3 };
    const next = rollWeek(state, new Date(2026, 0, 1));
    expect(next).toEqual({ weekStart: '2025-12-29', weekProcessed: 0 });
  });
});

describe('keyboardRatio', () => {
  it('is null when there is no data', () => {
    expect(keyboardRatio(0, 0)).toBeNull();
  });

  it('computes the keyboard share', () => {
    expect(keyboardRatio(3, 1)).toBe(0.75);
  });

  it('is 0 when only mouse actions were recorded', () => {
    expect(keyboardRatio(0, 4)).toBe(0);
  });

  it('is 1 when only keyboard actions were recorded', () => {
    expect(keyboardRatio(4, 0)).toBe(1);
  });
});

describe('shouldShowHint', () => {
  it('is false when muted', () => {
    expect(shouldShowHint({ hintsMuted: true, shownTotal: 0, shownThisSession: false })).toBe(false);
  });

  it('is false once the lifetime cap (3) is reached', () => {
    expect(shouldShowHint({ hintsMuted: false, shownTotal: 3, shownThisSession: false })).toBe(false);
  });

  it('is false once already shown this session', () => {
    expect(shouldShowHint({ hintsMuted: false, shownTotal: 1, shownThisSession: true })).toBe(false);
  });

  it('is true when under all caps and unmuted', () => {
    expect(shouldShowHint({ hintsMuted: false, shownTotal: 2, shownThisSession: false })).toBe(true);
  });
});

describe('crossedMilestone', () => {
  it('fires when 99 -> 100 crosses the threshold', () => {
    expect(crossedMilestone('archive100', 99, 100, 100, [])).toBe(true);
  });

  it('does not fire again for 100 -> 101', () => {
    expect(crossedMilestone('archive100', 100, 101, 100, [])).toBe(false);
  });

  it('does not fire if already shown', () => {
    expect(crossedMilestone('archive100', 99, 100, 100, ['archive100'])).toBe(false);
  });

  it('does not fire when the threshold was skipped past without landing on it (still counts as crossed)', () => {
    expect(crossedMilestone('archive100', 98, 105, 100, [])).toBe(true);
  });
});

describe('meetsMinSample', () => {
  it('is false below the default minimum (20)', () => {
    expect(meetsMinSample(10, 9)).toBe(false);
  });

  it('is true exactly at the default minimum', () => {
    expect(meetsMinSample(15, 5)).toBe(true);
  });

  it('is true above the default minimum', () => {
    expect(meetsMinSample(30, 10)).toBe(true);
  });

  it('honors a custom minimum', () => {
    expect(meetsMinSample(2, 2, 5)).toBe(false);
    expect(meetsMinSample(3, 2, 5)).toBe(true);
  });
});
