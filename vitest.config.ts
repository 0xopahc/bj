import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./tests/global-setup.ts'],
    hookTimeout: 180_000,
    testTimeout: 120_000,
    fileParallelism: false,
    isolate: true,
    maxWorkers: 1,
    sequence: { concurrent: false },
  },
});
