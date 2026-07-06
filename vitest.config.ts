import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests (Vitest). Pure-logic suites run in node; component suites opt into
// jsdom with a `// @vitest-environment jsdom` docblock at the top of the file.
// `esbuild.jsx: 'automatic'` gives `.tsx` component tests (e.g. the virtualized
// CheckInList) the React automatic JSX runtime without an ESM-only plugin — the
// config is CJS-loaded, so a `@vitejs/plugin-react` import would fail. Playwright
// e2e lives under tests/e2e and is excluded so `pnpm test`/`pnpm e2e` never overlap.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/unit/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `import 'server-only'` is a compiler-level marker Next provides without
      // an installed package; stub it so server modules are unit-testable.
      'server-only': fileURLToPath(new URL('./tests/unit/server-only-stub.ts', import.meta.url)),
    },
  },
});
