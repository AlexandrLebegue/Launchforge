import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    env: {
      DB_PATH: ':memory:',
      JWT_SECRET: 'test-secret-for-ci',
    },
  },
});
