import { describe, expect, it } from 'vitest';
import { MockCalendarProvider } from './calendar';

const DAY = 86_400_000;

describe('MockCalendarProvider', () => {
  it('seeds 2 events today and 1 tomorrow within a two-day window', async () => {
    const p = new MockCalendarProvider();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 2 * DAY);
    const events = await p.listEvents(start.toISOString(), end.toISOString());
    const today = events.filter((e) => new Date(e.startISO).toDateString() === new Date().toDateString());
    const tomorrow = events.filter(
      (e) => new Date(e.startISO).toDateString() === new Date(Date.now() + DAY).toDateString()
    );
    expect(today.length).toBe(2);
    expect(tomorrow.length).toBe(1);
  });

  it('records an RSVP response keyed by iCalUID', async () => {
    const p = new MockCalendarProvider();
    await p.respondToEvent('demo-evt-standup', 'accepted');
    expect(p.snapshot().responses['demo-evt-standup']).toBe('accepted');
  });

  it('appends a created event', async () => {
    const p = new MockCalendarProvider();
    const before = p.snapshot().events.length;
    const ev = await p.createEvent({
      summary: 'New sync', startISO: '2026-07-20T09:00:00.000Z',
      endISO: '2026-07-20T09:30:00.000Z', attendees: ['a@b.com'],
    });
    expect(ev.summary).toBe('New sync');
    expect(p.snapshot().events.length).toBe(before + 1);
  });

  it('failNextCalendarCall makes exactly the next call throw (one-shot)', async () => {
    const p = new MockCalendarProvider();
    p.failNextCalendarCall();
    await expect(p.listEvents('2026-07-13T00:00:00Z', '2026-07-15T00:00:00Z')).rejects.toThrow();
    await expect(p.listEvents('2026-07-13T00:00:00Z', '2026-07-15T00:00:00Z')).resolves.toBeInstanceOf(Array);
  });
});
