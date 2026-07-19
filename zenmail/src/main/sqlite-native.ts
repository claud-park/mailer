/**
 * better-sqlite3 생성 옵션 — vitest에서만 Node-ABI 테스트 사본(nativeBinding)을 주입한다.
 * node_modules의 바이너리는 Electron ABI로 유지되므로(scripts/ensure-test-native.mjs 참고) 이 env
 * 없이 vitest가 Database를 열면 ERR_DLOPEN_FAILED. env는 vitest.setup.mts만 세팅하며 Electron
 * 런타임에서는 항상 빈 옵션이다.
 */
export function sqliteNativeOptions(): { nativeBinding?: string } {
  const nativeBinding = process.env.ZENMAIL_TEST_NATIVE_BINDING;
  return nativeBinding ? { nativeBinding } : {};
}
