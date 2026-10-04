import { defineConfig } from 'vitest/config';

// Unit tests: jsdom because lib/stats.ts reads localStorage and dispatches CustomEvents.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});