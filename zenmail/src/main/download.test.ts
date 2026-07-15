import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dedupeDownloadPath, writeDownload } from './download';

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

  // 보안: path traversal 방지 — 첨부파일명은 이메일 발신자가 임의로 지정 가능(Content-Disposition)
  it('sanitizes traversal-style filenames to stay inside the target dir', () => {
    const dir = tmp();
    const result = dedupeDownloadPath(dir, '../../etc/passwd');
    expect(path.dirname(result)).toBe(dir);
    expect(path.relative(dir, result).startsWith('..')).toBe(false);
  });

  it('sanitizes deeper traversal-style filenames to stay inside the target dir', () => {
    const dir = tmp();
    const result = dedupeDownloadPath(dir, '../../../Library/LaunchAgents/evil.plist');
    expect(path.dirname(result)).toBe(dir);
    expect(path.relative(dir, result).startsWith('..')).toBe(false);
  });
});

describe('writeDownload', () => {
  // 보안: path traversal 방지 — 실제 쓰기 경로도 대상 디렉터리 밖으로 나가지 않아야 함
  it('writes traversal-style filenames inside the target dir', async () => {
    const dir = tmp();
    const result = await writeDownload(dir, '../../etc/passwd', Buffer.from('x'));
    expect(path.dirname(result)).toBe(dir);
    expect(fs.existsSync(result)).toBe(true);
  });
});
