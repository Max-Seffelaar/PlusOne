import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests (Vitest). Pure-logic suites run in node; component suites opt into
// jsdom with a `// @vitest-environment jsdom` docblock at the top of the file.
// Playwright e2e lives under tests/e2e and is excluded so `pnpm test` and
// `pnpm e2e` never overlap.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
