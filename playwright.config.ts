import { defineConfig } from '@playwright/test';

// End-to-end tests only. They drive the real UI in the installed Edge browser:
// the fixture-mode tests against a static build, the rest against a real decker server.
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    channel: 'msedge',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -w @decker/web -- --port 4173 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
