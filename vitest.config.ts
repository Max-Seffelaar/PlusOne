import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests cover pure logic (roles, schemas, error mapping, redirect guard).
// Node environment — no DOM needed. Playwright e2e lives under tests/e2e and is
// excluded here so `pnpm test` and `pnpm e2e` never overlap.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
