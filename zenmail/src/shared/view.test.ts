import { describe, expect, it } from 'vitest';
import { isInInboxView, isInStarredView, inLabelView, viewMembershipLabels } from './view';

describe('isInInboxView', () => {
  it.each<[string[], boolean]>([
    [['INBOX'], true],
    [['STARRED'], false], // starred-only (archived) is no longer part of Inbox — starred-view D3
    [['INBOX', 'STARRED'], true],
    [['INBOX', 'TRASH'], false],
    [['INBOX', 'SPAM'], false],
    [['STARRED', 'TRASH'], false],
    [['SENT'], false],
    [[], false],
  ])('isInInboxView(%j) === %s', (labelIds, expected) => {
    expect(isInInboxView(labelIds)).toBe(expected);
  });

  it('excludes an inbox thread carrying the (dynamic) snooze label id', () => {
    expect(isInInboxView(['INBOX', 'Label_snooze'], 'Label_snooze')).toBe(false);
  });

  it('includes the same thread when the snooze label id is unknown (null)', () => {
    expect(isInInboxView(['INBOX', 'Label_snooze'], null)).toBe(true);
  });
});

describe('isInStarredView', () => {
  it.each<[string[], boolean]>([
    [['STARRED'], true],
    [['INBOX'], false],
    [['INBOX', 'STARRED'], true],
    [['STARRED', 'TRASH'], false],
    [['STARRED', 'SPAM'], false],
    [['SENT'], false],
    [[], false],
  ])('isInStarredView(%j) === %s', (labelIds, expected) => {
    expect(isInStarredView(labelIds)).toBe(expected);
  });

  it('excludes a starred thread carrying the (dynamic) snooze label id', () => {
    expect(isInStarredView(['STARRED', 'Label_snooze'], 'Label_snooze')).toBe(false);
  });

  it('includes the same thread when the snooze label id is unknown (null)', () => {
    expect(isInStarredView(['STARRED', 'Label_snooze'], null)).toBe(true);
  });
});

describe('inLabelView', () => {
  it('INBOX view delegates to isInInboxView (pure INBOX, no STARRED union)', () => {
    expect(inLabelView(['INBOX'], 'INBOX')).toBe(true);
    expect(inLabelView(['STARRED'], 'INBOX')).toBe(false);
    expect(inLabelView(['INBOX', 'TRASH'], 'INBOX')).toBe(false);
  });

  it('STARRED view delegates to isInStarredView', () => {
    expect(inLabelView(['STARRED'], 'STARRED')).toBe(true);
    expect(inLabelView(['INBOX'], 'STARRED')).toBe(false);
    expect(inLabelView(['STARRED', 'TRASH'], 'STARRED')).toBe(false);
  });

  it('non-INBOX/non-STARRED label view is plain membership — a STARRED-only thread is NOT in a custom label view', () => {
    expect(inLabelView(['STARRED'], 'Label_x')).toBe(false);
    expect(inLabelView(['Label_x'], 'Label_x')).toBe(true);
  });

  it('non-INBOX/non-STARRED label view ignores snoozeLabelId (no snooze exclusion outside those two views)', () => {
    expect(inLabelView(['Label_x', 'Label_snooze'], 'Label_x', 'Label_snooze')).toBe(true);
  });
});

describe('viewMembershipLabels', () => {
  // INBOX와 STARRED는 배제 라벨(TRASH/SPAM/snoozed)이 동일해 서로의 이탈 원인을 대신할 수
  // 있다 — revalidate removal이 "정의 라벨 상실"과 "배제 라벨 획득"을 구분 못 하므로 어느
  // 쪽에서 벗겨지든 둘 다 벗긴다(whole-branch review 발견, cross-view stale-label 누수 방지).
  it('INBOX view strips both INBOX and STARRED', () => {
    expect(viewMembershipLabels('INBOX')).toEqual(['INBOX', 'STARRED']);
  });

  it('STARRED view strips both INBOX and STARRED', () => {
    expect(viewMembershipLabels('STARRED')).toEqual(['INBOX', 'STARRED']);
  });

  it('a non-INBOX/non-STARRED label view strips only that label', () => {
    expect(viewMembershipLabels('Label_x')).toEqual(['Label_x']);
  });
});
