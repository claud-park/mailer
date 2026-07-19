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

  // TC-ATT-F1 (수정): Content-Disposition이 없거나 attachment여도, 본문 HTML이 cid:로 참조하면 inline
  it('treats Content-ID parts referenced by the body as inline even without an inline disposition', () => {
    const payload = part({
      mimeType: 'multipart/related',
      parts: [
        part({
          mimeType: 'image/png',
          filename: 'logo.png',
          headers: [{ name: 'Content-ID', value: '<logo@zenmail>' }],
          body: { attachmentId: 'attL', size: 95 },
        }),
      ],
    });
    const out = extractAttachments(payload, '<img src="cid:logo@zenmail">');
    expect(out[0].inline).toBe(true);
  });

  it('does not mark a Content-ID part inline when the body never references it', () => {
    const payload = part({
      mimeType: 'multipart/mixed',
      parts: [
        part({
          mimeType: 'image/png',
          filename: 'logo.png',
          headers: [
            { name: 'Content-ID', value: '<logo@zenmail>' },
            { name: 'Content-Disposition', value: 'attachment; filename="logo.png"' },
          ],
          body: { attachmentId: 'attL', size: 95 },
        }),
      ],
    });
    const out = extractAttachments(payload, '<p>no image reference here</p>');
    expect(out[0].inline).toBe(false);
  });

  // Gmail은 작은 파트(GitHub Actions 알림 메일의 octicon 등)는 attachmentId 없이
  // body.data에 바이트를 직접 실어 보낸다 — 이 경우도 인라인 이미지로 수집해야 한다.
  it('embeds data directly when Gmail omits attachmentId for a small inline part', () => {
    const payload = part({
      mimeType: 'multipart/related',
      parts: [
        part({
          mimeType: 'image/png',
          filename: 'octocat-logo-805b5c3e249f.png',
          headers: [{ name: 'Content-ID', value: '<octocat-logo@github.com>' }],
          body: { data: 'aGVsbG8', size: 5 },
        }),
      ],
    });
    const out = extractAttachments(payload, '<img src="cid:octocat-logo@github.com">');
    expect(out).toEqual([
      {
        filename: 'octocat-logo-805b5c3e249f.png',
        mimeType: 'image/png',
        size: 5,
        contentId: 'octocat-logo@github.com',
        inline: true,
        inlineData: `data:image/png;base64,${Buffer.from('aGVsbG8', 'base64url').toString('base64')}`,
      },
    ]);
  });
});
