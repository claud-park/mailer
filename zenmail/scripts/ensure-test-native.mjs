#!/usr/bin/env node
// pretest: vitest(Node ABI)용 better-sqlite3 바이너리를 .test-native/에 1회 빌드해 두고,
// node_modules의 바이너리는 항상 Electron ABI로 유지한다.
//
// 배경(2026-07-15 attachments 세션 인시던트 → 2026-07-19 근본 수정): 종전 pretest
// `npm rebuild better-sqlite3`는 node_modules 바이너리 자체를 Node ABI로 뒤집어, npm test 직후의
// 모든 Electron 실행(앱·E2E 하네스 전 세션)이 "auth:sign-in-demo ERR_DLOPEN_FAILED"로 로그인에서
// 전멸했다. Forge의 리빌드 캐시 마커는 이 뒤집힘을 감지하지 못한다. 이제 Node ABI 빌드는 테스트
// 전용 사본(.test-native/, ABI 버전별 파일명)으로 격리되고 vitest만 nativeBinding으로 그걸 쓴다
// (vitest.setup.mts). 사본이 이미 있으면 이 스크립트는 즉시 종료라 npm test 오버헤드는 0에 수렴.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abi = process.versions.modules;
const target = path.join(root, '.test-native', `better_sqlite3-abi${abi}.node`);
const built = path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');

if (existsSync(target)) process.exit(0);

console.log(`[ensure-test-native] building Node-ABI(${abi}) better-sqlite3 test copy (one-time)…`);
execSync('npm rebuild better-sqlite3', { cwd: root, stdio: 'inherit' });
mkdirSync(path.dirname(target), { recursive: true });
copyFileSync(built, target);
console.log('[ensure-test-native] restoring Electron-ABI binary in node_modules…');
execSync('./node_modules/.bin/electron-rebuild --force --only better-sqlite3', { cwd: root, stdio: 'inherit' });
console.log(`[ensure-test-native] done — test binary at ${path.relative(root, target)}`);
