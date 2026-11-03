import { defineConfig } from 'vitest/config';

const testDb = process.env.TEST_DATABASE_URL ?? 'postgresql://finance:finance@localhost:5432/finance_test';

export default defineConfig({
  test: {
    env: { DATABASE_URL: testDb, NODE_ENV: 'test', JWT_SECRET: 'test-secret', TZ_NAME: 'Europe/Paris', AUTH_RATE_LIMIT: '10000' },
    globalSetup: ['tests/globalSetup.ts'],
    fileParallelism: false,
    coverage: { include: ['src/**'], exclude: ['src/index.ts', 'src/seed.ts'] },
  },
});
