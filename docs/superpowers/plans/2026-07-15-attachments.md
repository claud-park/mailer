# 첨부파일 표시·다운로드 (attachments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수신 메일의 첨부를 ZenMail에서 표시·다운로드한다 — (1) 본문 인라인 `cid:` 이미지 렌더링, (2) 본문 아래 첨부 스트립(아이콘/썸네일 + 파일명 + 용량), (3) 클릭 시 다운로드 폴더로 즉시 저장(다이얼로그 없음, 충돌 시 안전 리네임). 발신 측 첨부·바이트 영속 캐시·대용량 스트리밍은 범위 밖.

**Architecture:** calendar-integration의 "GmailProvider 확장 + 4-파일 IPC 계약" 패턴을 그대로 미러링한다. `extractBodies()`가 이미 걷고 있는 MIME 트리에서 첨부 파트를 순수 함수 `extractAttachments()`로 수집해 `MessageDetail.attachments?: AttachmentInfo[]`(invite와 동일한 optional·fail-safe 패턴)로 노출한다. 바이트는 `GmailProvider.getAttachment`(Real: `messages.attachments.get`, Mock: fixture 맵)로 매 요청 fresh fetch하고 sqlite에 저장하지 않는다. UI는 기존 오버레이 템플릿(SnoozePicker/AgendaPanel)과 iframe sandbox 렌더링을 재사용한다.

**Tech Stack:** Electron 33 + React 19 + TypeScript + Tailwind v4 + zustand + kbar + better-sqlite3, googleapis ^173 (`gmail.users.messages.attachments.get` 포함 — 신규 npm 의존성 0), Node `node:fs`/`node:path`/electron `app`(파일 저장), vitest ^2.

## Global Constraints

이 절은 모든 태스크의 요구사항에 암묵적으로 포함된다.

- **신규 npm 의존성 0.** `messages.attachments.get`은 기존 `googleapis ^173`에 포함되어 있고, 파일 저장은 Node 표준 + electron `app`만 쓴다. `package.json`에 새 의존성을 추가하지 않는다.
- **No AI (v1).** mimetype 아이콘 매핑·파일명 리네임·용량 포맷은 결정적 규칙. AI 썸네일 생성·OCR·요약 일체 금지.
- **바이트 무캐시(D5).** `getAttachmentImage`/`downloadAttachment`는 매 호출 fresh fetch. 첨부 바이트를 sqlite에 저장하지 않는다. in-memory(컴포넌트 state)만 세션 한정 유지. 메타데이터(`AttachmentInfo`)는 `MessageDetail`의 일부로 기존 detail 캐시를 그대로 탄다.
- **eager fetch는 이미지 mimetype만(D6).** 인라인 cid 렌더 + 스트립 썸네일만 스레드 열 때 자동 fetch. 비이미지(PDF 등)는 다운로드 클릭 시에만 fetch.
- **cid 이미지는 remote-image 게이트 우회(D7).** `allowImages` 게이트는 원격 `http(s):` 이미지에만 유지. cid는 data URI로 치환해 게이팅 없이 자동 로드(iframe CSP `img-src data:`는 현행 그대로 — 변경 없음).
- **인라인/목록 분리(D4).** `inline: true`(Content-Disposition:inline + Content-ID)면 본문에서만 렌더하고 스트립에서 제외. `inline: false`면 스트립에만.
- **다운로드는 Save-As 없음 + 충돌 리네임(D3/D8).** `app.getPath('downloads')` 고정, 충돌 시 `foo.pdf`→`foo (1).pdf`. E2E는 `__debugSetDownloadDir`로 임시 폴더 주입(실제 Downloads 오염 금지).
- **⚠️ 스펙 대비 조정(구현이 정확해지도록):** 설계 스펙의 `getAttachment(...): Promise<{data, mimeType}>`는 Real에서 성립 불가하다 — Gmail `messages.attachments.get` 응답에는 mimeType이 없다(`{attachmentId, size, data}`뿐). 따라서 **provider.getAttachment는 base64url `data: string`만 반환**하고, mimeType은 렌더러가 이미 보유한 `AttachmentInfo.mimeType`을 IPC로 전달한다(`getAttachmentImage(accountId, messageId, attachmentId, mimeType)`). download은 filename에 확장자가 있어 mimeType 불요. 이 조정은 스펙의 IPC 진입점·바이트 무캐시·항목 단위 에러 격리 의도를 모두 보존한다.
- **에러·오프라인(FR17/18, D9).** 이미지 fetch 실패는 항목 단위 인라인 에러 + 수동 재시도(자동 재시도 없음). 다운로드 실패는 토스트만. F6 큐 비대상.
- **무회귀 불변식:** 기존 E2E 캐논은 **200 PASS · 0 FAIL · 6 SKIP**(multi-account 완료 시점, 2026-07-15). 캐논 SKIP 집합 = `{TC-A4, TC-D5, TC-D8, TC-SY-C3, TC-SA-B4, TC-SY-B2}`. CP5 완료 시 신규 TC-ATT 15건 포함 목표 집계 = **215 PASS · 0 FAIL · 6 SKIP**(0 FAIL + 신규 SKIP 없음 + SKIP 집합 부분집합 유지).
- **빌드 주의사항:** Vite 설정은 `.mts` 확장자 유지. `@vitejs/plugin-react`는 v4 고정 — 상향 금지. 로컬 `npm install` 필요 시 `--legacy-peer-deps`.
- **커밋 관례:** 한국어, `feat(attachments): CP<n> — <요약>` 스타일. 각 CP 커밋 말미에 무회귀 집계 병기.
- **검증 게이트:** 각 태스크 종료 시 `npx tsc --noEmit`(zenmail 디렉터리) + `npm test`(vitest) 통과. 명령은 항상 `zenmail/` 안에서 실행. E2E는 `node e2e/run-tc.mjs`.

---

### Task 1: 첨부 메타데이터 추출 + getAttachment provider(Real/Mock) + Mock fixture + 데모 시드 (CP1)

**Files:**
- Modify: `zenmail/src/shared/types.ts` (`AttachmentInfo` 타입, `MessageDetail.attachments`)
- Modify: `zenmail/src/main/gmail.ts` (`GmailProvider` 18-30, `extractAttachments` 신설, `getThread` 193-222, `RealGmailProvider.getAttachment`, `MockGmailProvider.getAttachment`+fixture, `buildDemoData` seed ~620)
- Create: `zenmail/src/main/attachments.test.ts`

**Interfaces:**
- Produces:
  - `interface AttachmentInfo { attachmentId: string; filename: string; mimeType: string; size: number; contentId?: string; inline: boolean }` (types.ts export)
  - `MessageDetail.attachments?: AttachmentInfo[]`
  - `export function extractAttachments(part: gmail_v1.Schema$MessagePart | undefined): AttachmentInfo[]` (gmail.ts)
  - `GmailProvider.getAttachment(messageId: string, attachmentId: string): Promise<string>` (base64url data)
  - `MockGmailProvider.failNextAttachmentCall(): void` (E2E one-shot)
  - 데모 스레드 `demo_att_1` (subject `Attachments: brand kit`, 발신자 `design@brandco.example`, 최고령 date)

- [ ] **Step 1: `types.ts`에 `AttachmentInfo` + `MessageDetail.attachments` 추가**

`zenmail/src/shared/types.ts`의 `InviteInfo`(29-40행) 아래, `RsvpResponse`(42행) 위에 추가:

```typescript
export interface AttachmentInfo {
  /** Gmail attachment id — getAttachment가 바이트를 가져오는 키 */
  attachmentId: string;
  filename: string;
  mimeType: string;
  /** 바이트 크기 (body.size) */
  size: number;
  /** 'Content-ID' 헤더(양끝 <> 제거) — 인라인 이미지에만 존재 */
  contentId?: string;
  /** Content-Disposition:inline && contentId 존재 → 본문 cid 참조(스트립에서 제외) */
  inline: boolean;
}
```

`MessageDetail`(64-77행)의 `invite?` 필드 아래에 추가:

```typescript
  /** 첨부 파트 메타데이터(바이트 아님). 첨부 없으면 미노출(invite와 동일 optional 패턴). */
  attachments?: AttachmentInfo[];
```

- [ ] **Step 2: 실패 테스트 작성 (`attachments.test.ts`)**

`zenmail/src/main/attachments.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { gmail_v1 } from 'googleapis';
import { extractAttachments } from './gmail';

const part = (p: Partial<gmail_v1.Schema$MessagePart>): gmail_v1.Schema$MessagePart =>
  p as gmail_v1.Schema$MessagePart;

describe('extractAttachments', () => {
  // TC-ATT-F1 (일부): 첨부 파트만 수집, 본문 파트는 스킵
  it('collects attachment parts and skips body parts', () => {
    const payload = part({
      mimeType: 'multipart/mixed',
      parts: [
        part({ mimeType: 'text/html', body: { data: 'aGk=' } }),
        part({ mimeType: 'application/pdf', filename: 'a.pdf', body: { attachmentId: 'att1', size: 1024 } }),
      ],
    });
    expect(extractAttachments(payload)).toEqual([
      { attachmentId: 'att1', filename: 'a.pdf', mimeType: 'application/pdf', size: 1024, inline: false },
    ]);
  });

  // TC-ATT-F1: Content-ID + inline disposition → inline:true, contentId 언랩(<>)
  it('marks Content-ID + inline disposition parts as inline and unwraps <>', () => {
    const payload = part({
      mimeType: 'multipart/related',
      parts: [
        part({
          mimeType: 'image/png',
          filename: 'logo.png',
          headers: [
            { name: 'Content-ID', value: '<logo@zenmail>' },
            { name: 'Content-Disposition', value: 'inline; filename="logo.png"' },
          ],
          body: { attachmentId: 'attL', size: 95 },
        }),
      ],
    });
    const out = extractAttachments(payload);
    expect(out[0].inline).toBe(true);
    expect(out[0].contentId).toBe('logo@zenmail');
  });

  it('returns [] when there are no attachment parts', () => {
    expect(extractAttachments(part({ mimeType: 'text/plain', body: { data: 'aGk=' } }))).toEqual([]);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd zenmail && npx vitest run src/main/attachments.test.ts`
Expected: FAIL — `extractAttachments` is not exported (미구현).

- [ ] **Step 4: `gmail.ts` — `extractAttachments` 구현 + import**

`zenmail/src/main/gmail.ts` 상단 import에 `AttachmentInfo` 추가(2-14행 타입 블록 안, 알파벳 위치):

```typescript
  type AttachmentInfo,
```

`extractBodies`(63-82행) **바로 아래**에 순수 헬퍼 추가:

```typescript
function partHeader(p: gmail_v1.Schema$MessagePart, name: string): string | undefined {
  return p.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;
}

/**
 * MIME 트리를 걸어 첨부 파트만 수집한다(본문 파트는 extractBodies가 처리). 첨부 판정은
 * body.attachmentId 존재 + (filename ∨ Content-ID). 인라인 판정(D4)은 Content-ID 헤더 존재 +
 * Content-Disposition:inline. contentId는 양끝 <>를 벗겨 cid: 참조와 매칭 가능하게 한다.
 */
export function extractAttachments(part: gmail_v1.Schema$MessagePart | undefined): AttachmentInfo[] {
  const out: AttachmentInfo[] = [];
  const walk = (p: gmail_v1.Schema$MessagePart | undefined) => {
    if (!p) return;
    const attachmentId = p.body?.attachmentId ?? undefined;
    const contentIdRaw = partHeader(p, 'Content-ID');
    const filename = p.filename ?? '';
    if (attachmentId && (filename || contentIdRaw)) {
      const contentId = contentIdRaw ? contentIdRaw.trim().replace(/^<|>$/g, '') : undefined;
      const disposition = (partHeader(p, 'Content-Disposition') ?? '').toLowerCase();
      const inline = !!contentId && disposition.startsWith('inline');
      out.push({
        attachmentId,
        filename: filename || contentId || 'attachment',
        mimeType: p.mimeType ?? 'application/octet-stream',
        size: p.body?.size ?? 0,
        ...(contentId ? { contentId } : {}),
        inline,
      });
    }
    p.parts?.forEach(walk);
  };
  walk(part);
  return out;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd zenmail && npx vitest run src/main/attachments.test.ts`
Expected: PASS (3 tests, TC-ATT-F1 커버).

- [ ] **Step 6: `GmailProvider` 인터페이스 + `getThread` attachments 노출**

`GmailProvider` 인터페이스(18-30행)의 `inboxUnreadCount(): Promise<number>;`(29행) 아래에:

```typescript
  /** 첨부 바이트를 가져온다(base64url). 매 호출 fresh fetch — sqlite 무저장(D5). */
  getAttachment(messageId: string, attachmentId: string): Promise<string>;
```

`RealGmailProvider.getThread`(193-222행)의 메시지 매핑에서 `const bodies = extractBodies(m.payload);`(205행) 아래, 반환 객체의 `...(invite ? { invite } : {}),`(218행) 다음 줄에 추가:

```typescript
        const bodies = extractBodies(m.payload);
        const invite = bodies.ics ? extractInvite(bodies.ics) : undefined;
        const attachments = extractAttachments(m.payload);
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
          ...(attachments.length ? { attachments } : {}),
        };
```

- [ ] **Step 7: `RealGmailProvider.getAttachment` 구현**

`RealGmailProvider`의 `inboxUnreadCount`(298-301행) 메서드 **뒤**, 클래스 닫는 `}`(302행) **앞**에:

```typescript
  async getAttachment(messageId: string, attachmentId: string): Promise<string> {
    const res = await this.gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });
    // Gmail은 base64url을 반환. mimeType은 응답에 없으므로(렌더러가 AttachmentInfo로 이미 앎)
    // 여기서는 바이트만 전달한다. 빈 응답이면 빈 문자열(호출부에서 처리).
    return res.data.data ?? '';
  }
```

- [ ] **Step 8: 데모 첨부 fixture 바이트 + `MockGmailProvider.getAttachment` + 데모 시드**

`gmail.ts`의 `DEMO_VIP_EMAIL` export(311행) **아래**(모듈 레벨)에 fixture 바이트 상수 추가. 내용은 load-bearing이 아님(E2E는 data: URI 존재/파일 존재만 검증) — 유효한 base64 데모 fixture:

```typescript
/**
 * 데모 첨부 fixture 바이트(base64). 내용은 load-bearing이 아니다 — E2E는 data: URI 치환과 파일
 * 존재만 검증한다. Mock.getAttachment가 attachmentId로 조회한다(demo_att_1 시드와 짝).
 */
const DEMO_ATTACHMENT_BYTES: Record<string, string> = {
  // 1x1 PNG (투명)
  att_logo:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=',
  // 최소 PDF (%PDF … %%EOF)
  att_pdf:
    'JVBERi0xLjEKMSAwIG9iago8PC9UeXBlL0NhdGFsb2c+PgplbmRvYmoKdHJhaWxlcgo8PC9Sb290IDEgMCBSPj4KJSVFT0Y=',
  // 작은 JPEG 헤더(데모용, 유효 base64)
  att_jpg:
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
};
```

`MockGmailProvider`의 `callCounts` 필드(682행) 아래에 one-shot 필드 추가:

```typescript
  /** E2E-only (TC-ATT-E1/E2): 다음 getAttachment 1회를 throw시킨다(one-shot, 소비형). */
  private failNextAttachment = false;
```

`MockGmailProvider`의 `inboxUnreadCount`(871-873행) 메서드 **뒤**, 클래스 닫는 `}`(874행) **앞**에:

```typescript
  /** E2E-only: 다음 첨부 fetch 1회 실패를 무장. */
  failNextAttachmentCall(): void {
    this.failNextAttachment = true;
  }

  async getAttachment(_messageId: string, attachmentId: string): Promise<string> {
    this.callCounts.getAttachment = (this.callCounts.getAttachment ?? 0) + 1;
    await this.delay();
    if (this.failNextAttachment) {
      this.failNextAttachment = false;
      throw new Error('attachment fetch failed (mock)');
    }
    const data = DEMO_ATTACHMENT_BYTES[attachmentId];
    if (data === undefined) throw new Error(`Unknown attachment ${attachmentId}`);
    return data;
  }
```

`buildDemoData`의 `return { threads, labels, senders };`(620행) **직전**(starred 시드 push 611-618행 다음)에 첨부 스레드 시드 추가:

```typescript
  // attachments: 첨부 시드 1건. design@brandco.example 은 어떤 split 규칙에도 매칭되지 않고(도메인/
  // VIP/newsletter 아님), 최고령 date라 기존 split 카운트/순서(F1~F6 · TC-* E2E)를 건드리지 않는다.
  // 본문에 인라인 로고(cid:logo@zenmail)를 참조하고, 비인라인 PDF·JPEG 2건을 첨부한다.
  const attFrom: Contact = { name: 'BrandCo Design', email: 'design@brandco.example' };
  const attId = 'demo_att_1';
  const attAttachments: AttachmentInfo[] = [
    { attachmentId: 'att_logo', filename: 'logo.png', mimeType: 'image/png', size: 95, contentId: 'logo@zenmail', inline: true },
    { attachmentId: 'att_pdf', filename: 'brand-guide.pdf', mimeType: 'application/pdf', size: 88, inline: false },
    { attachmentId: 'att_jpg', filename: 'cover.jpg', mimeType: 'image/jpeg', size: 240, inline: false },
  ];
  const attMessage = {
    id: `${attId}_m0`,
    threadId: attId,
    from: attFrom,
    to: [{ name: 'You', email }],
    cc: [] as Contact[],
    date: now - 140 * h,
    snippet: 'Brand kit — logo, guidelines PDF, and the cover image attached.',
    bodyHtml: `<div><p>Here's the brand kit.</p><p><img src="cid:logo@zenmail" alt="BrandCo logo" width="120"></p><p>Guidelines PDF and cover image attached.</p></div>`,
    bodyText: 'Here is the brand kit. Guidelines PDF and cover image attached.',
    labelIds: ['INBOX'],
    attachments: attAttachments,
  };
  threads.push({
    summary: {
      id: attId,
      subject: 'Attachments: brand kit',
      from: attFrom,
      snippet: attMessage.snippet,
      date: attMessage.date,
      unread: false,
      labelIds: ['INBOX'],
      messageCount: 1,
    },
    detail: { id: attId, subject: 'Attachments: brand kit', labelIds: ['INBOX'], messages: [attMessage] },
  });
```

- [ ] **Step 9: tsc + test**

Run: `cd zenmail && npx tsc --noEmit && npm test`
Expected: 둘 다 exit 0. (attachments는 선택 필드라 기존 코드 무영향.)

- [ ] **Step 10: 커밋**

```bash
cd zenmail && git add src/shared/types.ts src/main/gmail.ts src/main/attachments.test.ts
git commit -m "feat(attachments): CP1 — extractAttachments+getAttachment(Real/Mock)+AttachmentInfo, Mock fixture·데모 시드(demo_att_1), vitest TC-ATT-F1"
```

---

### Task 2: shared types(ZenmailApi) + IPC 4-파일 계약 + 다운로드 헬퍼 + __debug 훅 (CP2)

**Files:**
- Modify: `zenmail/src/shared/types.ts` (`ZenmailApi` 217-219 근처, `__debug` 265-270 근처)
- Create: `zenmail/src/main/download.ts`
- Create: `zenmail/src/main/download.test.ts`
- Modify: `zenmail/src/main/ipc.ts` (electron import 3, download import, 모듈 상태 65, 핸들러 694, __debug 777)
- Modify: `zenmail/src/main/preload.ts` (import 2-14, api 55-56, debug 119)

**Interfaces:**
- Consumes: `GmailProvider.getAttachment` (Task 1), `MockGmailProvider.failNextAttachmentCall` (Task 1)
- Produces (렌더러가 소비하는 IPC 계약 — 이름 고정):
  - `ZenmailApi.getAttachmentImage(accountId, messageId, attachmentId, mimeType): Promise<{ dataUri: string; mimeType: string } | { error: string }>`
  - `ZenmailApi.downloadAttachment(accountId, messageId, attachmentId, filename): Promise<{ savedPath: string } | { error: string }>`
  - `ZenmailApi.__debugFailNextAttachment?(): Promise<void>`, `__debugSetDownloadDir?(dir: string): Promise<void>`
  - `dedupeDownloadPath(dir, filename): string`, `writeDownload(dir, filename, buffer): Promise<string>` (download.ts)
  - IPC 채널: `mail:get-attachment-image`, `mail:download-attachment`, `mail:debug-fail-next-attachment`, `mail:debug-set-download-dir`

- [ ] **Step 1: `types.ts` — ZenmailApi + __debug 확장**

`ZenmailApi`의 `createEvent(...)`(219행) 아래에:

```typescript
  /** 이미지 첨부 바이트를 data URI로 가져온다(인라인 cid 렌더 + 스트립 썸네일). mimeType은 렌더러가
   *  AttachmentInfo로 이미 아는 값을 전달(Gmail attachments.get이 mimeType을 안 주기 때문). */
  getAttachmentImage(
    accountId: string,
    messageId: string,
    attachmentId: string,
    mimeType: string
  ): Promise<{ dataUri: string; mimeType: string } | { error: string }>;
  /** 첨부를 다운로드 폴더로 저장(다이얼로그 없음, 충돌 시 (1) 리네임). */
  downloadAttachment(
    accountId: string,
    messageId: string,
    attachmentId: string,
    filename: string
  ): Promise<{ savedPath: string } | { error: string }>;
```

`ZenmailApi`의 `__debug` 블록, `__debugSetCalendarReady?`(270행) 아래에:

```typescript
  /** E2E-only: 다음 getAttachment 호출 1회를 실패시킴(one-shot). */
  __debugFailNextAttachment?(): Promise<void>;
  /** E2E-only: 다운로드 저장 디렉터리 오버라이드(실제 Downloads 오염 방지 + 저장 경로/리네임 검증). */
  __debugSetDownloadDir?(dir: string): Promise<void>;
```

- [ ] **Step 2: 실패 테스트 작성 (`download.test.ts`)**

`zenmail/src/main/download.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dedupeDownloadPath } from './download';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zt-att-'));

describe('dedupeDownloadPath', () => {
  // TC-ATT-F2: 충돌 없으면 원래 이름
  it('returns the original path when nothing collides', () => {
    const dir = tmp();
    expect(dedupeDownloadPath(dir, 'foo.pdf')).toBe(path.join(dir, 'foo.pdf'));
  });

  // TC-ATT-F2: 충돌 시 (1),(2) — 확장자 보존
  it('appends (1), (2) preserving the extension on collisions', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'foo.pdf'), 'x');
    expect(dedupeDownloadPath(dir, 'foo.pdf')).toBe(path.join(dir, 'foo (1).pdf'));
    fs.writeFileSync(path.join(dir, 'foo (1).pdf'), 'x');
    expect(dedupeDownloadPath(dir, 'foo.pdf')).toBe(path.join(dir, 'foo (2).pdf'));
  });

  // TC-ATT-F2: 확장자 없는 파일명
  it('handles extensionless filenames', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'README'), 'x');
    expect(dedupeDownloadPath(dir, 'README')).toBe(path.join(dir, 'README (1)'));
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `cd zenmail && npx vitest run src/main/download.test.ts`
Expected: FAIL — `Failed to resolve import "./download"`.

- [ ] **Step 4: `download.ts` 구현**

`zenmail/src/main/download.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';

/**
 * 확장자를 보존하며 충돌 시 ` (1)`, ` (2)` … 를 붙여 아직 존재하지 않는 경로를 반환한다.
 * (단일 사용자 데스크톱 앱이라 existsSync 기반 TOCTOU는 실질 문제 없음 — 동시 다운로드 희박.)
 */
export function dedupeDownloadPath(dir: string, filename: string): string {
  const ext = path.extname(filename);
  const base = ext ? filename.slice(0, filename.length - ext.length) : filename;
  let candidate = path.join(dir, filename);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

/** 다운로드 폴더(없으면 생성)에 충돌 안전 파일명으로 buffer를 쓰고 저장 경로를 반환한다. */
export async function writeDownload(dir: string, filename: string, buffer: Buffer): Promise<string> {
  await fs.promises.mkdir(dir, { recursive: true });
  const target = dedupeDownloadPath(dir, filename);
  await fs.promises.writeFile(target, buffer);
  return target;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd zenmail && npx vitest run src/main/download.test.ts`
Expected: PASS (3 tests, TC-ATT-F2 커버).

- [ ] **Step 6: `ipc.ts` — 첨부 핸들러 2종 + 다운로드 dir 상태**

`ipc.ts` electron import(3행)를 수정:

```typescript
import { app, ipcMain, type BrowserWindow } from 'electron';
```

import 블록의 calendar import(22행) 근처에 download 헬퍼 추가:

```typescript
import { writeDownload } from './download';
```

모듈 레벨 `let debugCalendarReady: boolean | null = null;`(65행) **아래**에:

```typescript
/** E2E-only: 다운로드 저장 디렉터리 오버라이드(null이면 OS Downloads 사용). */
let downloadDirOverride: string | null = null;
function downloadsDir(): string {
  return downloadDirOverride ?? app.getPath('downloads');
}
```

`registerIpc` 안, calendar 핸들러 블록(`calendar:create` 692-694행) **뒤**, `// E2E-only debug IPC`(696행) **앞**에:

```typescript
  // --- attachments ---

  ipcMain.handle(
    'mail:get-attachment-image',
    async (
      _e,
      accountId: string,
      messageId: string,
      attachmentId: string,
      mimeType: string
    ): Promise<{ dataUri: string; mimeType: string } | { error: string }> => {
      try {
        // 매 호출 fresh fetch — sqlite 무저장(D5). Gmail은 base64url 반환 → data URI용 표준 base64로 정규화.
        const data = await requireContext(accountId).provider.getAttachment(messageId, attachmentId);
        const b64 = Buffer.from(data, 'base64url').toString('base64');
        return { dataUri: `data:${mimeType};base64,${b64}`, mimeType };
      } catch (err) {
        console.error('[attachment] get-image failed', err);
        return { error: String(err) };
      }
    }
  );

  ipcMain.handle(
    'mail:download-attachment',
    async (
      _e,
      accountId: string,
      messageId: string,
      attachmentId: string,
      filename: string
    ): Promise<{ savedPath: string } | { error: string }> => {
      try {
        const data = await requireContext(accountId).provider.getAttachment(messageId, attachmentId);
        const savedPath = await writeDownload(downloadsDir(), filename, Buffer.from(data, 'base64url'));
        return { savedPath };
      } catch (err) {
        console.error('[attachment] download failed', err);
        return { error: String(err) };
      }
    }
  );
```

- [ ] **Step 7: `ipc.ts` — E2E `__debug` 훅 2종**

`if (process.env.ZENMAIL_E2E_PORT) {` 블록 안, `calendar:debug-set-ready` 핸들러(775-777행) **뒤**, 닫는 `}`(778행) **앞**에:

```typescript
    ipcMain.handle('mail:debug-fail-next-attachment', async () => {
      const ctx = activeCtx();
      if (ctx?.provider instanceof MockGmailProvider) ctx.provider.failNextAttachmentCall();
    });

    // E2E 다운로드 dir 오버라이드 — 실제 사용자 Downloads 오염 방지 + 저장 경로/충돌 리네임 검증.
    ipcMain.handle('mail:debug-set-download-dir', async (_e, dir: string) => {
      downloadDirOverride = dir;
    });
```

- [ ] **Step 8: `preload.ts` — API + debug 훅 노출**

`preload.ts`의 api 객체, `createEvent`(55-56행) 아래에:

```typescript
  getAttachmentImage: (accountId: string, messageId: string, attachmentId: string, mimeType: string) =>
    ipcRenderer.invoke('mail:get-attachment-image', accountId, messageId, attachmentId, mimeType),
  downloadAttachment: (accountId: string, messageId: string, attachmentId: string, filename: string) =>
    ipcRenderer.invoke('mail:download-attachment', accountId, messageId, attachmentId, filename),
```

`if (process.argv.includes('--zenmail-e2e')) {` 블록 안, `api.__debugSetCalendarReady = ...`(119행) 아래에:

```typescript
  api.__debugFailNextAttachment = () => ipcRenderer.invoke('mail:debug-fail-next-attachment');
  api.__debugSetDownloadDir = (dir: string) => ipcRenderer.invoke('mail:debug-set-download-dir', dir);
```

- [ ] **Step 9: tsc + test**

Run: `cd zenmail && npx tsc --noEmit && npm test`
Expected: 둘 다 exit 0.

- [ ] **Step 10: 커밋**

```bash
cd zenmail && git add src/shared/types.ts src/main/download.ts src/main/download.test.ts src/main/ipc.ts src/main/preload.ts
git commit -m "feat(attachments): CP2 — IPC 4파일(mail:get-attachment-image·download-attachment)+download.ts 충돌 리네임+__debug 훅, vitest TC-ATT-F2"
```

---

### Task 3: renderer 인라인 cid: 이미지 해석 (prepareHtml/MessageCard) + 스토어 fetch 액션 (CP3)

**Files:**
- Modify: `zenmail/src/renderer/store/mail.ts` (`MailState` 액션 선언 211행 근처, 액션 구현 `showToast` 1200행 근처)
- Modify: `zenmail/src/renderer/components/ThreadView.tsx` (import 1-4, `prepareHtml` 9-45, `MessageCard` 47-114)

**Interfaces:**
- Consumes: `api().getAttachmentImage(accountId, messageId, attachmentId, mimeType)` (Task 2), `AttachmentInfo` (Task 1)
- Produces (Task 4가 소비):
  - `MailState.fetchAttachmentImage(messageId: string, attachmentId: string, mimeType: string): Promise<{ dataUri: string; mimeType: string } | { error: string }>`

- [ ] **Step 1: `mail.ts` — fetchAttachmentImage 액션 선언 + 구현**

`MailState` 인터페이스의 `showToast(msg: string): void;`(211행) 아래에 선언 추가:

```typescript
  fetchAttachmentImage(
    messageId: string,
    attachmentId: string,
    mimeType: string
  ): Promise<{ dataUri: string; mimeType: string } | { error: string }>;
```

`showToast` 액션(1200-1205행) **뒤**에 구현 추가:

```typescript
    async fetchAttachmentImage(messageId, attachmentId, mimeType) {
      const a = aid(get());
      if (!a) return { error: 'no account' };
      try {
        // IPC 핸들러가 실패를 {error}로 흡수하지만, needsReauth 등 throw 경로도 방어한다.
        return await api().getAttachmentImage(a, messageId, attachmentId, mimeType);
      } catch (err) {
        console.error('getAttachmentImage failed', err);
        return { error: String(err) };
      }
    },
```

- [ ] **Step 2: `ThreadView.tsx` — import 추가**

`ThreadView.tsx` 타입 import(3행)에 `AttachmentInfo` 추가, react import(1행)에 `useCallback`/`useEffect` 추가:

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMailStore, activeAccount, quoteHtml, CALENDAR_REAUTH_MSG } from '../store/mail';
import type { AttachmentInfo, MessageDetail, InviteInfo, RsvpResponse } from '../../shared/types';
import { labelChipFallback } from '../lib/theme';
```

- [ ] **Step 3: `prepareHtml` — cid: 이미지 치환**

`prepareHtml`(9-45행) 시그니처에 `inlineImages` 인자 추가하고, sanitize 이후 cid 치환을 넣는다. 전체 함수를 교체:

```typescript
/** Sanitize + prepare message HTML for the sandboxed frame. */
function prepareHtml(
  message: MessageDetail,
  opts: { showQuoted: boolean; allowImages: boolean; theme: 'light' | 'dark' },
  inlineImages: Map<string, string>
): { srcDoc: string; hasQuoted: boolean } {
  const raw = message.bodyHtml || `<pre style="white-space:pre-wrap">${message.bodyText}</pre>`;
  const doc = new DOMParser().parseFromString(raw, 'text/html');

  // defense in depth — the iframe sandbox already blocks script execution
  doc.querySelectorAll('script, iframe, object, embed, form').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
    }
  });

  // 인라인 cid: 이미지 치환(D7) — remote-image 게이트와 무관하게 항상 로드. 아직 도착 전이면
  // 빈 상태(alt) 유지. CSP img-src는 data:를 항상 허용하므로 별도 CSP 변경 불요.
  doc.querySelectorAll('img[src^="cid:"]').forEach((img) => {
    const cid = (img.getAttribute('src') ?? '').slice(4).replace(/^<|>$/g, '');
    const dataUri = inlineImages.get(cid);
    if (dataUri) img.setAttribute('src', dataUri);
  });

  const quoted = doc.querySelectorAll('.gmail_quote, blockquote');
  const hasQuoted = quoted.length > 0;
  if (!opts.showQuoted) quoted.forEach((el) => el.remove());

  const imgSrc = opts.allowImages ? "data: https: http:" : 'data:';
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; font-src data:;`;
  const srcDoc = `<!doctype html><html><head>
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <base target="_blank">
    <style>
      body { margin: 0; padding: 4px 0; background: transparent; color: ${
        opts.theme === 'dark' ? '#ececec' : '#18181b'
      };
             font: 13px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
             word-wrap: break-word; }
      a { color: #6366f1; }
      img { max-width: 100%; height: auto; }
      pre { white-space: pre-wrap; }
    </style>
  </head><body>${doc.body.innerHTML}</body></html>`;
  return { srcDoc, hasQuoted };
}
```

- [ ] **Step 4: `MessageCard` — inlineImages state + eager fetch + useMemo dep**

`MessageCard`(47-114행)의 상단 훅부(48-63행)를 아래로 교체(인라인 이미지 fetch 추가):

```typescript
function MessageCard({ message, isLast }: { message: MessageDetail; isLast: boolean }) {
  const [showQuoted, setShowQuoted] = useState(false);
  const [allowImages, setAllowImages] = useState(false);
  const [height, setHeight] = useState(120);
  const [inlineImages, setInlineImages] = useState<Map<string, string>>(new Map());
  const frameRef = useRef<HTMLIFrameElement>(null);

  const theme = useMailStore((s) => s.theme);
  const fetchAttachmentImage = useMailStore((s) => s.fetchAttachmentImage);

  // 인라인 이미지 mimetype 첨부만 mount 시 병렬 fetch(D6). 도착하는 대로 contentId→dataUri 갱신 →
  // srcDoc 재계산(useMemo deps에 inlineImages). 실패는 조용히 스킵(cid는 alt로 남음).
  useEffect(() => {
    const inline = (message.attachments ?? []).filter(
      (a) => a.inline && a.contentId && a.mimeType.startsWith('image/')
    );
    if (inline.length === 0) return;
    let cancelled = false;
    void Promise.all(
      inline.map(async (a) => {
        const res = await fetchAttachmentImage(message.id, a.attachmentId, a.mimeType);
        if (!cancelled && 'dataUri' in res && a.contentId) {
          setInlineImages((prev) => new Map(prev).set(a.contentId!, res.dataUri));
        }
      })
    );
    return () => {
      cancelled = true;
    };
  }, [message.id, message.attachments, fetchAttachmentImage]);

  const { srcDoc, hasQuoted } = useMemo(
    () => prepareHtml(message, { showQuoted, allowImages, theme }, inlineImages),
    [message, showQuoted, allowImages, theme, inlineImages]
  );

  const hasRemoteImages = useMemo(
    () => REMOTE_IMG_RE.test(message.bodyHtml),
    [message.bodyHtml]
  );
```

(47-63행 범위만 교체. 65행 이후 `return (...)` JSX와 이후는 Task 4에서 AttachmentStrip 마운트를 위해 다시 손댄다 — 이 스텝에서는 건드리지 않는다.)

- [ ] **Step 5: tsc + test**

Run: `cd zenmail && npx tsc --noEmit && npm test`
Expected: 둘 다 exit 0.

- [ ] **Step 6: 수동 확인 (데모)**

Run: `cd zenmail && npm start` → 데모 로그인 → "Attachments: brand kit" 스레드 열기.
Expected: 본문의 BrandCo 로고가 깨진 아이콘이 아니라 실제 이미지로 표시됨("Load remote images" 버튼 없이 자동). 확인 후 종료.

- [ ] **Step 7: 커밋**

```bash
cd zenmail && git add src/renderer/store/mail.ts src/renderer/components/ThreadView.tsx
git commit -m "feat(attachments): CP3 — prepareHtml cid: 이미지 치환+MessageCard inlineImages eager fetch(게이트 우회)+fetchAttachmentImage 스토어 액션"
```

---

### Task 4: 첨부 스트립 + 썸네일 + 라이트박스 + 다운로드 액션 + useKeyboard guard (CP4)

**Files:**
- Modify: `zenmail/src/renderer/store/mail.ts` (`MailState` 상태/액션 선언, `ACCOUNT_SCOPED_RESET` 60행 근처, 초기값, 액션 구현)
- Modify: `zenmail/src/renderer/components/ThreadView.tsx` (`AttachmentStrip`/`AttachmentItem` 신설, `MessageCard` JSX 마운트)
- Create: `zenmail/src/renderer/components/Lightbox.tsx`
- Modify: `zenmail/src/renderer/hooks/useKeyboard.ts` (modal guard 74-85, Esc-close 86-93)
- Modify: `zenmail/src/renderer/App.tsx` (import, 오버레이 마운트 47행 근처)

**Interfaces:**
- Consumes: `api().downloadAttachment(accountId, messageId, attachmentId, filename)` (Task 2), `fetchAttachmentImage` (Task 3), `AttachmentInfo` (Task 1), `showToast` (기존)
- Produces:
  - `MailState.lightboxImage: { dataUri: string; filename: string } | null`
  - `MailState.openLightbox(img: { dataUri: string; filename: string }): void`, `closeLightbox(): void`
  - `MailState.downloadAttachment(messageId: string, attachmentId: string, filename: string): Promise<void>`

- [ ] **Step 1: `mail.ts` — 상태/액션 선언 + ACCOUNT_SCOPED_RESET + 초기값**

`MailState` 인터페이스의 `fetchAttachmentImage(...)`(Task 3에서 추가) 아래에 선언:

```typescript
  lightboxImage: { dataUri: string; filename: string } | null;
  openLightbox(img: { dataUri: string; filename: string }): void;
  closeLightbox(): void;
  downloadAttachment(messageId: string, attachmentId: string, filename: string): Promise<void>;
```

`ACCOUNT_SCOPED_RESET`(47-73행)의 `agendaError: null as string | null,`(65행) 아래에:

```typescript
  lightboxImage: null as { dataUri: string; filename: string } | null,
```

초기 상태 객체(store create 내부, `rsvpStatus: new Map(),` 등이 있는 초기값 블록)의 `agendaError: null,`에 인접해 추가:

```typescript
    lightboxImage: null,
```

> 참고: 초기값은 `ACCOUNT_SCOPED_RESET`를 spread하는 위치가 있으면 그쪽에서 이미 커버될 수 있다. 스토어 초기 state가 `...ACCOUNT_SCOPED_RESET`를 포함하지 않는 경우에만 명시 초기값을 추가한다(중복 무해).

- [ ] **Step 2: `mail.ts` — 액션 구현**

`fetchAttachmentImage` 액션(Task 3) **뒤**에 추가:

```typescript
    openLightbox(img) {
      set({ lightboxImage: img });
    },

    closeLightbox() {
      set({ lightboxImage: null });
    },

    async downloadAttachment(messageId, attachmentId, filename) {
      const a = aid(get());
      if (!a) return;
      try {
        const res = await api().downloadAttachment(a, messageId, attachmentId, filename);
        if ('savedPath' in res) get().showToast(`다운로드 완료 · ${res.savedPath}`);
        else get().showToast('다운로드 실패');
      } catch (err) {
        console.error('downloadAttachment failed', err);
        get().showToast('다운로드 실패');
      }
    },
```

- [ ] **Step 3: `ThreadView.tsx` — AttachmentStrip/AttachmentItem 컴포넌트**

`ThreadView.tsx`의 `MessageCard` 컴포넌트(47-114행) **위**(REMOTE_IMG_RE 6행과 prepareHtml 사이, 또는 MessageCard 바로 위)에 추가:

```typescript
const ATT_ICON_RULES: { test: (m: string) => boolean; icon: string }[] = [
  { test: (m) => m.startsWith('image/'), icon: '🖼' },
  { test: (m) => m === 'application/pdf', icon: '📄' },
  { test: (m) => m.includes('zip') || m.includes('compressed') || m.includes('tar'), icon: '🗜' },
  { test: (m) => m.includes('word') || m.includes('document') || m.startsWith('text/'), icon: '📝' },
];
function attachmentIcon(mimeType: string): string {
  return ATT_ICON_RULES.find((r) => r.test(mimeType))?.icon ?? '📎';
}
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentItem({ messageId, att }: { messageId: string; att: AttachmentInfo }) {
  const fetchAttachmentImage = useMailStore((s) => s.fetchAttachmentImage);
  const download = useMailStore((s) => s.downloadAttachment);
  const openLightbox = useMailStore((s) => s.openLightbox);
  const isImage = att.mimeType.startsWith('image/');
  const [thumb, setThumb] = useState<string | null>(null);
  const [error, setError] = useState(false);

  // 이미지 mimetype 항목만 썸네일 fetch(D6). 항목 단위 에러 격리(FR17) — 실패해도 카드는 정상.
  const loadThumb = useCallback(() => {
    if (!isImage) return;
    setError(false);
    void fetchAttachmentImage(messageId, att.attachmentId, att.mimeType).then((res) => {
      if ('dataUri' in res) setThumb(res.dataUri);
      else setError(true);
    });
  }, [isImage, fetchAttachmentImage, messageId, att.attachmentId, att.mimeType]);

  useEffect(() => {
    loadThumb();
  }, [loadThumb]);

  return (
    <div
      data-testid="attachment-item"
      className="flex items-center gap-2 rounded-md border border-bg-border bg-bg-subtle px-2 py-1.5 text-[12px]"
    >
      {isImage && thumb && (
        <button aria-label={`Preview ${att.filename}`} onClick={() => openLightbox({ dataUri: thumb, filename: att.filename })}>
          <img data-testid="attachment-thumb" src={thumb} alt={att.filename} className="h-8 w-8 rounded object-cover" />
        </button>
      )}
      {isImage && !thumb && !error && (
        <span className="flex h-8 w-8 items-center justify-center text-text-muted">…</span>
      )}
      {(!isImage || error) && (
        <span className="flex h-8 w-8 items-center justify-center text-[16px]">
          {error ? '⚠️' : attachmentIcon(att.mimeType)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-text-primary">{att.filename}</div>
        {error ? (
          <button
            data-testid="attachment-error"
            onClick={loadThumb}
            className="text-[11px] text-red-500 hover:underline"
          >
            불러오기 실패 · 재시도
          </button>
        ) : (
          <div className="text-[11px] text-text-muted">{formatSize(att.size)}</div>
        )}
      </div>
      <button
        data-testid="attachment-download"
        aria-label={`Download ${att.filename}`}
        onClick={() => void download(messageId, att.attachmentId, att.filename)}
        className="shrink-0 rounded px-2 py-0.5 text-[13px] text-text-secondary hover:text-text-primary"
      >
        ↓
      </button>
    </div>
  );
}

function AttachmentStrip({ message }: { message: MessageDetail }) {
  // D4: 비인라인 첨부만 나열(인라인 cid 이미지는 본문에서 이미 렌더 → 스트립 제외).
  const items = (message.attachments ?? []).filter((a) => !a.inline);
  if (items.length === 0) return null;
  return (
    <div data-testid="attachment-strip" className="mt-2 flex flex-col gap-1">
      {items.map((a) => (
        <AttachmentItem key={a.attachmentId} messageId={message.id} att={a} />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: `MessageCard` JSX — iframe 아래에 AttachmentStrip 마운트**

`MessageCard`의 iframe(90-101행) **뒤**, `{hasQuoted && (...)}`(103행) **앞**에:

```typescript
      <AttachmentStrip message={message} />
```

- [ ] **Step 5: `Lightbox.tsx` 생성 (오버레이 템플릿)**

`zenmail/src/renderer/components/Lightbox.tsx`:

```typescript
import { useEffect, useRef } from 'react';
import { useMailStore } from '../store/mail';

export function Lightbox() {
  const img = useMailStore((s) => s.lightboxImage);
  const close = useMailStore((s) => s.closeLightbox);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (img) panelRef.current?.focus();
  }, [img]);

  if (!img) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50" onClick={close}>
      <div
        ref={panelRef}
        tabIndex={-1}
        data-testid="attachment-lightbox"
        className="zen-fade-in max-h-[90vh] max-w-[90vw] overflow-auto rounded-lg border border-bg-border bg-bg-subtle p-2 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
          e.stopPropagation();
        }}
      >
        <img src={img.dataUri} alt={img.filename} className="max-h-[80vh] max-w-full object-contain" />
        <div className="mt-1 truncate px-1 text-[11px] text-text-muted">{img.filename}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `useKeyboard.ts` — modal guard + Esc-close에 lightbox 등록**

modal guard 조건(74-85행)에 `s.eventComposerOpen ||`(82행) 아래로 추가:

```typescript
        s.agendaOpen ||
        s.eventComposerOpen ||
        s.lightboxImage !== null ||
        coach.cheatSheetOpen ||
        coach.statsOpen
```

Esc-close 블록(86-93행)에 `if (s.eventComposerOpen) s.closeEventComposer();`(90행) 아래로 추가:

```typescript
          if (s.eventComposerOpen) s.closeEventComposer();
          if (s.lightboxImage) s.closeLightbox();
```

- [ ] **Step 7: `App.tsx` — Lightbox 마운트**

`App.tsx` import(13행 `EventComposer` 아래)에:

```typescript
import { Lightbox } from './components/Lightbox';
```

`<EventComposer />`(47행) 아래에:

```typescript
      <Lightbox />
```

- [ ] **Step 8: tsc + test**

Run: `cd zenmail && npx tsc --noEmit && npm test`
Expected: 둘 다 exit 0.

- [ ] **Step 9: 수동 확인 (데모)**

Run: `cd zenmail && npm start` → 데모 로그인 → "Attachments: brand kit" 열기.
Expected: 본문 아래 첨부 스트립에 `brand-guide.pdf`(📄 아이콘)와 `cover.jpg`(썸네일). 인라인 로고는 스트립에 없음. 썸네일 클릭 시 라이트박스 확대, Esc로 닫힘, 라이트박스 열린 동안 `e`(아카이브) 무동작. 다운로드(↓) 클릭 시 "다운로드 완료 · ~/Downloads/brand-guide.pdf" 토스트. 확인 후 종료.

- [ ] **Step 10: 커밋**

```bash
cd zenmail && git add src/renderer/store/mail.ts src/renderer/components/ThreadView.tsx src/renderer/components/Lightbox.tsx src/renderer/hooks/useKeyboard.ts src/renderer/App.tsx
git commit -m "feat(attachments): CP4 — AttachmentStrip(비인라인·아이콘/썸네일/용량)+Lightbox 오버레이+downloadAttachment 액션, useKeyboard guard 두 곳 등록"
```

---

### Task 5: E2E TC-ATT 전건 + 무회귀 (CP5)

**Files:**
- Modify: `zenmail/e2e/run-tc.mjs` (calendar 헬퍼 519행 근처 뒤에 attachment 헬퍼, 시나리오 등록 759행 근처, 회귀 게이트 1008행 근처, 시나리오 함수 추가)

**Interfaces:**
- Consumes (렌더러 window API — Task 2/3/4): `window.zenmail.__debugFailNextAttachment()`, `__debugSetDownloadDir(dir)`; DOM: `[data-testid="attachment-strip"]`, `[data-testid="attachment-item"]`, `[data-testid="attachment-thumb"]`, `[data-testid="attachment-download"]`, `[data-testid="attachment-lightbox"]`, `[data-testid="attachment-error"]`, `iframe[title^="message-"]`
- Produces: 신규 harness PASS 15건(A1~A2, B1~B3, C1~C4, D1~D2, E1~E2, G1~G2). F1~F2는 vitest(attachments/download.test)로 `npm test`에서 커버되며 TC-ATT-G2가 참조.

- [ ] **Step 1: attachment 헬퍼 추가**

`run-tc.mjs`의 `tryCalScenario` 함수(519행) **뒤**, "Test scenarios" 영역 앞에:

```javascript
// ---------------------------------------------------------------------------
// attachments helpers
// ---------------------------------------------------------------------------

async function failNextAttachment(page) {
  await page.evaluate(() => window.zenmail.__debugFailNextAttachment());
}
async function setDownloadDir(page, dir) {
  await page.evaluate((d) => window.zenmail.__debugSetDownloadDir(d), dir);
}
async function openAttachmentThread(page) {
  await focusBody(page);
  await page.keyboard.press('g');
  await page.keyboard.press('i');
  await sleep(300);
  await clickRowContaining(page, 'Attachments: brand kit');
  await waitFor(async () => (await bodyText(page)).includes('brand kit'), { desc: 'attachment thread open' });
}
async function tryAttScenario(page, name, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`[harness] TC-ATT ${name} error:`, err);
    record(`TC-ATT-${name}`, 'FAIL', String(err).slice(0, 200));
  }
}
```

- [ ] **Step 2: 시나리오 함수 추가 (A/B/C/D/E)**

"Test scenarios" 영역(예: `scenario_cal_A` 정의 근처)에 추가:

```javascript
// --- TC-ATT-A/B/C/D/E: 첨부 표시·다운로드 ---
async function scenario_att(page) {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const nodePath = await import('node:path');
  const dlDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'zenmail-att-'));
  await setDownloadDir(page, dlDir);

  await openAttachmentThread(page);

  // A1: 본문 인라인 cid 이미지가 data: URI로 치환되어 렌더
  await waitFor(
    () =>
      page.evaluate(() => {
        const f = document.querySelector('iframe[title^="message-"]');
        const img = f?.contentDocument?.querySelector('img');
        return !!img && (img.getAttribute('src') ?? '').startsWith('data:');
      }),
    { desc: 'inline cid resolved to data: URI' }
  );
  record('TC-ATT-A1', 'PASS', 'inline cid image resolved to data: URI inside the sandboxed frame');
  // A2: remote-image 게이트 클릭 없이 자동 로드됨(위 waitFor가 버튼 없이 성립 = 자동 로드 증명)
  record('TC-ATT-A2', 'PASS', 'cid image auto-loaded without pressing "Load remote images"');

  // B: 비인라인 스트립 노출 + 인라인 제외 + 용량
  const stripText = await page.evaluate(
    () => document.querySelector('[data-testid="attachment-strip"]')?.textContent ?? ''
  );
  if (stripText.includes('brand-guide.pdf') && stripText.includes('cover.jpg')) {
    record('TC-ATT-B1', 'PASS', 'non-inline attachments (pdf, jpg) listed in strip');
  } else {
    record('TC-ATT-B1', 'FAIL', `strip: ${stripText.slice(0, 120)}`);
  }
  if (!stripText.includes('logo.png')) record('TC-ATT-B2', 'PASS', 'inline logo excluded from strip');
  else record('TC-ATT-B2', 'FAIL', 'inline logo leaked into strip');
  const itemCount = await page.evaluate(
    () => document.querySelectorAll('[data-testid="attachment-item"]').length
  );
  if (itemCount === 2 && /\d+\s?(B|KB|MB)/.test(stripText)) {
    record('TC-ATT-B3', 'PASS', 'icon + filename + human size shown; exactly 2 non-inline items');
  } else {
    record('TC-ATT-B3', 'FAIL', `count=${itemCount} sizeMatch=${/\d+\s?(B|KB|MB)/.test(stripText)}`);
  }

  // C1: 이미지 첨부 썸네일 표시
  await waitFor(() => page.evaluate(() => !!document.querySelector('[data-testid="attachment-thumb"]')), {
    desc: 'image thumbnail loaded',
  });
  record('TC-ATT-C1', 'PASS', 'image attachment shows a thumbnail (PDF shows icon only)');

  // C2: 썸네일 클릭 → 라이트박스 오픈
  await page.click('[data-testid="attachment-thumb"]');
  await waitFor(() => page.evaluate(() => !!document.querySelector('[data-testid="attachment-lightbox"]')), {
    desc: 'lightbox open',
  });
  record('TC-ATT-C2', 'PASS', 'thumbnail click opens the lightbox');

  // C4: 라이트박스 열린 동안 배경 단축키 차단
  await page.keyboard.press('e');
  await sleep(200);
  if (await page.evaluate(() => !!document.querySelector('[data-testid="attachment-lightbox"]'))) {
    record('TC-ATT-C4', 'PASS', "'e' archive blocked while lightbox open");
  } else {
    record('TC-ATT-C4', 'FAIL', 'lightbox closed / archive leaked');
  }

  // C3: Esc로 닫힘
  await page.keyboard.press('Escape');
  await sleep(200);
  if (!(await page.evaluate(() => !!document.querySelector('[data-testid="attachment-lightbox"]')))) {
    record('TC-ATT-C3', 'PASS', 'Esc closes the lightbox');
  } else {
    record('TC-ATT-C3', 'FAIL', 'lightbox still open after Esc');
  }

  // D1: PDF 다운로드 → 저장 경로 토스트 + 파일 존재(첫 다운로드 버튼 = brand-guide.pdf, 순서 보존)
  await page.click('[data-testid="attachment-download"]');
  await waitFor(async () => (await bodyText(page)).includes('다운로드 완료'), { desc: 'download toast' });
  const p1 = nodePath.join(dlDir, 'brand-guide.pdf');
  if (fs.existsSync(p1)) record('TC-ATT-D1', 'PASS', `saved to ${p1}`);
  else record('TC-ATT-D1', 'FAIL', `file not found: ${p1}`);

  // D2: 같은 첨부 재다운로드 → (1) 리네임
  await sleep(400);
  await page.click('[data-testid="attachment-download"]');
  await waitFor(async () => (await bodyText(page)).includes('brand-guide (1).pdf'), {
    timeout: 4000,
    desc: 'collision rename toast',
  });
  if (fs.existsSync(nodePath.join(dlDir, 'brand-guide (1).pdf'))) {
    record('TC-ATT-D2', 'PASS', 'second download renamed to brand-guide (1).pdf');
  } else {
    record('TC-ATT-D2', 'FAIL', 'renamed file not found');
  }

  // E1: fetch 실패 주입 → 항목 단위 에러, 카드 정상. 재오픈 시 이미지 fetch 2건(jpg 썸네일=자식 효과,
  // 인라인 로고=부모 효과)이 발생하는데, React는 자식 효과를 부모보다 먼저 실행하므로 jpg 썸네일의
  // getAttachment가 먼저 dispatch되고(동일 120ms delay → 삽입 순서대로 소진), one-shot 실패를 결정적으로
  // 소비한다 → 스트립 항목에 attachment-error가 뜬다(인라인 로고는 alt로 남고 카드는 무손상).
  await failNextAttachment(page);
  await page.keyboard.press('Escape'); // close thread
  await sleep(200);
  await openAttachmentThread(page);
  await waitFor(() => page.evaluate(() => !!document.querySelector('[data-testid="attachment-error"]')), {
    desc: 'per-item error surfaced',
  });
  if (await page.evaluate(() => !!document.querySelector('[data-testid="attachment-strip"]'))) {
    record('TC-ATT-E1', 'PASS', 'attachment fetch failure isolated to the item; card + strip alive');
  } else {
    record('TC-ATT-E1', 'FAIL', 'card broke on attachment fetch failure');
  }

  // E2: 다운로드 실패 주입 → 에러 토스트
  await failNextAttachment(page);
  await page.click('[data-testid="attachment-download"]');
  await waitFor(async () => (await bodyText(page)).includes('다운로드 실패'), { desc: 'download failure toast' });
  record('TC-ATT-E2', 'PASS', 'download failure → error toast, app still alive');

  await page.keyboard.press('Escape');
  await sleep(150);
}
```

- [ ] **Step 3: 시나리오 등록 (run 본문)**

`run()`의 CAL 블록(`tryCalScenario(page, 'E', ...)`, 759행) **뒤**, 그다음 블록(light-mode/mutate-restart) **앞**에:

```javascript
    // --- attachments: TC-ATT-A~E (docs/features/attachments/TC.md) — CAL 뒤, mutate+restart 앞.
    // 비파괴적(스레드 열람 + 임시 dir 다운로드)이라 세션을 그대로 두고 이어진다.
    await tryAttScenario(page, 'ATT', () => scenario_att(page));
```

- [ ] **Step 4: 회귀 게이트 TC-ATT-G1/G2 기록**

집계 계산부의 CAL 게이트(`preCalFails`/TC-CAL-G1/G2, 1008-1022행 근처) **뒤**, `console.log('\n=== TC Results ===');`(1024행) **앞**에:

```javascript
  // --- TC-ATT-G1/G2: attachments regression gates ---------------------------
  const preAttFails = results.filter((r) => !r.id.startsWith('TC-ATT') && r.status === 'FAIL');
  if (preAttFails.length === 0) {
    record(
      'TC-ATT-G1',
      'PASS',
      `all ${results.filter((r) => !r.id.startsWith('TC-ATT')).length} pre-existing assertions still PASS/SKIP with attachments wired in`
    );
  } else {
    record('TC-ATT-G1', 'FAIL', `${preAttFails.length} pre-existing (non-ATT) assertions failed: ${preAttFails.map((r) => r.id).join(', ')}`);
  }
  if (kmG2?.status === 'PASS' && kmG3?.status === 'PASS') {
    record('TC-ATT-G2', 'PASS', 'npm test + npx tsc --noEmit (incl. attachments/download vitest, TC-ATT-F1~F2) both exit 0 (reusing TC-KM-G2/G3)');
  } else {
    record('TC-ATT-G2', 'FAIL', `TC-KM-G2=${kmG2?.status} TC-KM-G3=${kmG3?.status}`);
  }
```

- [ ] **Step 5: E2E 전체 실행 — 무회귀 + 신규 전건 확인**

Run: `cd zenmail && node e2e/run-tc.mjs`
Expected: `=== TC Results ===` 블록에서
- 기존 200건 전부 PASS/SKIP 유지(0 FAIL), SKIP 집합 = `{TC-A4, TC-D5, TC-D8, TC-SY-C3, TC-SA-B4, TC-SY-B2}`의 부분집합(신규 SKIP 없음),
- 신규 TC-ATT-A1~A2, B1~B3, C1~C4, D1~D2, E1~E2, G1~G2 전부 PASS,
- 최종 집계 **215 PASS · 0 FAIL · 6 SKIP**. 프로세스 exit 0.

> 실행 결과 PASS 총계가 215와 다르면(±): 새 assertion 개수를 실제 집계와 대조해 커밋 메시지의 숫자만 실측값으로 맞춘다. 불변 조건은 **0 FAIL + SKIP 집합 무증가**이며, 이를 어기면 회귀로 간주하고 해당 CP로 돌아가 원인을 수정한다(참고: TC-SA-B4는 런타임 유동 SKIP — calendar D10 선례).

- [ ] **Step 6: 무회귀 재실행 (결정성 확인)**

Run: `cd zenmail && node e2e/run-tc.mjs`
Expected: 1회차와 동일 집계(결정적). 0 FAIL.

- [ ] **Step 7: 커밋**

```bash
cd zenmail && git add e2e/run-tc.mjs
git commit -m "feat(attachments): CP5 — E2E TC-ATT A~E(13)+G1/G2 회귀 게이트, 전체 무회귀(215 PASS·0 FAIL·6 SKIP ×2)"
```

---

## Self-Review

**1. Spec coverage (FR1~FR20 / CP1~CP5 / TC-ATT-A~G):**
- FR1 (extractBodies MIME walk 확장 → 첨부 수집): Task 1 Step 4 (`extractAttachments`). FR2 (AttachmentInfo + MessageDetail.attachments): Task 1 Step 1. FR3 (인라인 판정): Task 1 Step 4 (contentId + Content-Disposition:inline). FR4 (getAttachment Real/Mock): Task 1 Step 6/7/8.
- FR5 (get-attachment-image data URI, 실패 {error}): Task 2 Step 6. FR6 (download-attachment 다운로드 dir + 리네임 + writeFile): Task 2 Step 4/6. FR7 (sqlite 무저장 fresh fetch): Task 2 Step 6 주석 + provider 매 호출. FR8 (4-파일 계약): Task 1(gmail) + Task 2(types/ipc/preload).
- FR9 (prepareHtml cid 치환): Task 3 Step 3. FR10 (MessageCard eager fetch image only): Task 3 Step 4. FR11 (remote-image 게이트 분리, CSP data: 현행): Task 3 Step 3 (cid 치환은 allowImages와 무관).
- FR12 (AttachmentStrip 비인라인만): Task 4 Step 3 (`filter(a=>!a.inline)`). FR13 (아이콘+파일명+용량): Task 4 Step 3 (`attachmentIcon`/`formatSize`). FR14 (썸네일 병렬 fetch + 클릭 라이트박스): Task 4 Step 3. FR15 (라이트박스 오버레이 + guard 두 곳): Task 4 Step 5/6. FR16 (다운로드 버튼 → 토스트): Task 4 Step 2/3.
- FR17 (항목 단위 fetch 에러 + 재시도, 카드 무손상): Task 4 Step 3 (`attachment-error`/`loadThumb`). FR18 (다운로드 실패 토스트): Task 4 Step 2.
- FR19 (데모 첨부 시드 인라인 PNG+PDF+JPEG): Task 1 Step 8. FR20 (__debug 실패 주입 + 다운로드 dir 오버라이드): Task 2 Step 7 + Task 1 Step 8 (`failNextAttachmentCall`).
- CP1=Task 1, CP2=Task 2, CP3=Task 3, CP4=Task 4, CP5=Task 5. TC-ATT-A~E: Task 5 scenario_att; F1~F2: Task 1(extractAttachments)/Task 2(dedupeDownloadPath) vitest; G1/G2: Task 5 게이트.

**2. Placeholder scan:** 모든 코드 스텝에 실제 코드 블록·정확한 파일 경로/행 범위·실행 명령·기대 출력이 있음. "적절히 처리"류 문구 없음. 데모 fixture 바이트는 유효 base64로 명시(내용 non-load-bearing임을 주석에 표기).

**3. Type consistency (5개 문서 전반):** `AttachmentInfo`(attachmentId/filename/mimeType/size/contentId?/inline), `MessageDetail.attachments?`, `extractAttachments(part): AttachmentInfo[]`, `GmailProvider.getAttachment(messageId, attachmentId): Promise<string>`, IPC `getAttachmentImage(accountId, messageId, attachmentId, mimeType)`/`downloadAttachment(accountId, messageId, attachmentId, filename)`, 채널 `mail:get-attachment-image`/`mail:download-attachment`/`mail:debug-fail-next-attachment`/`mail:debug-set-download-dir`, `dedupeDownloadPath`/`writeDownload`, 스토어 `fetchAttachmentImage`/`downloadAttachment`/`lightboxImage`/`openLightbox`/`closeLightbox`, mock `failNextAttachmentCall`, debug 훅 `__debugFailNextAttachment`/`__debugSetDownloadDir`, testid `attachment-strip`/`attachment-item`/`attachment-thumb`/`attachment-download`/`attachment-lightbox`/`attachment-error` — 정의 태스크(1/2/3/4)와 소비 태스크(3/4/5) 전반에서 이름·시그니처 일치. **스펙 대비 조정 1건**(provider.getAttachment 반환 `string`, getAttachmentImage에 mimeType 인자): Global Constraints ⚠️ 항목에 근거 명시 — Gmail attachments.get이 mimeType을 반환하지 않는 사실에 기인한 정확성 보정.

---

## 후속 프로세스 (오케스트레이터 수행)

- 각 CP breaking change마다 `/react-best-practices` + `/code-review low` → 커밋 → `git@github.com:claud-park/mailer.git` main push.
- CP5 완료 후 최종 전체 브랜치 리뷰 + audit(/impeccable 미설치 시 web-design-guidelines/실측 대체) + Obsidian 체크포인트(`ZenMail.md` + vault index Active Projects 날짜 갱신) + 루트 `TODO.md`/`DEV_WORKFLOW.md` 스냅샷 갱신.
