import { describe, expect, it } from 'vitest';
import { unfoldIcs, parseIcs, extractInvite } from './ics';

const wrap = (lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');

/** Wrap event-level property lines in a VEVENT inside the VCALENDAR. */
const wrapEvent = (eventLines: string[], calendarLines: string[] = []) =>
  wrap([...calendarLines, 'BEGIN:VEVENT', ...eventLines, 'END:VEVENT']);

describe('unfoldIcs — RFC5545 line unfolding', () => {
  // TC-CAL-F1 (일부): 다음 줄이 공백/탭으로 시작하면 앞줄에 이어붙인다
  it('unfolds continuation lines that start with a space', () => {
    const raw = 'SUMMARY:Team\r\n  sync meeting\r\nUID:abc';
    expect(unfoldIcs(raw)).toEqual(['SUMMARY:Team sync meeting', 'UID:abc']);
  });
});

describe('parseIcs — field extraction + date normalization', () => {
  // TC-CAL-F1: 언폴딩 + 이스케이프(\, \; \n) 처리
  it('unescapes \\, \\; and \\n in text fields', () => {
    const raw = wrapEvent(['SUMMARY:Lunch\\, then\\; review\\nagenda', 'UID:u1', 'DTSTART:20260714T090000Z']);
    expect(parseIcs(raw).summary).toBe('Lunch, then; review\nagenda');
  });

  // TC-CAL-F2: DTSTART가 ...Z (UTC)
  it('normalizes a UTC (...Z) DTSTART to ISO', () => {
    const raw = wrapEvent(['UID:u2', 'DTSTART:20260714T093000Z', 'DTEND:20260714T103000Z']);
    const f = parseIcs(raw);
    expect(f.dtstart).toBe('2026-07-14T09:30:00.000Z');
    expect(f.dtend).toBe('2026-07-14T10:30:00.000Z');
  });

  // TC-CAL-F3: DTSTART;TZID=... 파라미터 형식
  it('normalizes a TZID-parameterized DTSTART to ISO', () => {
    const raw = wrapEvent(['UID:u3', 'DTSTART;TZID=Asia/Seoul:20260714T180000']);
    expect(parseIcs(raw).dtstart).toBe(new Date('2026-07-14T18:00:00+09:00').toISOString());
  });

  // TC-CAL-F4: UTC/TZID 어느 것도 아니면 undefined (throw 금지)
  it('returns undefined for an unparseable date form (no throw)', () => {
    const raw = wrapEvent(['UID:u4', 'DTSTART:not-a-date']);
    expect(() => parseIcs(raw)).not.toThrow();
    expect(parseIcs(raw).dtstart).toBeUndefined();
  });
});

describe('extractInvite — REQUEST gating + fail-safe', () => {
  it('returns an InviteInfo for a valid METHOD:REQUEST', () => {
    const raw = wrap([
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:evt-1',
      'SUMMARY:Design review',
      'DTSTART:20260714T090000Z',
      'DTEND:20260714T100000Z',
      'ORGANIZER;CN=Ana:mailto:ana@linearly.dev',
      'END:VEVENT',
    ]);
    expect(extractInvite(raw)).toEqual({
      iCalUID: 'evt-1',
      summary: 'Design review',
      startISO: '2026-07-14T09:00:00.000Z',
      endISO: '2026-07-14T10:00:00.000Z',
      organizer: 'ana@linearly.dev',
      method: 'REQUEST',
    });
  });

  // TC-CAL-F5: METHOD:REQUEST가 아니면 InviteInfo 미생성 (범위 밖)
  it('returns undefined for METHOD:CANCEL', () => {
    const raw = wrapEvent(['UID:evt-2', 'SUMMARY:x', 'DTSTART:20260714T090000Z'], ['METHOD:CANCEL']);
    expect(extractInvite(raw)).toBeUndefined();
  });

  // TC-CAL-F4 (extractInvite 레벨): 날짜 해석 불가면 invite 미노출
  it('returns undefined when the date cannot be resolved (fail-safe)', () => {
    const raw = wrapEvent(['UID:evt-3', 'SUMMARY:x', 'DTSTART:garbage'], ['METHOD:REQUEST']);
    expect(extractInvite(raw)).toBeUndefined();
  });

  // 컴포넌트 스코핑: VTIMEZONE(STANDARD)의 DTSTART가 VEVENT 값을 덮어쓰면 안 된다
  const vtimezone = [
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'BEGIN:STANDARD',
    'DTSTART:19701101T020000',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];
  const vevent = [
    'BEGIN:VEVENT',
    'UID:evt-tz',
    'SUMMARY:Quarterly sync',
    'DTSTART:20260714T090000Z',
    'DTEND:20260714T100000Z',
    'END:VEVENT',
  ];
  const expectedTzInvite = {
    iCalUID: 'evt-tz',
    summary: 'Quarterly sync',
    startISO: '2026-07-14T09:00:00.000Z',
    endISO: '2026-07-14T10:00:00.000Z',
    organizer: undefined,
    method: 'REQUEST',
  };

  it('keeps the VEVENT DTSTART when a VTIMEZONE follows the VEVENT', () => {
    const raw = wrap(['METHOD:REQUEST', ...vevent, ...vtimezone]);
    expect(extractInvite(raw)).toEqual(expectedTzInvite);
  });

  it('keeps the VEVENT DTSTART when a VTIMEZONE precedes the VEVENT', () => {
    const raw = wrap(['METHOD:REQUEST', ...vtimezone, ...vevent]);
    expect(extractInvite(raw)).toEqual(expectedTzInvite);
  });
});
