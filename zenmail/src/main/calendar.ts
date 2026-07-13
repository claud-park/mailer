import { google, calendar_v3, Auth } from 'googleapis';
import type { CalendarEvent, CreateEventInput, RsvpResponse } from '../shared/types';

export interface CalendarProvider {
  readonly demo: boolean;
  listEvents(timeMinISO: string, timeMaxISO: string): Promise<CalendarEvent[]>;
  respondToEvent(iCalUID: string, response: RsvpResponse): Promise<void>;
  createEvent(input: CreateEventInput): Promise<CalendarEvent>;
}

function toEvent(e: calendar_v3.Schema$Event): CalendarEvent {
  const allDay = !!e.start?.date && !e.start?.dateTime;
  return {
    id: e.id ?? '',
    iCalUID: e.iCalUID ?? undefined,
    summary: e.summary ?? '(제목 없음)',
    startISO: e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00.000Z` : ''),
    endISO: e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00.000Z` : undefined),
    allDay,
    organizer: e.organizer?.email ?? undefined,
  };
}

export class RealCalendarProvider implements CalendarProvider {
  readonly demo = false;
  private calendar: calendar_v3.Calendar;

  constructor(auth: Auth.OAuth2Client, readonly email: string) {
    this.calendar = google.calendar({ version: 'v3', auth });
  }

  async listEvents(timeMinISO: string, timeMaxISO: string): Promise<CalendarEvent[]> {
    const res = await this.calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100,
    });
    return (res.data.items ?? []).map(toEvent);
  }

  async respondToEvent(iCalUID: string, response: RsvpResponse): Promise<void> {
    const found = await this.calendar.events.list({ calendarId: 'primary', iCalUID });
    const event = found.data.items?.[0];
    if (!event?.id) throw new Error(`Event not found for iCalUID ${iCalUID}`);
    const attendees = (event.attendees ?? []).map((a) =>
      a.email?.toLowerCase() === this.email.toLowerCase() ? { ...a, responseStatus: response } : a
    );
    await this.calendar.events.patch({
      calendarId: 'primary',
      eventId: event.id,
      sendUpdates: 'all',
      requestBody: { attendees },
    });
  }

  async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    const res = await this.calendar.events.insert({
      calendarId: 'primary',
      sendUpdates: 'all',
      requestBody: {
        summary: input.summary,
        start: { dateTime: input.startISO },
        end: { dateTime: input.endISO },
        attendees: input.attendees.map((email) => ({ email })),
      },
    });
    return toEvent(res.data);
  }
}

// ---------------------------------------------------------------------------
// Mock (demo) calendar provider — mirrors MockGmailProvider's callCounts/delay/fail pattern.
// ---------------------------------------------------------------------------

export class MockCalendarProvider implements CalendarProvider {
  readonly demo = true;
  private events: CalendarEvent[] = [];
  private responses: Record<string, string> = {};
  /** E2E-only: per-method invocation counters. */
  readonly callCounts: Record<string, number> = {};
  /** E2E-only: one-shot — makes the next network-shaped call throw. */
  private failNext = false;

  constructor() {
    const now = new Date();
    const at = (dayOffset: number, hour: number, min = 0) => {
      const d = new Date(now);
      d.setDate(d.getDate() + dayOffset);
      d.setHours(hour, min, 0, 0);
      return d;
    };
    const evt = (id: string, summary: string, s: Date, e: Date, iCalUID?: string): CalendarEvent => ({
      id, iCalUID, summary, startISO: s.toISOString(), endISO: e.toISOString(),
      allDay: false, organizer: 'ana@linearly.dev',
    });
    this.events = [
      evt('mock_evt_1', 'Standup', at(0, 9), at(0, 9, 15)),
      evt('mock_evt_2', 'Design review', at(0, 14), at(0, 15), 'demo-evt-standup'),
      evt('mock_evt_3', 'Sprint 14 planning', at(1, 9), at(1, 9, 30)),
    ];
  }

  private async delay(): Promise<void> {
    await new Promise((r) => setTimeout(r, 120));
  }

  /** After the round-trip delay, throw once if armed (mock failure injection). */
  private failIfArmed(): void {
    if (!this.failNext) return;
    this.failNext = false;
    throw new Error('calendar failure (mock)');
  }

  failNextCalendarCall(): void {
    this.failNext = true;
  }

  snapshot(): { events: CalendarEvent[]; responses: Record<string, string> } {
    return { events: this.events.map((e) => ({ ...e })), responses: { ...this.responses } };
  }

  async listEvents(timeMinISO: string, timeMaxISO: string): Promise<CalendarEvent[]> {
    this.callCounts.listEvents = (this.callCounts.listEvents ?? 0) + 1;
    await this.delay();
    this.failIfArmed();
    const min = Date.parse(timeMinISO);
    const max = Date.parse(timeMaxISO);
    return this.events
      .filter((e) => {
        const t = Date.parse(e.startISO);
        return t >= min && t <= max;
      })
      .sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO))
      .map((e) => ({ ...e }));
  }

  async respondToEvent(iCalUID: string, response: RsvpResponse): Promise<void> {
    this.callCounts.respondToEvent = (this.callCounts.respondToEvent ?? 0) + 1;
    await this.delay();
    this.failIfArmed();
    this.responses[iCalUID] = response;
  }

  async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    this.callCounts.createEvent = (this.callCounts.createEvent ?? 0) + 1;
    await this.delay();
    this.failIfArmed();
    const ev: CalendarEvent = {
      id: `mock_evt_created_${Date.now()}`,
      summary: input.summary, startISO: input.startISO, endISO: input.endISO,
      allDay: false, organizer: 'demo@zenmail.app',
    };
    this.events.push(ev);
    return { ...ev };
  }
}
