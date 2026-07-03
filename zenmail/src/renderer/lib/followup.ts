// Shared follow-up reminder presets — used by the Compose remind popover and the FollowupPicker modal.

export interface FollowupPreset {
  label: string;
  days: number;
}

export const FOLLOWUP_PRESETS: FollowupPreset[] = [
  { label: '2 days', days: 2 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
];

export const FOLLOWUP_DEFAULT_DAYS_KEY = 'followupDefaultDays';
export const FOLLOWUP_DEFAULT_DAYS = 3;

/** e.g. 3 → "3d", 7 → "1w" for the compose pill */
export function formatRemindDays(days: number): string {
  if (days % 7 === 0) return `${days / 7}w`;
  return `${days}d`;
}
