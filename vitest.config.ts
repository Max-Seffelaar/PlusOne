import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Unit tests (Vitest). Pure-logic suites run in node; component suites opt into
// jsdom with a `// @vitest-environment jsdom` docblock at the top of the file.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
