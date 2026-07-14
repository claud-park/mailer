import { describe, expect, it } from 'vitest';
import { isInInboxView, inLabelView, viewMembershipLabels } from './view';

describe('isInInboxView', () => {
  it.each<[string[], boolean]>([
    [['INBOX'], true],
    [['STARRED'], true],
    [['INBOX', 'STARRED'], true],
    [['STARRED', 'TRASH'], false],
    [['STARRED', 'SPAM'], false],
    [['SENT'], false],
    [[], false],
  ])('isInInboxView(%j) === %s', (labelIds, expected) => {
    expect(isInInboxView(labelIds)).toBe(expected);
  });

  it('excludes a starred thread carrying the (dynamic) snooze label id', () => {
    expect(isInInboxView(['STARRED', 'Label_snooze'], 'Label_snooze')).toBe(false);
  });

  it('includes the same thread when the snooze label id is unknown (null)', () => {
    expect(isInInboxView(['STARRED', 'Label_snooze'], null)).toBe(true);
  });
});

describe('inLabelView', () => {
  it('INBOX view delegates to isInInboxView', () => {
    expect(inLabelView(['STARRED'], 'INBOX')).toBe(true);
    expect(inLabelView(['STARRED', 'TRASH'], 'INBOX')).toBe(false);
  });

  it('non-INBOX label view is plain membership — a STARRED-only thread is NOT in a custom label view', () => {
    expect(inLabelView(['STARRED'], 'Label_x')).toBe(false);
    expect(inLabelView(['Label_x'], 'Label_x')).toBe(true);
  });

  it('non-INBOX label view ignores snoozeLabelId (no snooze exclusion outside INBOX)', () => {
    expect(inLabelView(['Label_x', 'Label_snooze'], 'Label_x', 'Label_snooze')).toBe(true);
  });
});

describe('viewMembershipLabels', () => {
  it('INBOX view strips both INBOX and STARRED', () => {
    expect(viewMembershipLabels('INBOX')).toEqual(['INBOX', 'STARRED']);
  });

  it('a non-INBOX label view strips only that label', () => {
    expect(viewMembershipLabels('Label_x')).toEqual(['Label_x']);
  });
});
