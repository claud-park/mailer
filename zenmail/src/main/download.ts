import fs from 'node:fs';
import path from 'node:path';

/**
 * 첨부파일명은 이메일 발신자가 MIME Content-Disposition/Content-Type의 filename 파라미터로
 * 임의 지정 가능(신뢰할 수 없음). path.join은 '..' 세그먼트를 정규화해버리므로, 디스크 쓰기
 * 싱크에 도달하기 전에 반드시 순수 파일명(basename)으로 걸러 대상 디렉터리 밖으로 못 나가게 한다.
 */
function sanitizeFilename(filename: string): string {
  const base = path.basename(filename);
  if (!base || base === '.' || base === '..') return 'attachment';
  return base;
}

/**
 * 확장자를 보존하며 충돌 시 ` (1)`, ` (2)` … 를 붙여 아직 존재하지 않는 경로를 반환한다.
 * (단일 사용자 데스크톱 앱이라 existsSync 기반 TOCTOU는 실질 문제 없음 — 동시 다운로드 희박.)
 */
export function dedupeDownloadPath(dir: string, filename: string): string {
  filename = sanitizeFilename(filename);
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
