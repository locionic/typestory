import { defineConfig } from 'vitest/config';

// E2E smoke tests: node environment, they drive a real browser against a real server.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/e2e/**/*.e2e.ts'],
    // Booting Next + Chrome is slow; keep it serial so ports/CPU don't fight.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});