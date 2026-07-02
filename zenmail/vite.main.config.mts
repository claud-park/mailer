import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // native modules + heavy CJS deps are required at runtime from node_modules
      external: ['better-sqlite3', 'keytar', 'googleapis', 'electron-squirrel-startup'],
    },
  },
});
