import { defineConfig } from 'vitest/config';

// The stored demo candidates under demo/ contain test files of their own. Only src/ is the service.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
