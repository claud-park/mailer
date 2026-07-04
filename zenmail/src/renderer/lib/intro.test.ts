import { describe, expect, it } from 'vitest';
import { detectIntro, INTRO_MAX_MESSAGES, INTRO_SUBJECT_RE } from './intro';
import type { MessageDetail, ThreadDetail } from '../../shared/types';

const ME = 'me@zenmail.app';

function msg(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: 'm1',
    threadId: 't1',
    from: { name: 'Jamie Wu', email: 'jamie@example.com' },
    to: [{ name: 'Me', email: ME }],
    cc: [{ name: 'Yuna Park', email: 'yuna@example.com' }],
    date: 0,
    snippet: '',
    bodyHtml: '',
    bodyText: '',
    labelIds: [],
    ...overrides,
  };
}

function thread(overrides: Partial<ThreadDetail> = {}): ThreadDetail {
  return {
    id: 't1',
    subject: 'Intro: Yuna <> Me',
    labelIds: [],
    messages: [msg()],
    ...overrides,
  };
}

describe('detectIntro', () => {
  it('detects a valid intro (TC-A4): third-party sender, third-party cc, short thread, matching subject', () => {
    const result = detectIntro(thread(), ME);
    expect(result).toEqual({
      introducer: { name: 'Jamie Wu', email: 'jamie@example.com' },
      others: ['yuna@example.com'],
    });
  });

  it('is case-insensitive and matches "Introducing" (TC-A5)', () => {
    const result = detectIntro(thread({ subject: 'Introducing Yuna to the team' }), ME);
    expect(result).not.toBeNull();
    expect(result?.others).toEqual(['yuna@example.com']);
  });

  it('matches the Korean keyword 소개 (TC-A5)', () => {
    const result = detectIntro(thread({ subject: '유나 소개드립니다' }), ME);
    expect(result).not.toBeNull();
  });

  it('returns null when the subject has no intro keyword (TC-A5)', () => {
    expect(detectIntro(thread({ subject: 'Lunch tomorrow?' }), ME)).toBeNull();
  });

  it('returns null when the thread has more than INTRO_MAX_MESSAGES messages (TC-A5)', () => {
    const messages = Array.from({ length: INTRO_MAX_MESSAGES + 1 }, (_, i) => msg({ id: `m${i}` }));
    expect(detectIntro(thread({ messages }), ME)).toBeNull();
  });

  it('returns null when the last message is from me (TC-A5)', () => {
    const t = thread({ messages: [msg({ from: { name: 'Me', email: ME } })] });
    expect(detectIntro(t, ME)).toBeNull();
  });

  it('returns null when there is no third party in to/cc besides me and the sender (TC-A5)', () => {
    const t = thread({
      messages: [msg({ to: [{ name: 'Me', email: ME }], cc: [] })],
    });
    expect(detectIntro(t, ME)).toBeNull();
  });

  it('dedupes third parties appearing in both to and cc', () => {
    const t = thread({
      messages: [
        msg({
          to: [{ name: 'Me', email: ME }, { name: 'Yuna Park', email: 'yuna@example.com' }],
          cc: [{ name: 'Yuna Park', email: 'yuna@example.com' }],
        }),
      ],
    });
    const result = detectIntro(t, ME);
    expect(result?.others).toEqual(['yuna@example.com']);
  });

  it('exports a subject regex that matches "connecting" and does not match unrelated text', () => {
    expect(INTRO_SUBJECT_RE.test('Connecting you two')).toBe(true);
    expect(INTRO_SUBJECT_RE.test('Weekly newsletter')).toBe(false);
  });
});
