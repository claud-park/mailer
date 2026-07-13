# Google Calendar 연동 (calendar-integration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ZenMail 메일 워크플로우 안에서 캘린더의 세 접점(초대 RSVP·이벤트 생성·`g→c` 아젠다 패널)을 처리한다. 캘린더 "뷰"는 만들지 않는다.

**Architecture:** 기존 `GmailProvider` 패턴을 미러링한 `CalendarProvider`(Real/Mock 이원화 + 4-파일 IPC 계약 + 기존 OAuth2Client 재사용)를 신설한다. 초대 감지는 `extractBodies()`의 MIME walk 확장 + main 프로세스 자체 구현 최소 ICS 파서(`src/main/ics.ts`)로 결정적 처리한다. UI는 기존 오버레이 템플릿(SnoozePicker/StatsPanel)과 낙관 5단계 뮤테이션 패턴을 그대로 재사용한다.

**Tech Stack:** Electron 33 + React 19 + TypeScript + Tailwind v4 + zustand + kbar + better-sqlite3, googleapis ^173 (calendar_v3 포함 — 신규 npm 의존성 0), vitest ^2.

## Global Constraints

이 절은 모든 태스크의 요구사항에 암묵적으로 포함된다.

- **신규 npm 의존성 0.** googleapis ^173.0.0에 calendar_v3가 포함되어 있고, ICS 파서는 자체 구현한다. `package.json`에 새 의존성을 추가하지 않는다.
- **No AI (v1).** 이벤트 생성 프리필은 결정적 규칙(제목 접두 제거, 참여자 목록 추출)만. 날짜/시간 추측·자연어 파싱 금지. ICS 파싱도 정규식 기반 결정적 필드 추출이며 AI 요약을 쓰지 않는다.
- **범위 밖 (구현 금지):** 캘린더 뷰(day/week), Compose 가용시간 공유, 반복 일정 편집, 다중 캘린더 선택(primary 고정), ICS `METHOD:CANCEL`/`REPLY` 처리, 오프라인 캐시(F6 큐 미적용), AI 파싱 일체.
- **캘린더 뮤테이션은 F6 뮤테이션 큐(`attemptOrEnqueue`) 비대상.** RSVP/생성 실패는 즉시 롤백+토스트(transient 재시도 없음). 아젠다 fetch 실패는 패널 내 인라인 에러(토스트 아님).
- **calendarReady 게이트는 국소적.** scope 미획득 상태에서도 메일 핵심 기능(읽기/쓰기/라벨/스누즈/검색)은 전혀 영향받지 않는다. 캘린더 기능만 비활성화된다. 데모 모드는 항상 `calendarReady: true`.
- **무회귀 불변식:** 기존 E2E 캐논은 **157 PASS · 0 FAIL · 7 SKIP**. CP6 완료 시 신규 TC-CAL 포함 목표 집계는 **182 PASS · 0 FAIL · 7 SKIP**(신규 SKIP을 만들지 않는다).
- **빌드 주의사항 (해당 항목):** Vite 설정은 `.mts` 확장자 유지(`vite.main.config.mts`/`vite.preload.config.mts`/`vite.renderer.config.mts`). `@vitejs/plugin-react`는 v4(`^4.7.0`) 고정 — 상향 금지. 로컬 `npm install` 필요 시 `--legacy-peer-deps`.
- **커밋 관례:** 한국어, `feat(calendar-integration): CP<n> — <요약>` 스타일. 각 CP 커밋 말미에 무회귀 집계를 병기(예: `... (182 PASS·0 FAIL·7 SKIP)`).
- **검증 게이트:** 각 태스크 종료 시 `npx tsc --noEmit`(zenmail 디렉터리) + `npm test` 통과. 명령은 항상 `zenmail/` 안에서 실행.

---

### Task 1: 최소 ICS 파서 (`src/main/ics.ts`) + vitest (CP1 전반부, TC-CAL-F1~F5)

**Files:**
- Create: `zenmail/src/main/ics.ts`
- Create: `zenmail/src/main/ics.test.ts`
- Modify: `zenmail/src/shared/types.ts` (`InviteInfo` 타입 추가 — 파서 반환 타입)

**Interfaces:**
- Produces:
  - `interface InviteInfo { iCalUID: string; summary: string; startISO: string; endISO?: string; organizer?: string; method: string }` (types.ts에 export)
  - `interface IcsFields { method?: string; uid?: string; summary?: string; dtstart?: string; dtend?: string; organizer?: string }` (ics.ts)
  - `function unfoldIcs(raw: string): string[]`
  - `function parseIcs(raw: string): IcsFields` — `dtstart`/`dtend`는 해석 성공 시 ISO 문자열, 실패 시 `undefined`
  - `function extractInvite(raw: string): InviteInfo | undefined` — `METHOD:REQUEST` + `uid` + `summary` + 해석된 `dtstart`가 모두 있을 때만 InviteInfo, 아니면 `undefined` (fail-safe, throw 금지)

- [ ] **Step 1: `types.ts`에 `InviteInfo` 타입 추가**

`zenmail/src/shared/types.ts`의 `MessageDetail` 인터페이스(29-40행) 바로 위에 추가:

```typescript
export interface InviteInfo {
  /** ICS UID — respondToEvent가 이벤트를 특정하는 키 */
  iCalUID: string;
  summary: string;
  /** ISO 8601 (UTC 또는 TZID 해석 결과) */
  startISO: string;
  endISO?: string;
  /** organizer 이메일 (mailto: 접두 제거) */
  organizer?: string;
  /** 'REQUEST'만 노출 (범위 밖 CANCEL/REPLY는 extractInvite에서 걸러짐) */
  method: string;
}
```

- [ ] **Step 2: 실패 테스트 작성 (`ics.test.ts`) — TC-CAL-F1~F5**

`zenmail/src/main/ics.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { unfoldIcs, parseIcs, extractInvite } from './ics';

const wrap = (lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', ...lines, 'END:VCALENDAR'].join('\r\n');

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
    const raw = wrap(['SUMMARY:Lunch\\, then\\; review\\nagenda', 'UID:u1', 'DTSTART:20260714T090000Z']);
    expect(parseIcs(raw).summary).toBe('Lunch, then; review\nagenda');
  });

  // TC-CAL-F2: DTSTART가 ...Z (UTC)
  it('normalizes a UTC (...Z) DTSTART to ISO', () => {
    const raw = wrap(['UID:u2', 'DTSTART:20260714T093000Z', 'DTEND:20260714T103000Z']);
    const f = parseIcs(raw);
    expect(f.dtstart).toBe('2026-07-14T09:30:00.000Z');
    expect(f.dtend).toBe('2026-07-14T10:30:00.000Z');
  });

  // TC-CAL-F3: DTSTART;TZID=... 파라미터 형식
  it('normalizes a TZID-parameterized DTSTART to ISO', () => {
    const raw = wrap(['UID:u3', 'DTSTART;TZID=Asia/Seoul:20260714T180000']);
    expect(parseIcs(raw).dtstart).toBe(new Date('2026-07-14T18:00:00+09:00').toISOString());
  });

  // TC-CAL-F4: UTC/TZID 어느 것도 아니면 undefined (throw 금지)
  it('returns undefined for an unparseable date form (no throw)', () => {
    const raw = wrap(['UID:u4', 'DTSTART:not-a-date']);
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
    const raw = wrap(['METHOD:CANCEL', 'UID:evt-2', 'SUMMARY:x', 'DTSTART:20260714T090000Z']);
    expect(extractInvite(raw)).toBeUndefined();
  });

  // TC-CAL-F4 (extractInvite 레벨): 날짜 해석 불가면 invite 미노출
  it('returns undefined when the date cannot be resolved (fail-safe)', () => {
    const raw = wrap(['METHOD:REQUEST', 'UID:evt-3', 'SUMMARY:x', 'DTSTART:garbage']);
    expect(extractInvite(raw)).toBeUndefined();
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `cd zenmail && npx vitest run src/main/ics.test.ts`
Expected: FAIL — `Failed to resolve import "./ics"` (모듈 미존재)

- [ ] **Step 4: `ics.ts` 구현**

`zenmail/src/main/ics.ts`:

```typescript
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
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd zenmail && npx vitest run src/main/ics.test.ts`
Expected: PASS (8 tests, TC-CAL-F1~F5 커버)

- [ ] **Step 6: tsc + 전체 test**

Run: `cd zenmail && npx tsc --noEmit && npm test`
Expected: 둘 다 exit 0

- [ ] **Step 7: 커밋**

```bash
cd zenmail && git add src/main/ics.ts src/main/ics.test.ts src/shared/types.ts
git commit -m "feat(calendar-integration): CP1 — 최소 ICS 파서(ics.ts)+extractInvite, vitest TC-CAL-F1~F5"
```

---

### Task 2: 초대 감지 배선 (`gmail.ts` extractBodies 확장 + `MessageDetail.invite` + 데모 초대 메일 시드) (CP1 후반부)

**Files:**
- Modify: `zenmail/src/shared/types.ts` (`MessageDetail`에 `invite?` 필드 추가)
- Modify: `zenmail/src/main/gmail.ts` (extractBodies 59-73, getThread 177-204, buildDemoData 302-526)

**Interfaces:**
- Consumes: `extractInvite(raw: string): InviteInfo | undefined` (Task 1), `InviteInfo` (Task 1)
- Produces:
  - `MessageDetail.invite?: InviteInfo`
  - 데모 스레드 id `demo_cal_1`(2개 메시지 모두 동일 이벤트 REQUEST invite — A1/A3), `demo_cal_2`(해석 불가 ICS — A4). 두 스레드 모두 `INBOX`, 어떤 split 규칙에도 매칭 안 되는 발신자(`events@calendly.example`), 최고령 date로 시드해 기존 split 카운트/순서 무회귀.
  - `demo_cal_1`의 invite `iCalUID: 'demo-evt-standup'`, `summary: 'Sprint 14 planning'`, organizer `ana@linearly.dev`.

- [ ] **Step 1: `types.ts`의 `MessageDetail`에 invite 필드 추가**

`zenmail/src/shared/types.ts`의 `MessageDetail`(29-40행) `labelIds` 아래에 추가:

```typescript
  labelIds: string[];
  /** METHOD:REQUEST ICS가 붙은 메시지에만 존재 (초대 배너용). extractInvite fail-safe로 파싱 실패 시 undefined. */
  invite?: InviteInfo;
```

`import`는 이미 같은 파일 내 타입이므로 불필요.

- [ ] **Step 2: `gmail.ts` — extractBodies가 text/calendar 파트를 수집하도록 확장**

`zenmail/src/main/gmail.ts` 상단 import(2-14행)에 `InviteInfo`는 필요 없고(내부에서 미참조), `extractInvite`만 추가:

```typescript
import { extractInvite } from './ics';
```

`extractBodies`(59-73행)를 아래로 교체 — 반환에 `ics` 문자열 추가:

```typescript
function extractBodies(part: gmail_v1.Schema$MessagePart | undefined): {
  html: string;
  text: string;
  ics: string;
} {
  let html = '';
  let text = '';
  let ics = '';
  const walk = (p: gmail_v1.Schema$MessagePart | undefined) => {
    if (!p) return;
    const mime = (p.mimeType ?? '').toLowerCase();
    if (mime === 'text/html' && p.body?.data) html ||= decodeBody(p.body.data);
    else if (mime === 'text/plain' && p.body?.data) text ||= decodeBody(p.body.data);
    else if ((mime === 'text/calendar' || mime === 'application/ics') && p.body?.data)
      ics ||= decodeBody(p.body.data);
    p.parts?.forEach(walk);
  };
  walk(part);
  return { html, text, ics };
}
```

- [ ] **Step 3: `RealGmailProvider.getThread`가 invite를 노출하도록 수정**

`gmail.ts`의 getThread(188-202행) 메시지 매핑 안에서 `const bodies = extractBodies(m.payload);` 다음, 반환 객체의 `labelIds` 뒤에 추가:

```typescript
        const bodies = extractBodies(m.payload);
        const invite = bodies.ics ? extractInvite(bodies.ics) : undefined;
        return {
          id: m.id!,
          threadId,
          from: parseAddress(header(m, 'From') ?? ''),
          to: parseAddressList(header(m, 'To')),
          cc: parseAddressList(header(m, 'Cc')),
          date: Number(m.internalDate ?? 0),
          snippet: m.snippet ?? '',
          bodyHtml: bodies.html,
          bodyText: bodies.text,
          labelIds: m.labelIds ?? [],
          ...(invite ? { invite } : {}),
        };
```

- [ ] **Step 4: `buildDemoData`에 초대 메일 시드 추가**

`gmail.ts`의 `buildDemoData` 안, intro 스레드 push(511-523행) **다음**, `return { threads, labels, senders };`(525행) **직전**에 추가. 두 ICS 텍스트를 만들고 `extractInvite`로 실제 파서를 태워 invite를 도출(데모도 파서를 실제로 통과 — A4 fail-safe도 진짜로 검증됨):

```typescript
  // calendar-integration: 초대 메일 시드. events@calendly.example 은 어떤 split 규칙에도 매칭되지
  // 않고(도메인/VIP/newsletter 아님), 최고령 date라 기존 split 카운트/순서(F1~F6 E2E)를 건드리지 않는다.
  const inviteFrom: Contact = { name: 'Calendly', email: 'events@calendly.example' };
  const icsRequest = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    'UID:demo-evt-standup', 'SUMMARY:Sprint 14 planning', 'DTSTART:20260716T090000Z',
    'DTEND:20260716T093000Z', 'ORGANIZER;CN=Ana Torres:mailto:ana@linearly.dev',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const inviteA = extractInvite(icsRequest);
  const calId = 'demo_cal_1';
  const calBase = now - 118 * h;
  const calMessages = [0, 1].map((mi) => ({
    id: `${calId}_m${mi}`,
    threadId: calId,
    from: inviteFrom,
    to: [{ name: 'You', email: 'demo@zenmail.app' }],
    cc: [] as Contact[],
    date: calBase + mi * h, // m1이 최신 — A3에서 최신 invite 1건만 노출
    snippet: 'You are invited: Sprint 14 planning',
    bodyHtml: demoBody(['You are invited to Sprint 14 planning.', mi === 1 ? '(Updated time)' : '']),
    bodyText: 'You are invited to Sprint 14 planning.',
    labelIds: ['INBOX'],
    ...(inviteA ? { invite: inviteA } : {}),
  }));
  threads.push({
    summary: {
      id: calId, subject: 'Invitation: Sprint 14 planning', from: inviteFrom,
      snippet: 'You are invited: Sprint 14 planning', date: calMessages[1].date,
      unread: false, labelIds: ['INBOX'], messageCount: 2,
    },
    detail: { id: calId, subject: 'Invitation: Sprint 14 planning', labelIds: ['INBOX'], messages: calMessages },
  });

  // A4: 날짜 해석 불가 ICS — extractInvite가 undefined → invite 미노출(배너 없음), 크래시 없음.
  const icsBad = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    'UID:demo-evt-bad', 'SUMMARY:Broken invite', 'DTSTART:not-a-real-date',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const inviteBad = extractInvite(icsBad); // undefined
  const badId = 'demo_cal_2';
  const badMessage = {
    id: `${badId}_m0`, threadId: badId, from: inviteFrom,
    to: [{ name: 'You', email: 'demo@zenmail.app' }], cc: [] as Contact[],
    date: now - 119 * h, snippet: 'Broken invite', bodyHtml: demoBody(['Broken invite.']),
    bodyText: 'Broken invite.', labelIds: ['INBOX'],
    ...(inviteBad ? { invite: inviteBad } : {}),
  };
  threads.push({
    summary: {
      id: badId, subject: 'Invitation: Broken invite', from: inviteFrom,
      snippet: 'Broken invite', date: badMessage.date, unread: false,
      labelIds: ['INBOX'], messageCount: 1,
    },
    detail: { id: badId, subject: 'Invitation: Broken invite', labelIds: ['INBOX'], messages: [badMessage] },
  });
```

- [ ] **Step 5: tsc + test**

Run: `cd zenmail && npx tsc --noEmit && npm test`
Expected: 둘 다 exit 0 (invite는 선택 필드라 기존 코드 무영향)

- [ ] **Step 6: 커밋**

```bash
cd zenmail && git add src/shared/types.ts src/main/gmail.ts
git commit -m "feat(calendar-integration): CP1 — extractBodies text/calendar 수집+MessageDetail.invite, 데모 초대 메일 시드(demo_cal_1/2)"
```

---

### Task 3: `CalendarProvider` (Real/Mock) + 캘린더 타입 (CP2 전반부)

**Files:**
- Create: `zenmail/src/main/calendar.ts`
- Create: `zenmail/src/main/calendar.test.ts`
- Modify: `zenmail/src/shared/types.ts` (`CalendarEvent`, `CreateEventInput`, `RsvpResponse` 추가)

**Interfaces:**
- Consumes: `Auth.OAuth2Client` (googleapis), `InviteInfo` (Task 1)
- Produces:
  - `type RsvpResponse = 'accepted' | 'tentative' | 'declined'`
  - `interface CalendarEvent { id: string; iCalUID?: string; summary: string; startISO: string; endISO?: string; allDay: boolean; organizer?: string }`
  - `interface CreateEventInput { summary: string; startISO: string; endISO: string; attendees: string[] }`
  - `interface CalendarProvider { readonly demo: boolean; listEvents(timeMinISO: string, timeMaxISO: string): Promise<CalendarEvent[]>; respondToEvent(iCalUID: string, response: RsvpResponse): Promise<void>; createEvent(input: CreateEventInput): Promise<CalendarEvent> }`
  - `class RealCalendarProvider implements CalendarProvider` — 생성자 `(auth: Auth.OAuth2Client, email: string)`
  - `class MockCalendarProvider implements CalendarProvider` — 오늘 2건+내일 1건 시드; `readonly callCounts: Record<string, number>`; `failNextCalendarCall(): void`; `snapshot(): { events: CalendarEvent[]; responses: Record<string, string> }`

- [ ] **Step 1: `types.ts`에 캘린더 타입 추가**

`zenmail/src/shared/types.ts`의 `InviteInfo`(Task 1에서 추가) 아래에:

```typescript
export type RsvpResponse = 'accepted' | 'tentative' | 'declined';

export interface CalendarEvent {
  id: string;
  iCalUID?: string;
  summary: string;
  /** ISO 8601 시작 */
  startISO: string;
  endISO?: string;
  allDay: boolean;
  organizer?: string;
}

export interface CreateEventInput {
  summary: string;
  /** ISO 8601 */
  startISO: string;
  endISO: string;
  /** 참석자 이메일 목록 (본인 제외) */
  attendees: string[];
}
```

- [ ] **Step 2: `MockCalendarProvider` 실패 테스트 작성 (`calendar.test.ts`)**

`MockCalendarProvider`는 순수 TS(electron/window 미참조)라 vitest 가능. `RealCalendarProvider`는 googleapis 실호출이라 E2E(데모 Mock)로 검증.

`zenmail/src/main/calendar.test.ts`:

```typescript
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
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd zenmail && npx vitest run src/main/calendar.test.ts`
Expected: FAIL — `Failed to resolve import "./calendar"`

- [ ] **Step 4: `calendar.ts` 구현**

`zenmail/src/main/calendar.ts`:

```typescript
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
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd zenmail && npx vitest run src/main/calendar.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: tsc + test**

Run: `cd zenmail && npx tsc --noEmit && npm test`
Expected: 둘 다 exit 0

- [ ] **Step 7: 커밋**

```bash
cd zenmail && git add src/main/calendar.ts src/main/calendar.test.ts src/shared/types.ts
git commit -m "feat(calendar-integration): CP2 — CalendarProvider(Real/Mock)+CalendarEvent/CreateEventInput 타입, MockCalendarProvider vitest"
```

---

### Task 4: OAuth scope + calendarReady + IPC 4-파일 계약 + `__debug` 훅 (CP2 후반부)

**Files:**
- Modify: `zenmail/src/main/auth.ts` (SCOPES 12-17, getAuthorizedClient 158-173)
- Modify: `zenmail/src/shared/types.ts` (`AccountInfo`, `ZenmailApi`)
- Modify: `zenmail/src/main/ipc.ts` (provider 상태 24, restoreSession 49-56, auth 핸들러 123-139, 신규 핸들러, __debug 454-503)
- Modify: `zenmail/src/main/preload.ts` (api 13-76, e2e 게이트 79-91)

**Interfaces:**
- Consumes: `RealCalendarProvider`/`MockCalendarProvider`/`CalendarProvider` (Task 3), `CalendarEvent`/`CreateEventInput`/`RsvpResponse` (Task 3)
- Produces (renderer가 소비하는 IPC 계약 — 이름 고정):
  - `AccountInfo.calendarReady: boolean`
  - `ZenmailApi.listEvents(timeMinISO: string, timeMaxISO: string): Promise<CalendarEvent[]>`
  - `ZenmailApi.respondToEvent(iCalUID: string, response: RsvpResponse): Promise<void>`
  - `ZenmailApi.createEvent(input: CreateEventInput): Promise<CalendarEvent>`
  - `ZenmailApi.__debugCalendarState?(): Promise<{ events: CalendarEvent[]; responses: Record<string, string> }>`
  - `ZenmailApi.__debugFailNextCalendar?(): Promise<void>`
  - `ZenmailApi.__debugSetCalendarReady?(v: boolean): Promise<void>`
  - IPC 채널: `calendar:list-events`, `calendar:respond`, `calendar:create`, `calendar:debug-state`, `calendar:debug-fail-next`, `calendar:debug-set-ready`

- [ ] **Step 1: `auth.ts` — SCOPES에 calendar.events 추가**

`zenmail/src/main/auth.ts` SCOPES(12-17행) 마지막 항목 뒤에:

```typescript
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/calendar.events',
];
```

- [ ] **Step 2: `auth.ts` — getAuthorizedClient가 calendarReady를 반환**

`getAuthorizedClient`(158-173행)의 반환 타입과 반환문을 수정:

```typescript
export async function getAuthorizedClient(): Promise<{
  client: OAuth2Client;
  email: string;
  calendarReady: boolean;
} | null> {
  const email = getStoredEmail();
  if (!email) return null;
  const raw = await store.get(email);
  if (!raw) return null;
  const client = newOAuthClient();
  let current = JSON.parse(raw) as Credentials;
  // 저장 토큰의 scope 문자열에 calendar.events 포함 여부 → calendarReady (강제 무효화 없음).
  const calendarReady = typeof current.scope === 'string' && current.scope.includes('calendar.events');
  client.setCredentials(current);
  client.on('tokens', (tokens) => {
    current = { ...current, ...tokens };
    void store.set(email, JSON.stringify(current));
  });
  return { client, email, calendarReady };
}
```

- [ ] **Step 3: `types.ts` — AccountInfo + ZenmailApi 확장**

`AccountInfo`(103-106행)를:

```typescript
export interface AccountInfo {
  email: string;
  demo: boolean;
  /** calendar.events scope 보유 여부. false면 캘린더 기능만 비활성(메일 무영향). 데모는 항상 true. */
  calendarReady: boolean;
}
```

`ZenmailApi`(136행~) 안, `listFollowups` 아래(159행 뒤)에 캘린더 API 추가:

```typescript
  listEvents(timeMinISO: string, timeMaxISO: string): Promise<CalendarEvent[]>;
  respondToEvent(iCalUID: string, response: RsvpResponse): Promise<void>;
  createEvent(input: CreateEventInput): Promise<CalendarEvent>;
```

`ZenmailApi`의 `__debug` 블록(199행 `__debugProviderCalls` 뒤)에:

```typescript
  /** E2E-only: mock 캘린더 상태 스냅샷(시드 이벤트 + 기록된 RSVP 응답). */
  __debugCalendarState?(): Promise<{ events: CalendarEvent[]; responses: Record<string, string> }>;
  /** E2E-only: 다음 calendar:* 호출 1회를 실패시킴(one-shot). */
  __debugFailNextCalendar?(): Promise<void>;
  /** E2E-only: 데모 세션의 calendarReady 게이트 시뮬레이션(재시작/재로그인 전까지 유지). */
  __debugSetCalendarReady?(v: boolean): Promise<void>;
```

`CalendarEvent`/`CreateEventInput`/`RsvpResponse`는 이미 같은 파일에 정의됨(Task 3) — import 불필요.

- [ ] **Step 4: `ipc.ts` — 캘린더 provider 상태 + 헬퍼 + calendarReady 배선**

`ipc.ts` import(3-19행)에 추가:

```typescript
import { MockCalendarProvider, RealCalendarProvider, type CalendarProvider } from './calendar';
import type { CalendarEvent, CreateEventInput, RsvpResponse } from '../shared/types';
```
(`CreateEventInput` 등은 기존 type import 블록에 병합 가능.)

`let provider: GmailProvider | null = null;`(24행) 아래에:

```typescript
let calendarProvider: CalendarProvider | null = null;
/** 현재 세션의 실제 calendar.events scope 보유 여부(데모는 true). */
let calendarReady = false;
/** E2E-only: 데모에서 calendarReady 게이트를 강제로 덮어씀(null이면 계산값 사용). */
let debugCalendarReady: boolean | null = null;

function currentCalendarReady(demo: boolean): boolean {
  if (debugCalendarReady !== null) return debugCalendarReady;
  return demo ? true : calendarReady;
}

function requireCalendarProvider(): CalendarProvider {
  if (!calendarProvider) throw new Error('Not signed in (calendar)');
  return calendarProvider;
}
```

`restoreSession`(49-56행)을:

```typescript
async function restoreSession(): Promise<AccountInfo | null> {
  const session = await auth.getAuthorizedClient();
  if (session) {
    provider = new RealGmailProvider(session.client, session.email);
    calendarProvider = new RealCalendarProvider(session.client, session.email);
    calendarReady = session.calendarReady;
    return { email: session.email, demo: false, calendarReady: currentCalendarReady(false) };
  }
  return null;
}
```

`auth:get-account` 핸들러(123-126행)를:

```typescript
  ipcMain.handle('auth:get-account', async (): Promise<AccountInfo | null> => {
    if (provider) return { email: provider.email, demo: provider.demo, calendarReady: currentCalendarReady(provider.demo) };
    return restoreSession();
  });
```

`auth:sign-in` 핸들러(128-134행)를:

```typescript
  ipcMain.handle('auth:sign-in', async (): Promise<AccountInfo> => {
    const email = await auth.signIn();
    const session = await auth.getAuthorizedClient();
    if (!session) throw new Error('Sign-in did not persist a session');
    provider = new RealGmailProvider(session.client, email);
    calendarProvider = new RealCalendarProvider(session.client, email);
    calendarReady = session.calendarReady;
    return { email, demo: false, calendarReady: currentCalendarReady(false) };
  });
```

`auth:sign-in-demo` 핸들러(136-139행)를:

```typescript
  ipcMain.handle('auth:sign-in-demo', async (): Promise<AccountInfo> => {
    provider = new MockGmailProvider();
    calendarProvider = new MockCalendarProvider();
    calendarReady = true;
    debugCalendarReady = null; // 새 데모 세션은 게이트 오버라이드를 초기화(E3 재로그인 복귀)
    return { email: provider.email, demo: true, calendarReady: true };
  });
```

`auth:sign-out` 핸들러(141-145행) 안 `provider = null;` 아래에:

```typescript
    provider = null;
    calendarProvider = null;
    calendarReady = false;
    cache.clearFollowups();
```

- [ ] **Step 5: `ipc.ts` — 캘린더 IPC 핸들러 3종**

`registerIpc` 안, `mail:renderer-online` 핸들러(448-451행) **뒤**, `if (process.env.ZENMAIL_E2E_PORT) {`(454행) **앞**에:

```typescript
  ipcMain.handle('calendar:list-events', async (_e, timeMinISO: string, timeMaxISO: string): Promise<CalendarEvent[]> => {
    return requireCalendarProvider().listEvents(timeMinISO, timeMaxISO);
  });

  ipcMain.handle('calendar:respond', async (_e, iCalUID: string, response: RsvpResponse): Promise<void> => {
    await requireCalendarProvider().respondToEvent(iCalUID, response);
  });

  ipcMain.handle('calendar:create', async (_e, input: CreateEventInput): Promise<CalendarEvent> => {
    return requireCalendarProvider().createEvent(input);
  });
```

- [ ] **Step 6: `ipc.ts` — E2E `__debug` 훅 3종**

`if (process.env.ZENMAIL_E2E_PORT) {` 블록 안(예: `mail:debug-provider-calls` 핸들러 499-502행 뒤, 닫는 `}` 앞)에:

```typescript
    ipcMain.handle('calendar:debug-state', async (): Promise<{ events: CalendarEvent[]; responses: Record<string, string> }> => {
      if (calendarProvider instanceof MockCalendarProvider) return calendarProvider.snapshot();
      return { events: [], responses: {} };
    });

    ipcMain.handle('calendar:debug-fail-next', async () => {
      if (calendarProvider instanceof MockCalendarProvider) calendarProvider.failNextCalendarCall();
    });

    // 데모 calendarReady 게이트 시뮬레이션. 렌더러가 다음 auth:get-account(재시작/재로그인)에서 읽는다.
    ipcMain.handle('calendar:debug-set-ready', async (_e, v: boolean) => {
      debugCalendarReady = v;
    });
```

- [ ] **Step 7: `preload.ts` — API + debug 훅 노출**

`preload.ts` import(2-11행)에 타입 추가:

```typescript
import type {
  CalendarEvent,
  CreateEventInput,
  FetchThreadsRequest,
  ModifyLabelsRequest,
  RsvpResponse,
  SendRequest,
  SnoozeRequest,
  SplitDefinition,
  ThreadDetail,
  ThreadSummary,
  ZenmailApi,
} from '../shared/types';
```

`api` 객체 안, `listFollowups`(37행) 아래에:

```typescript
  listEvents: (timeMinISO: string, timeMaxISO: string) =>
    ipcRenderer.invoke('calendar:list-events', timeMinISO, timeMaxISO),
  respondToEvent: (iCalUID: string, response: RsvpResponse) =>
    ipcRenderer.invoke('calendar:respond', iCalUID, response),
  createEvent: (input: CreateEventInput) => ipcRenderer.invoke('calendar:create', input),
```

`if (process.argv.includes('--zenmail-e2e')) {` 블록(79-91행) 안, `__debugProviderCalls`(90행) 뒤에:

```typescript
  api.__debugCalendarState = () => ipcRenderer.invoke('calendar:debug-state');
  api.__debugFailNextCalendar = () => ipcRenderer.invoke('calendar:debug-fail-next');
  api.__debugSetCalendarReady = (v: boolean) => ipcRenderer.invoke('calendar:debug-set-ready', v);
```

`CalendarEvent`가 preload에서 값으로 쓰이진 않지만 타입 참조로 필요 → import에 포함됨(위).

- [ ] **Step 8: tsc + test**

Run: `cd zenmail && npx tsc --noEmit && npm test`
Expected: 둘 다 exit 0. (`AccountInfo`에 `calendarReady` 필수 필드 추가로 컴파일 에러가 나면, 이 태스크에서 만든 3개 반환 지점 외에 누락이 없는지 확인 — restoreSession/get-account/sign-in/sign-in-demo 4곳 모두 채워져 있어야 함.)

- [ ] **Step 9: 커밋**

```bash
cd zenmail && git add src/main/auth.ts src/shared/types.ts src/main/ipc.ts src/main/preload.ts
git commit -m "feat(calendar-integration): CP2 — calendar.events scope+calendarReady 게이트, IPC 4파일(calendar:*)+__debug 훅"
```

---

### Task 5: RSVP 배너 + 스토어 액션 (낙관 5단계) (CP3)

**Files:**
- Modify: `zenmail/src/renderer/store/mail.ts` (MailState 40-146, 초기값 235-269, 액션 추가)
- Modify: `zenmail/src/renderer/components/ThreadView.tsx` (FollowupBanner 178-212, ThreadView 214-264)

**Interfaces:**
- Consumes: `api().respondToEvent(iCalUID, response)`, `AccountInfo.calendarReady`, `MessageDetail.invite`, `RsvpResponse` (Task 1/3/4), `instrument`/`recordRollback` (기존 `./latency`)
- Produces (Task 6/7/8이 소비하는 이름 — 고정):
  - `MailState.rsvpStatus: Map<string, RsvpResponse>`
  - `MailState.respondToInvite(iCalUID: string, response: RsvpResponse): Promise<void>`
  - `const CALENDAR_REAUTH_MSG = '캘린더 권한 필요 — 다시 로그인'` (mail.ts에서 export)

- [ ] **Step 1: `mail.ts` — 타입 import + 상수 + 상태 필드 선언**

`mail.ts` 상단 타입 import(2-11행)에 `RsvpResponse` 추가:

```typescript
import {
  type AccountInfo,
  type FollowupInfo,
  type Label,
  type RsvpResponse,
  type SendRequest,
  type SnippetRecord,
  type SplitDefinition,
  type ThreadDetail,
  type ThreadSummary,
} from '../../shared/types';
```

`const DAY_MS = 86_400_000;`(20행) 아래에:

```typescript
export const CALENDAR_REAUTH_MSG = '캘린더 권한 필요 — 다시 로그인';
```

`MailState` 인터페이스(40행~)의 상태 그룹, `theme`(75행) 아래에:

```typescript
  /** iCalUID → 현재 RSVP 응답 상태(낙관 반영). 초대 배너가 읽는다. */
  rsvpStatus: Map<string, RsvpResponse>;
```

`MailState`의 액션 선언부, `showToast(msg: string): void;`(142행) 아래에:

```typescript
  respondToInvite(iCalUID: string, response: RsvpResponse): Promise<void>;
```

- [ ] **Step 2: `mail.ts` — 초기값 + 액션 구현**

초기 상태(`theme: 'light',` 269행) 아래에:

```typescript
    rsvpStatus: new Map(),
```

`showToast`(879-884행) 액션 **뒤**에 새 액션 추가:

```typescript
    async respondToInvite(iCalUID, response) {
      if (!get().account?.calendarReady) {
        get().showToast(CALENDAR_REAUTH_MSG);
        return;
      }
      const done = instrument('rsvp');
      const previous = get().rsvpStatus.get(iCalUID);
      set((st) => {
        const rsvpStatus = new Map(st.rsvpStatus);
        rsvpStatus.set(iCalUID, response);
        return { rsvpStatus };
      });
      done();
      try {
        await api().respondToEvent(iCalUID, response);
      } catch (err) {
        console.error('respondToInvite failed', err);
        set((st) => {
          const rsvpStatus = new Map(st.rsvpStatus);
          if (previous) rsvpStatus.set(iCalUID, previous);
          else rsvpStatus.delete(iCalUID);
          return { rsvpStatus };
        });
        recordRollback('rsvp');
        get().showToast('RSVP failed — restored');
      }
    },
```

- [ ] **Step 3: `ThreadView.tsx` — InviteBanner 컴포넌트 추가**

`ThreadView.tsx` import(1-4행)에 타입 추가:

```typescript
import { useMailStore, quoteHtml, CALENDAR_REAUTH_MSG } from '../store/mail';
import type { MessageDetail, InviteInfo, RsvpResponse } from '../../shared/types';
```

`FollowupBanner` 컴포넌트(178-212행) **뒤**에:

```typescript
const RSVP_LABEL: Record<RsvpResponse, string> = {
  accepted: '수락됨',
  tentative: '미정',
  declined: '거절됨',
};

function InviteBanner({ invite }: { invite: InviteInfo }) {
  const status = useMailStore((s) => s.rsvpStatus.get(invite.iCalUID));
  const calendarReady = useMailStore((s) => s.account?.calendarReady ?? false);
  const respondToInvite = useMailStore((s) => s.respondToInvite);
  const showToast = useMailStore((s) => s.showToast);

  const when = new Date(invite.startISO).toLocaleString([], {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  const onRespond = (r: RsvpResponse) => {
    if (!calendarReady) { showToast(CALENDAR_REAUTH_MSG); return; }
    void respondToInvite(invite.iCalUID, r);
  };

  const btns: { r: RsvpResponse; label: string }[] = [
    { r: 'accepted', label: '수락' },
    { r: 'tentative', label: '미정' },
    { r: 'declined', label: '거절' },
  ];

  return (
    <div
      data-testid="invite-banner"
      className="flex items-center justify-between gap-3 border-b border-bg-border/60 bg-accent/10 px-6 py-2 text-[12px]"
    >
      <div className="min-w-0">
        <span className="font-medium text-text-primary">{invite.summary}</span>
        <span className="ml-2 text-text-muted">{when}</span>
        {invite.organizer && <span className="ml-2 text-text-muted">· {invite.organizer}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {status && <span className="mr-1 text-[11px] text-accent" data-testid="rsvp-status">응답: {RSVP_LABEL[status]}</span>}
        {btns.map((b) => (
          <button
            key={b.r}
            aria-label={b.label}
            onClick={() => onRespond(b.r)}
            className={`rounded px-2 py-0.5 text-[11px] font-medium ${
              status === b.r ? 'bg-accent text-white' : 'bg-bg-border text-text-secondary hover:text-text-primary'
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 스레드 내 invite가 여러 건이면 가장 최신 메시지의 invite 1건만 (동일 이벤트 업데이트 재전송). */
function latestInvite(messages: MessageDetail[]): InviteInfo | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].invite) return messages[i].invite;
  }
  return undefined;
}
```

- [ ] **Step 4: `ThreadView.tsx` — 배너를 FollowupBanner 자리에 렌더**

`ThreadView`(214-264행) 반환부의 `{activeThreadId && <FollowupBanner threadId={activeThreadId} />}`(237행)를:

```typescript
      {activeThreadId && <FollowupBanner threadId={activeThreadId} />}
      {(() => {
        const invite = latestInvite(activeThread.messages);
        return invite ? <InviteBanner invite={invite} /> : null;
      })()}
```

- [ ] **Step 5: tsc + test**

Run: `cd zenmail && npx tsc --noEmit && npm test`
Expected: 둘 다 exit 0

- [ ] **Step 6: 수동 확인 (데모)**

Run: `cd zenmail && npm start` → "Continue in demo mode" → "Invitation: Sprint 14 planning" 스레드 열기.
Expected: 헤더 아래·스크롤 영역 위에 배너(제목 `Sprint 14 planning` + 일시 + `ana@linearly.dev`), [수락]/[미정]/[거절] 버튼. 클릭 시 즉시 `응답: 수락됨` 표시. "Invitation: Broken invite" 스레드에는 배너 없음(크래시 없음). 확인 후 종료.

- [ ] **Step 7: 커밋**

```bash
cd zenmail && git add src/renderer/store/mail.ts src/renderer/components/ThreadView.tsx
git commit -m "feat(calendar-integration): CP3 — RSVP 배너(ThreadView)+respondToInvite 낙관 5단계+calendarReady 가드"
```

---

### Task 6: 아젠다 패널 (`g→c`) + 오버레이 + useKeyboard guard (CP4)

**Files:**
- Create: `zenmail/src/renderer/components/AgendaPanel.tsx`
- Modify: `zenmail/src/renderer/store/mail.ts` (상태 + open/close/fetch 액션)
- Modify: `zenmail/src/renderer/components/CommandPalette.tsx` (액션 배열 53-160)
- Modify: `zenmail/src/renderer/hooks/useKeyboard.ts` (modal guard 63-72, Esc-close 73-78)
- Modify: `zenmail/src/renderer/App.tsx` (오버레이 마운트 42-53)

**Interfaces:**
- Consumes: `api().listEvents(timeMinISO, timeMaxISO)`, `CalendarEvent` (Task 4), `CALENDAR_REAUTH_MSG` (Task 5)
- Produces:
  - `MailState.agendaOpen: boolean`, `agendaEvents: CalendarEvent[]`, `agendaLoading: boolean`, `agendaError: string | null`
  - `MailState.openAgenda(): Promise<void>`, `closeAgenda(): void`

- [ ] **Step 1: `mail.ts` — CalendarEvent import + 상태/액션 선언**

`mail.ts` 타입 import(2-11행)에 `CalendarEvent` 추가:

```typescript
  type CalendarEvent,
```
(알파벳 순 유지: `type AccountInfo,` 다음 줄에 배치.)

`MailState`의 `rsvpStatus`(Task 5에서 추가) 아래에:

```typescript
  agendaOpen: boolean;
  agendaEvents: CalendarEvent[];
  agendaLoading: boolean;
  agendaError: string | null;
```

`MailState` 액션 선언부, `respondToInvite(...)` (Task 5) 아래에:

```typescript
  openAgenda(): Promise<void>;
  closeAgenda(): void;
```

- [ ] **Step 2: `mail.ts` — 초기값 + 액션 구현 + 날짜 범위 헬퍼**

`escapeHtml`(188-190행) 근처 최상위 헬퍼 영역(파일 상단, `quoteHtml` export 아래 202행 뒤)에:

```typescript
/** 아젠다 범위: 오늘 00:00 ~ 내일 24:00(모레 00:00). */
function agendaRange(): { timeMinISO: string; timeMaxISO: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 2 * DAY_MS);
  return { timeMinISO: start.toISOString(), timeMaxISO: end.toISOString() };
}
```

초기 상태(`rsvpStatus: new Map(),` Task 5) 아래에:

```typescript
    agendaOpen: false,
    agendaEvents: [],
    agendaLoading: false,
    agendaError: null,
```

`respondToInvite`(Task 5) 액션 **뒤**에:

```typescript
    async openAgenda() {
      if (!get().account?.calendarReady) {
        get().showToast(CALENDAR_REAUTH_MSG);
        return;
      }
      set({ agendaOpen: true, agendaLoading: true, agendaError: null, agendaEvents: [] });
      const { timeMinISO, timeMaxISO } = agendaRange();
      try {
        const events = await api().listEvents(timeMinISO, timeMaxISO);
        if (!get().agendaOpen) return; // 닫힌 뒤 도착한 응답 무시
        set({ agendaEvents: events, agendaLoading: false });
      } catch (err) {
        console.error('listEvents failed', err);
        if (!get().agendaOpen) return;
        set({ agendaError: '일정을 불러오지 못했어요', agendaLoading: false });
      }
    },

    closeAgenda() {
      set({ agendaOpen: false });
    },
```

- [ ] **Step 3: `AgendaPanel.tsx` 생성 (SnoozePicker 오버레이 템플릿)**

`zenmail/src/renderer/components/AgendaPanel.tsx`:

```typescript
import { useEffect, useRef } from 'react';
import { useMailStore } from '../store/mail';
import type { CalendarEvent } from '../../shared/types';

function eventTime(e: CalendarEvent): string {
  if (e.allDay) return '종일';
  return new Date(e.startISO).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(e: CalendarEvent): string {
  const d = new Date(e.startISO);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  return isToday ? '오늘' : '내일';
}

export function AgendaPanel() {
  const open = useMailStore((s) => s.agendaOpen);
  const close = useMailStore((s) => s.closeAgenda);
  const events = useMailStore((s) => s.agendaEvents);
  const loading = useMailStore((s) => s.agendaLoading);
  const error = useMailStore((s) => s.agendaError);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50" onClick={close}>
      <div
        ref={panelRef}
        tabIndex={-1}
        data-testid="agenda-panel"
        className="zen-fade-in max-h-[70vh] w-80 overflow-y-auto rounded-lg border border-bg-border bg-bg-subtle p-2 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          e.stopPropagation();
        }}
      >
        <div className="px-2 py-1.5 text-[11px] font-semibold tracking-wider text-text-muted uppercase">
          오늘 · 내일 일정
        </div>
        {loading && <div className="px-2 py-3 text-[13px] text-text-muted">일정 불러오는 중…</div>}
        {error && <div data-testid="agenda-error" className="px-2 py-3 text-[13px] text-red-500">{error}</div>}
        {!loading && !error && events.length === 0 && (
          <div className="px-2 py-3 text-[13px] text-text-muted">예정된 일정이 없어요</div>
        )}
        {!loading && !error &&
          events.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-[13px]">
              <span className="min-w-0 truncate text-text-primary">{e.summary}</span>
              <span className="shrink-0 text-[11px] text-text-muted">
                {dayLabel(e)} {eventTime(e)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `CommandPalette.tsx` — `g→c` 액션 등록**

`CommandPalette.tsx` actions 배열의 Navigation 섹션, `labelJump`(111행) 뒤에:

```typescript
      { id: 'agenda', name: 'Open agenda', shortcut: ['g', 'c'], section: 'Navigation', perform: () => s().openAgenda() },
```

- [ ] **Step 5: `useKeyboard.ts` — modal guard 배열 + Esc-close 두 곳에 agendaOpen 등록**

`useKeyboard.ts` modal guard 조건(63-72행)에 `s.agendaOpen ||` 추가:

```typescript
      if (
        s.composeInit ||
        s.snoozePickerOpen ||
        s.labelPickerOpen ||
        s.splitSettingsOpen ||
        s.snippetsOpen ||
        s.followupPickerOpen ||
        s.agendaOpen ||
        coach.cheatSheetOpen ||
        coach.statsOpen
      ) {
```

Esc-close 블록(73-78행)에 `s.closeAgenda()` 추가:

```typescript
        if (e.key === 'Escape') {
          s.closeSnoozePicker();
          s.closeLabelPicker();
          if (s.agendaOpen) s.closeAgenda();
          if (coach.cheatSheetOpen) coach.closeCheatSheet();
          if (coach.statsOpen) coach.closeStats();
        }
```

- [ ] **Step 6: `App.tsx` — AgendaPanel 마운트**

`App.tsx` import(11행 근처)에:

```typescript
import { AgendaPanel } from './components/AgendaPanel';
```

`Shell`의 `<SnoozePicker />`(43행) 아래에:

```typescript
      <AgendaPanel />
```

- [ ] **Step 7: tsc + test**

Run: `cd zenmail && npx tsc --noEmit && npm test`
Expected: 둘 다 exit 0

- [ ] **Step 8: 수동 확인 (데모)**

Run: `cd zenmail && npm start` → 데모 로그인 → 본문 포커스에서 `g` 후 `c`.
Expected: 아젠다 오버레이가 열리고 오늘 2건(Standup, Design review) + 내일 1건(Sprint 14 planning). 오버레이가 열린 동안 `e`(아카이브) 눌러도 아무 일 없음(guard). `Esc`로 닫힘. 확인 후 종료.

- [ ] **Step 9: 커밋**

```bash
cd zenmail && git add src/renderer/components/AgendaPanel.tsx src/renderer/store/mail.ts src/renderer/components/CommandPalette.tsx src/renderer/hooks/useKeyboard.ts src/renderer/App.tsx
git commit -m "feat(calendar-integration): CP4 — 아젠다 패널(g→c)+listEvents live fetch, useKeyboard guard 두 곳 등록"
```

---

### Task 7: 이벤트 생성 폼 (`EventComposer`) + kbar 액션 + 규칙 프리필 (CP5)

**Files:**
- Create: `zenmail/src/renderer/components/EventComposer.tsx`
- Modify: `zenmail/src/renderer/store/mail.ts` (상태 + open/close/create 액션)
- Modify: `zenmail/src/renderer/components/CommandPalette.tsx` (액션 배열)
- Modify: `zenmail/src/renderer/hooks/useKeyboard.ts` (modal guard + Esc-close)
- Modify: `zenmail/src/renderer/App.tsx` (마운트)

**Interfaces:**
- Consumes: `api().createEvent(input)`, `CreateEventInput`/`CalendarEvent` (Task 4), `CALENDAR_REAUTH_MSG` (Task 5), `targetThreadId` (mail.ts 내부 헬퍼 184-186)
- Produces:
  - `MailState.eventComposerOpen: boolean`
  - `MailState.openEventComposer(): void`, `closeEventComposer(): void`
  - `MailState.createCalendarEvent(input: CreateEventInput): Promise<boolean>`

- [ ] **Step 1: `mail.ts` — CreateEventInput import + 상태/액션 선언**

`mail.ts` 타입 import에 `CreateEventInput` 추가(알파벳 순, `CalendarEvent` 다음):

```typescript
  type CreateEventInput,
```

`MailState`의 `agendaError`(Task 6) 아래에:

```typescript
  eventComposerOpen: boolean;
```

액션 선언부, `closeAgenda()` (Task 6) 아래에:

```typescript
  openEventComposer(): void;
  closeEventComposer(): void;
  createCalendarEvent(input: CreateEventInput): Promise<boolean>;
```

- [ ] **Step 2: `mail.ts` — 초기값 + 액션 구현**

초기 상태(`agendaError: null,` Task 6) 아래에:

```typescript
    eventComposerOpen: false,
```

`closeAgenda`(Task 6) 액션 **뒤**에:

```typescript
    openEventComposer() {
      const s = get();
      if (!targetThreadId(s)) return; // 스레드 선택 컨텍스트 필요 (targetThreadId 가드)
      if (!s.account?.calendarReady) {
        s.showToast(CALENDAR_REAUTH_MSG);
        return;
      }
      set({ eventComposerOpen: true });
    },

    closeEventComposer() {
      set({ eventComposerOpen: false });
    },

    async createCalendarEvent(input) {
      if (!get().account?.calendarReady) {
        get().showToast(CALENDAR_REAUTH_MSG);
        return false;
      }
      try {
        await api().createEvent(input);
      } catch (err) {
        console.error('createEvent failed', err);
        get().showToast('이벤트 생성 실패');
        return false; // 폼은 열린 채 유지(입력 보존)
      }
      set({ eventComposerOpen: false });
      get().showToast('이벤트가 생성됐어요');
      return true;
    },
```

- [ ] **Step 3: `EventComposer.tsx` 생성 (오버레이 템플릿 + 규칙 프리필)**

`zenmail/src/renderer/components/EventComposer.tsx`:

```typescript
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMailStore } from '../store/mail';
import type { ThreadDetail } from '../../shared/types';

/** Re:/Fwd: 접두를 (반복까지) 제거. */
function stripSubjectPrefix(subject: string): string {
  return subject.replace(/^((re|fwd):\s*)+/i, '').trim();
}

/** 스레드 참여자 이메일(from/to/cc) 중복 제거 + 본인 제외. */
function threadAttendees(detail: ThreadDetail | null, me: string | undefined): string[] {
  if (!detail) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of detail.messages) {
    for (const c of [m.from, ...m.to, ...m.cc]) {
      const email = c.email.toLowerCase();
      if (!email || email === me?.toLowerCase() || seen.has(email)) continue;
      seen.add(email);
      out.push(c.email);
    }
  }
  return out;
}

export function EventComposer() {
  const open = useMailStore((s) => s.eventComposerOpen);
  const close = useMailStore((s) => s.closeEventComposer);
  const create = useMailStore((s) => s.createCalendarEvent);
  const activeThread = useMailStore((s) => s.activeThread);
  const me = useMailStore((s) => s.account?.email);
  const panelRef = useRef<HTMLDivElement>(null);

  const prefillSummary = useMemo(() => stripSubjectPrefix(activeThread?.subject ?? ''), [activeThread]);
  const prefillAttendees = useMemo(() => threadAttendees(activeThread, me).join(', '), [activeThread, me]);

  const [summary, setSummary] = useState(prefillSummary);
  const [attendees, setAttendees] = useState(prefillAttendees);
  const [start, setStart] = useState(''); // datetime-local, 사용자 입력 필수 (No AI)
  const [end, setEnd] = useState('');
  const [saving, setSaving] = useState(false);

  // 폼이 열릴 때마다 현재 스레드로 프리필 재설정
  useEffect(() => {
    if (open) {
      setSummary(prefillSummary);
      setAttendees(prefillAttendees);
      setStart('');
      setEnd('');
      panelRef.current?.focus();
    }
  }, [open, prefillSummary, prefillAttendees]);

  if (!open) return null;

  const canCreate = !!summary.trim() && !!start && !saving;

  const submit = async () => {
    if (!canCreate) return;
    const startISO = new Date(start).toISOString();
    const endISO = end ? new Date(end).toISOString() : new Date(new Date(start).getTime() + 30 * 60_000).toISOString();
    setSaving(true);
    try {
      await create({
        summary: summary.trim(),
        startISO,
        endISO,
        attendees: attendees.split(',').map((s) => s.trim()).filter(Boolean),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50" onClick={close}>
      <div
        ref={panelRef}
        tabIndex={-1}
        data-testid="event-composer"
        className="zen-fade-in w-96 rounded-lg border border-bg-border bg-bg-subtle p-3 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          e.stopPropagation();
        }}
      >
        <div className="px-1 py-1 text-[11px] font-semibold tracking-wider text-text-muted uppercase">
          이벤트 만들기
        </div>
        <label className="mt-1 block text-[11px] text-text-muted">제목</label>
        <input
          aria-label="Event summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="mb-2 w-full rounded border border-bg-border bg-bg px-2 py-1 text-[13px] text-text-primary"
        />
        <label className="block text-[11px] text-text-muted">참석자</label>
        <input
          aria-label="Event attendees"
          value={attendees}
          onChange={(e) => setAttendees(e.target.value)}
          className="mb-2 w-full rounded border border-bg-border bg-bg px-2 py-1 text-[13px] text-text-primary"
        />
        <label className="block text-[11px] text-text-muted">시작</label>
        <input
          aria-label="Event start"
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="mb-2 w-full rounded border border-bg-border bg-bg px-2 py-1 text-[13px] text-text-primary"
        />
        <label className="block text-[11px] text-text-muted">종료 (선택)</label>
        <input
          aria-label="Event end"
          type="datetime-local"
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          className="mb-3 w-full rounded border border-bg-border bg-bg px-2 py-1 text-[13px] text-text-primary"
        />
        <div className="flex justify-end gap-2">
          <button onClick={close} className="rounded px-3 py-1 text-[12px] text-text-secondary hover:text-text-primary">
            취소
          </button>
          <button
            aria-label="Create event"
            disabled={!canCreate}
            onClick={() => void submit()}
            className="rounded bg-accent px-3 py-1 text-[12px] font-medium text-white disabled:opacity-40"
          >
            만들기
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `CommandPalette.tsx` — "Create event from email" 액션 등록**

`CommandPalette.tsx` actions 배열 Actions 섹션, `snooze`(72행) 근처 — `remindMe`(73행) 뒤에:

```typescript
      { id: 'createEvent', name: 'Create event from email', section: 'Actions', perform: () => s().openEventComposer() },
```

- [ ] **Step 5: `useKeyboard.ts` — guard 배열 + Esc-close에 eventComposerOpen 등록**

modal guard 조건(Task 6에서 `s.agendaOpen ||` 추가한 자리)에 이어:

```typescript
        s.agendaOpen ||
        s.eventComposerOpen ||
```

Esc-close 블록에:

```typescript
          if (s.eventComposerOpen) s.closeEventComposer();
```
(`if (s.agendaOpen) s.closeAgenda();` 바로 아래.)

- [ ] **Step 6: `App.tsx` — EventComposer 마운트**

import 추가:

```typescript
import { EventComposer } from './components/EventComposer';
```

`<AgendaPanel />`(Task 6) 아래에:

```typescript
      <EventComposer />
```

- [ ] **Step 7: tsc + test**

Run: `cd zenmail && npx tsc --noEmit && npm test`
Expected: 둘 다 exit 0

- [ ] **Step 8: 수동 확인 (데모)**

Run: `cd zenmail && npm start` → 데모 로그인 → "Re: keyboard shortcut audit" 스레드 열기 → `⌘K` → "Create event from email" 실행.
Expected: 폼이 열리고 제목=`keyboard shortcut audit`(Re: 제거), 참석자=스레드 참여자(demo@zenmail.app 제외). 시작 미입력 시 "만들기" 비활성. 시작 입력 후 만들면 "이벤트가 생성됐어요" 토스트 + 폼 닫힘. 확인 후 종료.

- [ ] **Step 9: 커밋**

```bash
cd zenmail && git add src/renderer/components/EventComposer.tsx src/renderer/store/mail.ts src/renderer/components/CommandPalette.tsx src/renderer/hooks/useKeyboard.ts src/renderer/App.tsx
git commit -m "feat(calendar-integration): CP5 — EventComposer(규칙 프리필: Re/Fwd 제거·참여자 본인 제외)+createEvent, useKeyboard guard 등록"
```

---

### Task 8: E2E TC-CAL 전건 + 무회귀 (CP6)

**Files:**
- Modify: `zenmail/e2e/run-tc.mjs` (helper 블록 340-401 근처, 시나리오 등록 483-512 근처, 시나리오 함수 추가)

**Interfaces:**
- Consumes (렌더러 window API — Task 4/5/6/7): `window.zenmail.__debugCalendarState()`, `__debugFailNextCalendar()`, `__debugSetCalendarReady(v)`, `getAccount()`; DOM: `[data-testid="invite-banner"]`, `[data-testid="rsvp-status"]`, `[aria-label="수락|미정|거절"]`, `[data-testid="agenda-panel"]`, `[data-testid="agenda-error"]`, `[data-testid="event-composer"]`, `[aria-label="Event summary|attendees|start"]`, `[aria-label="Create event"]`
- Produces: 신규 harness PASS 25건(A1~A4, B1~B5, C1~C5, D1~D6, E1~E3, TC-CAL-G1, TC-CAL-G2). F1~F5는 vitest(ics.test.ts)로 `npm test`에서 커버되며 TC-CAL-G2 게이트가 이를 참조.

- [ ] **Step 1: 캘린더 헬퍼 추가**

`run-tc.mjs`의 SplitSettings helpers 끝(401행 `}` 뒤), "Test scenarios" 주석(403행) **앞**에:

```javascript
// ---------------------------------------------------------------------------
// calendar-integration helpers
// ---------------------------------------------------------------------------

async function calendarState(page) {
  return page.evaluate(() => window.zenmail.__debugCalendarState());
}
async function failNextCalendar(page) {
  await page.evaluate(() => window.zenmail.__debugFailNextCalendar());
}
async function setCalendarReady(page, v) {
  await page.evaluate((val) => window.zenmail.__debugSetCalendarReady(val), v);
}
async function accountInfo(page) {
  return page.evaluate(() => window.zenmail.getAccount());
}
async function openInviteThread(page) {
  await focusBody(page);
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await sleep(300);
  await clickRowContaining(page, 'Sprint 14 planning');
  await waitFor(async () => (await bodyText(page)).includes('Sprint 14 planning'), { desc: 'invite thread open' });
}
async function inviteBannerVisible(page) {
  return page.evaluate(() => !!document.querySelector('[data-testid="invite-banner"]'));
}
async function rsvpStatusText(page) {
  return page.evaluate(() => document.querySelector('[data-testid="rsvp-status"]')?.textContent ?? null);
}
async function openAgenda(page) {
  await focusBody(page);
  await page.keyboard.press('g');
  await page.keyboard.press('c');
  await waitFor(() => page.evaluate(() => !!document.querySelector('[data-testid="agenda-panel"]')), { desc: 'agenda open' });
}

async function tryCalScenario(page, name, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`[harness] TC-CAL ${name} error:`, err);
    record(`TC-CAL-${name}`, 'FAIL', String(err).slice(0, 200));
  }
}
```

- [ ] **Step 2: 시나리오 함수 추가 (A/B/C/D/E)**

"Test scenarios" 영역(예: `scenario_C` 정의부 근처)에 함수들을 추가. 각 함수는 자체적으로 inbox로 복귀:

```javascript
// --- TC-CAL-A: 초대 배너 ---
async function scenario_cal_A(page) {
  await openInviteThread(page);
  const bannerText = await page.evaluate(() => document.querySelector('[data-testid="invite-banner"]')?.textContent ?? '');
  if (bannerText.includes('Sprint 14 planning') && bannerText.includes('ana@linearly.dev')) {
    record('TC-CAL-A1', 'PASS', 'invite banner shows summary + organizer');
  } else {
    record('TC-CAL-A1', 'FAIL', `banner text: ${bannerText.slice(0, 120)}`);
  }

  // A3: demo_cal_1 has 2 invite messages (same event resend) → exactly one banner shown
  const bannerCount = await page.evaluate(() => document.querySelectorAll('[data-testid="invite-banner"]').length);
  if (bannerCount === 1) record('TC-CAL-A3', 'PASS', 'exactly one banner for a multi-invite thread');
  else record('TC-CAL-A3', 'FAIL', `banner count = ${bannerCount}`);

  // A2: a normal thread shows no banner
  await focusBody(page);
  await page.keyboard.press('g'); await page.keyboard.press('i'); await sleep(200);
  await clickRowContaining(page, 'Design tokens v2');
  await waitFor(async () => (await bodyText(page)).includes('Design tokens'), { desc: 'normal thread open' });
  if (!(await inviteBannerVisible(page))) record('TC-CAL-A2', 'PASS', 'no banner on a non-invite thread');
  else record('TC-CAL-A2', 'FAIL', 'unexpected banner on normal thread');

  // A4: unparseable ICS → no banner, no crash
  await focusBody(page);
  await page.keyboard.press('g'); await page.keyboard.press('i'); await sleep(200);
  await clickRowContaining(page, 'Broken invite');
  await waitFor(async () => (await bodyText(page)).includes('Broken invite'), { desc: 'bad-ics thread open' });
  const noBanner = !(await inviteBannerVisible(page));
  const alive = await page.evaluate(() => !!document.getElementById('root')?.children.length);
  if (noBanner && alive) record('TC-CAL-A4', 'PASS', 'unparseable ICS → no banner, app alive (fail-safe)');
  else record('TC-CAL-A4', 'FAIL', `noBanner=${noBanner} alive=${alive}`);
  await page.keyboard.press('Escape');
}

// --- TC-CAL-B: RSVP 낙관 5단계 ---
async function scenario_cal_B(page) {
  await openInviteThread(page);
  await page.click('[aria-label="수락"]');
  await waitFor(async () => (await rsvpStatusText(page))?.includes('수락됨'), { desc: 'accepted optimistic' });
  await sleep(300); // mock round-trip
  if ((await rsvpStatusText(page))?.includes('수락됨')) record('TC-CAL-B1', 'PASS', 'accept optimistic + persists');
  else record('TC-CAL-B1', 'FAIL', 'accept status not persisted');

  await page.click('[aria-label="미정"]');
  await waitFor(async () => (await rsvpStatusText(page))?.includes('미정'), { desc: 'tentative optimistic' });
  record('TC-CAL-B2', 'PASS', 'tentative optimistic');

  await page.click('[aria-label="거절"]');
  await waitFor(async () => (await rsvpStatusText(page))?.includes('거절됨'), { desc: 'declined optimistic' });
  record('TC-CAL-B3', 'PASS', 'decline optimistic');

  // B5: re-change from declined → accepted
  await page.click('[aria-label="수락"]');
  await waitFor(async () => (await rsvpStatusText(page))?.includes('수락됨'), { desc: 're-change' });
  await sleep(300);
  const state = await calendarState(page);
  if ((await rsvpStatusText(page))?.includes('수락됨') && state.responses['demo-evt-standup'] === 'accepted') {
    record('TC-CAL-B5', 'PASS', 're-change reflected in UI + mock state');
  } else {
    record('TC-CAL-B5', 'FAIL', `status=${await rsvpStatusText(page)} mock=${state.responses['demo-evt-standup']}`);
  }

  // B4: inject failure → optimistic then rollback + toast
  await failNextCalendar(page);
  await page.click('[aria-label="거절"]');
  await waitFor(async () => (await rsvpStatusText(page))?.includes('거절됨'), { desc: 'declined optimistic (pre-rollback)' });
  await waitFor(async () => {
    const t = await bodyText(page);
    return t.includes('RSVP failed') && (await rsvpStatusText(page))?.includes('수락됨');
  }, { timeout: 4000, desc: 'rollback to accepted + toast' });
  record('TC-CAL-B4', 'PASS', 'RSVP failure → rollback to previous (accepted) + toast');
  await page.keyboard.press('Escape');
}

// --- TC-CAL-C: 아젠다 패널 ---
async function scenario_cal_C(page) {
  await openAgenda(page);
  record('TC-CAL-C1', 'PASS', 'g→c opens the agenda overlay');

  await waitFor(async () => {
    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="agenda-panel"] .truncate')).map((el) => el.textContent)
    );
    return rows.length >= 3;
  }, { desc: 'agenda events loaded' });
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="agenda-panel"]')).map((p) => p.textContent).join(' ')
  );
  if (rows.includes('오늘') && rows.includes('내일')) record('TC-CAL-C2', 'PASS', 'today (2) + tomorrow (1) events shown');
  else record('TC-CAL-C2', 'FAIL', `agenda body: ${rows.slice(0, 160)}`);

  // C4: background shortcut blocked while open
  await page.keyboard.press('e'); await sleep(200);
  const stillOpen = await page.evaluate(() => !!document.querySelector('[data-testid="agenda-panel"]'));
  if (stillOpen) record('TC-CAL-C4', 'PASS', "'e' archive blocked while agenda open");
  else record('TC-CAL-C4', 'FAIL', 'agenda closed / archive leaked');

  // C3: Esc closes
  await page.keyboard.press('Escape'); await sleep(200);
  if (!(await page.evaluate(() => !!document.querySelector('[data-testid="agenda-panel"]')))) {
    record('TC-CAL-C3', 'PASS', 'Esc closes agenda');
  } else {
    record('TC-CAL-C3', 'FAIL', 'agenda still open after Esc');
  }

  // C5: fetch failure → inline error (not a toast)
  await failNextCalendar(page);
  await openAgenda(page);
  await waitFor(() => page.evaluate(() => !!document.querySelector('[data-testid="agenda-error"]')), { desc: 'inline agenda error' });
  record('TC-CAL-C5', 'PASS', 'listEvents failure → inline panel error');
  await page.keyboard.press('Escape');
}

// --- TC-CAL-D: 이벤트 생성 폼 ---
async function scenario_cal_D(page) {
  await focusBody(page);
  await page.keyboard.press('g'); await page.keyboard.press('i'); await sleep(200);
  await clickRowContaining(page, 'keyboard shortcut audit'); // subject "Re: keyboard shortcut audit"
  await waitFor(async () => (await bodyText(page)).includes('keyboard shortcut audit'), { desc: 'thread open for compose' });

  await page.keyboard.press('Meta+k'); await sleep(200);
  await page.keyboard.type('Create event from email'); await sleep(200);
  await page.keyboard.press('Enter');
  await waitFor(() => page.evaluate(() => !!document.querySelector('[data-testid="event-composer"]')), { desc: 'composer open' });
  record('TC-CAL-D1', 'PASS', 'kbar action opens EventComposer');

  const summary = await page.evaluate(() => document.querySelector('[aria-label="Event summary"]')?.value);
  if (summary === 'keyboard shortcut audit') record('TC-CAL-D2', 'PASS', 'Re: prefix stripped');
  else record('TC-CAL-D2', 'FAIL', `summary=${summary}`);

  const attendees = await page.evaluate(() => document.querySelector('[aria-label="Event attendees"]')?.value ?? '');
  if (attendees.length > 0 && !attendees.includes('demo@zenmail.app')) {
    record('TC-CAL-D3', 'PASS', `attendees prefilled without self: ${attendees.slice(0, 60)}`);
  } else {
    record('TC-CAL-D3', 'FAIL', `attendees=${attendees}`);
  }

  // D4: empty start → Create disabled, createEvent not called
  const beforeCreate = (await calendarState(page)).events.length;
  const disabled = await page.evaluate(() => document.querySelector('[aria-label="Create event"]')?.disabled);
  if (disabled === true) record('TC-CAL-D4', 'PASS', 'Create disabled while start empty');
  else record('TC-CAL-D4', 'FAIL', `create disabled=${disabled}`);

  // D5: fill start → success toast + form closes + event appended
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Event start"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '2026-07-20T09:00');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(150);
  await page.click('[aria-label="Create event"]');
  await waitFor(async () => {
    const t = await bodyText(page);
    const closed = !(await page.evaluate(() => !!document.querySelector('[data-testid="event-composer"]')));
    return t.includes('이벤트가 생성됐어요') && closed;
  }, { timeout: 4000, desc: 'create success + close' });
  const afterCreate = (await calendarState(page)).events.length;
  if (afterCreate === beforeCreate + 1) record('TC-CAL-D5', 'PASS', 'success toast + form closed + event appended');
  else record('TC-CAL-D5', 'FAIL', `event count ${beforeCreate}→${afterCreate}`);

  // D6: inject failure → error toast + form stays open (input preserved)
  await page.keyboard.press('Meta+k'); await sleep(200);
  await page.keyboard.type('Create event from email'); await sleep(200);
  await page.keyboard.press('Enter');
  await waitFor(() => page.evaluate(() => !!document.querySelector('[data-testid="event-composer"]')), { desc: 'composer reopen' });
  await page.evaluate(() => {
    const el = document.querySelector('[aria-label="Event start"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '2026-07-21T10:00');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(150);
  await failNextCalendar(page);
  await page.click('[aria-label="Create event"]');
  await waitFor(async () => {
    const t = await bodyText(page);
    const open = await page.evaluate(() => !!document.querySelector('[data-testid="event-composer"]'));
    return t.includes('이벤트 생성 실패') && open;
  }, { timeout: 4000, desc: 'create failure toast + form stays open' });
  record('TC-CAL-D6', 'PASS', 'create failure → error toast + form remains open');
  await page.keyboard.press('Escape'); await sleep(150);
}

// --- TC-CAL-E: calendarReady 게이트 ---
async function scenario_cal_E(page) {
  // E1: simulate calendarReady=false, reload so init() re-reads getAccount(), then the calendar
  // actions must be gated with a re-login prompt (no calendar mutation fires).
  await setCalendarReady(page, false);
  await reloadApp(page);
  const acct = await accountInfo(page);
  if (acct?.calendarReady === false) {
    await openInviteThread(page);
    await page.click('[aria-label="수락"]');
    await waitFor(async () => (await bodyText(page)).includes('캘린더 권한 필요'), { desc: 'reauth prompt on RSVP' });
    const noStatus = (await rsvpStatusText(page)) === null;
    // g→c must NOT open the agenda while gated
    await page.keyboard.press('Escape');
    await focusBody(page);
    await page.keyboard.press('g'); await page.keyboard.press('c'); await sleep(300);
    const agendaBlocked = !(await page.evaluate(() => !!document.querySelector('[data-testid="agenda-panel"]')));
    if (noStatus && agendaBlocked) record('TC-CAL-E1', 'PASS', 'reauth prompt shown; RSVP + agenda gated');
    else record('TC-CAL-E1', 'FAIL', `noStatus=${noStatus} agendaBlocked=${agendaBlocked}`);

    // E2: mail features unaffected while gated — archive still works
    await focusBody(page);
    await page.keyboard.press('g'); await page.keyboard.press('i'); await sleep(300);
    const beforeRows = (await rowsInfo(page)).length;
    const firstText = (await rowsInfo(page))[0]?.text ?? '';
    await focusBody(page);
    await page.keyboard.press('e'); // archive top selected
    await waitFor(async () => (await rowsInfo(page)).length === beforeRows - 1 || !(await rowsInfo(page))[0]?.text.includes(firstText.slice(0, 10)), { timeout: 4000, desc: 'archive while gated' });
    record('TC-CAL-E2', 'PASS', 'mail archive unaffected while calendarReady=false');
  } else {
    record('TC-CAL-E1', 'FAIL', `calendarReady override not applied: ${JSON.stringify(acct)}`);
    record('TC-CAL-E2', 'SKIP', 'blocked by E1');
  }

  // E3: restore readiness (sign out → demo sign in rebuilds a fresh, ready session)
  await setCalendarReady(page, true);
  await page.evaluate(() => window.zenmail.signOut());
  await reloadApp(page);
  await demoLogin(page);
  const acct2 = await accountInfo(page);
  if (acct2?.calendarReady === true) {
    await openAgenda(page);
    const opened = await page.evaluate(() => !!document.querySelector('[data-testid="agenda-panel"]'));
    await page.keyboard.press('Escape');
    if (opened) record('TC-CAL-E3', 'PASS', 're-login restores calendarReady; agenda works again');
    else record('TC-CAL-E3', 'FAIL', 'agenda did not open after restore');
  } else {
    record('TC-CAL-E3', 'FAIL', `calendarReady not restored: ${JSON.stringify(acct2)}`);
  }
}
```

> 참고: `reloadApp(page)`는 run-tc.mjs에 이미 존재하는 헬퍼(F3 remainder에서 사용, 454행). 없다면 `await page.reload()` + `demoLogin` 재확인으로 대체하되, 본 계획은 기존 `reloadApp` 재사용을 전제한다.

- [ ] **Step 3: 시나리오 등록 (run 본문)**

`run()`의 select-all(`trySaScenario ... BulkDestructive`, 491-493행) **뒤**, light-mode 블록(`tryLmScenario ... A1A2`, 498행) **앞**에:

```javascript
    // --- calendar-integration: TC-CAL-A~E (docs/features/calendar-integration/TC.md) — runs after
    // every pre-existing scenario and before the mutate+restart block. A~D leave the session intact;
    // E signs out and re-logs in (rebuilding a fresh MockGmailProvider), so it runs LAST among CAL.
    await tryCalScenario(page, 'A', () => scenario_cal_A(page));
    await tryCalScenario(page, 'B', () => scenario_cal_B(page));
    await tryCalScenario(page, 'C', () => scenario_cal_C(page));
    await tryCalScenario(page, 'D', () => scenario_cal_D(page));
    await tryCalScenario(page, 'E', () => scenario_cal_E(page));
```

- [ ] **Step 4: 회귀 게이트 TC-CAL-G1/G2 기록**

집계 계산부(TC-SA-C1/C2 블록, 626-641행) **뒤**, `console.log('\n=== TC Results ===');`(643행) **앞**에:

```javascript
  // --- TC-CAL-G1/G2: calendar-integration regression gates ------------------
  const preCalFails = results.filter((r) => !r.id.startsWith('TC-CAL') && r.status === 'FAIL');
  if (preCalFails.length === 0) {
    record(
      'TC-CAL-G1',
      'PASS',
      `all ${results.filter((r) => !r.id.startsWith('TC-CAL')).length} pre-existing F1..select-all assertions still PASS/SKIP with calendar-integration wired in`
    );
  } else {
    record('TC-CAL-G1', 'FAIL', `${preCalFails.length} pre-existing (non-CAL) assertions failed: ${preCalFails.map((r) => r.id).join(', ')}`);
  }
  if (kmG2?.status === 'PASS' && kmG3?.status === 'PASS') {
    record('TC-CAL-G2', 'PASS', 'npm test + npx tsc --noEmit (incl. ics/calendar suites, TC-CAL-F1~F5) both exit 0 (reusing TC-KM-G2/G3)');
  } else {
    record('TC-CAL-G2', 'FAIL', `TC-KM-G2=${kmG2?.status} TC-KM-G3=${kmG3?.status}`);
  }
```

- [ ] **Step 5: E2E 전체 실행 — 무회귀 + 신규 전건 확인**

Run: `cd zenmail && node e2e/run-tc.mjs`
Expected: 종료부 `=== TC Results ===` 블록에서
- 기존 157건 전부 PASS/SKIP 유지(0 FAIL),
- 신규 TC-CAL-A1~A4, B1~B5, C1~C5, D1~D6, E1~E3, TC-CAL-G1, TC-CAL-G2 전부 PASS,
- 최종 집계 **182 PASS · 0 FAIL · 7 SKIP** (신규 SKIP 없음).
프로세스 exit code 0.

> 실행 결과 PASS 총계가 182와 다르면(±): 새 assertion 개수를 실제 집계와 대조해 커밋 메시지의 숫자만 실측값으로 맞춘다. 불변 조건은 **0 FAIL · 7 SKIP 유지**이며, 이를 어기면 회귀로 간주하고 해당 CP로 돌아가 원인을 수정한다.

- [ ] **Step 6: 무회귀 재실행 (결정성 확인)**

Run: `cd zenmail && node e2e/run-tc.mjs`
Expected: 1회차와 동일 집계(결정적). `=== TC Results ===` 0 FAIL.

- [ ] **Step 7: 커밋**

```bash
cd zenmail && git add e2e/run-tc.mjs
git commit -m "feat(calendar-integration): CP6 — E2E TC-CAL A~E(23)+G1/G2 회귀 게이트, 전체 무회귀(182 PASS·0 FAIL·7 SKIP ×2)"
```

---

## Self-Review

**1. Spec coverage (FR1~FR33 / CP1~CP6 / TC-CAL-A~G):**
- FR1 (extractBodies text/calendar): Task 2 Step 2. FR2 (최소 ICS 파서 6필드): Task 1 Step 4. FR3 (UTC/TZID 정규화 + fail-safe): Task 1 (`normalizeDate`). FR4 (METHOD:REQUEST만 invite): Task 1 (`extractInvite`), Task 2 (getThread). FR5/FR6 (배너 자리 + 최신 1건): Task 5 (`InviteBanner`/`latestInvite`). FR7 (낙관 5단계): Task 5 (`respondToInvite`). FR8 (재변경): Task 5 (버튼 status 반영).
- FR9~FR14 (CalendarProvider Real/Mock + IPC 4파일): Task 3 + Task 4.
- FR15 (scope): Task 4 Step 1. FR16 (calendarReady scope 검사): Task 4 Step 2. FR17/FR19 (국소 게이트, 데모 true): Task 4 (`currentCalendarReady`). FR18 (재로그인 안내, signOut→signIn): Task 5 (`CALENDAR_REAUTH_MSG`), Task 8 E3.
- FR20~FR23 (아젠다 g→c, 오버레이, live fetch, guard 두 곳): Task 6.
- FR24~FR29 (이벤트 생성 kbar/프리필/날짜 필수/토스트/guard): Task 7.
- FR30 (큐 비대상 즉시 롤백): Task 5/7 (catch에서 즉시 롤백/토스트, 큐 미사용). FR31 (아젠다 인라인 에러): Task 6.
- FR32 (데모 초대 메일): Task 2 Step 4. FR33 (__debug 훅): Task 4 Step 6.
- CP1=Task 1+2, CP2=Task 3+4, CP3=Task 5, CP4=Task 6, CP5=Task 7, CP6=Task 8. TC-CAL-A~E: Task 8 시나리오; F1~F5: Task 1 vitest; G1/G2: Task 8 게이트.

**2. Placeholder scan:** 모든 코드 스텝에 실제 코드 블록·정확한 파일 경로/행 범위·실행 명령·기대 출력이 있음. "적절히 처리"류 문구 없음.

**3. Type consistency:** `InviteInfo`(iCalUID/summary/startISO/endISO/organizer/method), `CalendarEvent`(id/iCalUID/summary/startISO/endISO/allDay/organizer), `CreateEventInput`(summary/startISO/endISO/attendees), `RsvpResponse`, `extractInvite`, `CalendarProvider.listEvents/respondToEvent/createEvent`, 스토어 `respondToInvite`/`openAgenda`/`closeAgenda`/`openEventComposer`/`closeEventComposer`/`createCalendarEvent`, 상태 `rsvpStatus`/`agendaOpen`/`agendaEvents`/`agendaLoading`/`agendaError`/`eventComposerOpen`, 상수 `CALENDAR_REAUTH_MSG`, IPC 채널 `calendar:list-events`/`calendar:respond`/`calendar:create` + `calendar:debug-*`, debug 훅 `__debugCalendarState`/`__debugFailNextCalendar`/`__debugSetCalendarReady`, mock 메서드 `failNextCalendarCall`/`snapshot`/`callCounts` — 정의 태스크(1/3/4/5/6/7)와 소비 태스크(5/6/7/8) 전반에서 이름·시그니처 일치.

---

## 후속 프로세스 (오케스트레이터 수행)

이 계획은 **코드 태스크만** 포함한다. DEV_WORKFLOW Goal 5~8의 나머지 — `/react-best-practices`(vercel-react-best-practices) 클린 통과, audit(`/impeccable` 미설치 → F1 D14 선례대로 `web-design-guidelines`/실측 대체), 최종 `/code-review low`, DECISIONS(ICS 자체 파서·큐 비대상·calendarReady 게이트) 확정 기록, TC/TODO/DEV_WORKFLOW/루트 TODO 스냅샷 갱신, Obsidian 기록, push — 은 오케스트레이터가 CP6 완료 후 별도로 수행한다.