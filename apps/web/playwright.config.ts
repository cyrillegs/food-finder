import { defineConfig } from '@playwright/test';

// BASE_URL lets this suite target any deployed environment (local dev,
// staging, production) without editing the test files themselves - same
// idea as Delta's `test:staging` pattern, just driven by an env var here
// instead of a separate npm script per environment.
const baseURL = process.env.BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
});
