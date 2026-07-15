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
