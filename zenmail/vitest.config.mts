import { defineConfig } from 'vitest/config';

// setupFiles만 추가 — 테스트 발견 규칙 등은 vitest 디폴트 그대로.
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.mts'],
  },
});
