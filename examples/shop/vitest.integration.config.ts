import { defineConfig } from 'vitest/config';

// The integration tier (spec §9.3): tests that reach a real service. They run as a check of
// their own, the only one given credentials and the network.
export default defineConfig({
  test: { include: ['src/**/*.itest.ts'], testTimeout: 30_000, hookTimeout: 30_000 },
});
