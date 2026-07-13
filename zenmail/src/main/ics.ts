import type { InviteInfo } from '../shared/types';

export interface IcsFields {
  method?: string;
  uid?: string;
  summary?: string;
  dtstart?: string;
  dtend?: string;
  organizer?: string;
}

/** RFC5545 line unfolding: a line starting with a space or tab continues the previous line. */
export function unfoldIcs(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((l) => l.length > 0);
}

/** Unescape ICS TEXT values: \\, \, \; \n \N \\ */
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Normalize an ICS date value to an ISO string, or undefined when the form is neither
 * UTC (...Z) nor TZID-parameterized. Deliberately supports ONLY these two forms (fail-safe):
 * anything else returns undefined so the invite is dropped rather than mis-dated.
 */
function normalizeDate(value: string, params: string): string | undefined {
  // UTC basic form: 20260714T093000Z
  const utc = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utc) {
    const [, y, mo, d, h, mi, s] = utc;
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
    return Number.isNaN(Date.parse(iso)) ? undefined : iso;
  }
  // TZID form: DTSTART;TZID=Asia/Seoul:20260714T180000
  const tzid = params.match(/TZID=([^;:]+)/);
  const local = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (tzid && local) {
    const [, y, mo, d, h, mi, s] = local;
    // Resolve the wall-clock time in the named zone via Intl, then back-compute the UTC instant.
    try {
      const asUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: tzid[1],
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      });
      const parts = Object.fromEntries(dtf.formatToParts(new Date(asUtc)).map((p) => [p.type, p.value]));
      const seenUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day,
        +(parts.hour === '24' ? '0' : parts.hour), +parts.minute, +parts.second);
      const offset = seenUtc - asUtc; // ms the zone is ahead of UTC
      const instant = asUtc - offset;
      return Number.isNaN(instant) ? undefined : new Date(instant).toISOString();
    } catch {
      return undefined; // unknown TZID etc.
    }
  }
  return undefined;
}

export function parseIcs(raw: string): IcsFields {
  const fields: IcsFields = {};
  for (const line of unfoldIcs(raw)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const semi = left.indexOf(';');
    const name = (semi < 0 ? left : left.slice(0, semi)).toUpperCase();
    const params = semi < 0 ? '' : left.slice(semi + 1);
    switch (name) {
      case 'METHOD': fields.method = value.trim().toUpperCase(); break;
      case 'UID': fields.uid = value.trim(); break;
      case 'SUMMARY': fields.summary = unescapeText(value); break;
      case 'DTSTART': fields.dtstart = normalizeDate(value.trim(), params); break;
      case 'DTEND': fields.dtend = normalizeDate(value.trim(), params); break;
      case 'ORGANIZER': fields.organizer = value.replace(/^mailto:/i, '').trim(); break;
    }
  }
  return fields;
}

/**
 * Build an InviteInfo only for a resolvable METHOD:REQUEST. Any missing/unresolvable required
 * field (method != REQUEST, no uid, no summary, no start) yields undefined — the banner is simply
 * not shown (fail-safe). Never throws.
 */
export function extractInvite(raw: string): InviteInfo | undefined {
  let f: IcsFields;
  try {
    f = parseIcs(raw);
  } catch {
    return undefined;
  }
  if (f.method !== 'REQUEST') return undefined;
  if (!f.uid || !f.summary || !f.dtstart) return undefined;
  return {
    iCalUID: f.uid,
    summary: f.summary,
    startISO: f.dtstart,
    endISO: f.dtend,
    organizer: f.organizer,
    method: 'REQUEST',
  };
}
