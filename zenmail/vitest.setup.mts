// vitest 전 테스트 파일 공통 셋업 — Node ABI용 better-sqlite3 테스트 사본(nativeBinding) 주입.
// node_modules의 바이너리는 Electron ABI를 유지하므로(scripts/ensure-test-native.mjs), 이 env 없이
// cache.ts/accounts.ts가 Database를 열면 vitest에서 ERR_DLOPEN_FAILED가 난다.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const native = path.join(root, '.test-native', `better_sqlite3-abi${process.versions.modules}.node`);
if (existsSync(native)) process.env.ZENMAIL_TEST_NATIVE_BINDING = native;
