import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts', 'tests/e2e/**/*.test.ts'],
    globalSetup: ['tests/setup/globalSetup.ts'],
    setupFiles: ['tests/setup/timezone.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    typecheck: { tsconfig: './tsconfig.test.json' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
