import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // All package tests live alongside sources under packages/*/src.
    include: ['zero-maintenance-data-layer/packages/*/src/**/*.spec.ts'],
    // Type-level tests are run with `tsc`, not vitest.
    passWithNoTests: false,
  },
});
