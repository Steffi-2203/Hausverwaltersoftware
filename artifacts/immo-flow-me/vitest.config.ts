import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  test: {
    globals: false,
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts', 'server/__tests__/**/*.test.ts', 'server/routes/**/*.test.ts'],
    exclude: ['tests/loadtest.ts', 'tests/manual/**'],
    testTimeout: 30000,
    hookTimeout: 10000,
  },
});
