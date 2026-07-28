import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Guards the #2a code-split: the heavy/rare po screens must be loaded via
 * `next/dynamic` (their own lazy chunk), never statically imported by the app
 * shell — otherwise a door-only user pulls the Statistieken / Audit / Admin-sessies
 * / Aanvragen code on first paint and the /app First Load JS regresses. A source
 * assertion is deterministic (no jsdom / no mocking Next's dynamic loader); the
 * `next build` route table is the primary size evidence, this keeps it from
 * silently regressing.
 */
const SOURCE = readFileSync(fileURLToPath(new URL('./app.tsx', import.meta.url)), 'utf8');

// name → the screen module it must be dynamically imported from.
const LAZY_SCREENS: Record<string, string> = {
  Stats: './screens/stats',
  AuditLog: './screens/audit',
  AdminSessions: './screens/admin-sessions',
  Aanvragen: './screens/approvals',
  // #2b: the guest quick-add flow (parser + dedupe + lazy phone field) is split
  // straight from its leaf module, not the guests barrel.
  QuickAdd: './screens/guests/quick-add',
};

describe('po/app.tsx code-split (#2a)', () => {
  it('imports next/dynamic', () => {
    expect(SOURCE).toMatch(/import\s+dynamic\s+from\s+['"]next\/dynamic['"]/);
  });

  for (const [name, mod] of Object.entries(LAZY_SCREENS)) {
    it(`${name} is loaded via next/dynamic from ${mod}`, () => {
      // e.g. const Stats = dynamic(() => import('./screens/stats').then((m) => m.Stats), …)
      const dynamicRe = new RegExp(
        String.raw`const\s+${name}\s*=\s*dynamic\(\s*\(\)\s*=>\s*import\(['"]${mod}['"]\)`,
      );
      expect(SOURCE).toMatch(dynamicRe);
    });

    it(`${name} is NOT statically imported (would defeat the split)`, () => {
      // Any top-level `import { … ${name} … } from '…'` line re-eagerizes the chunk.
      const staticImportRe = new RegExp(
        String.raw`^import\s*\{[^}]*\b${name}\b[^}]*\}\s*from`,
        'm',
      );
      expect(SOURCE).not.toMatch(staticImportRe);
    });
  }

  it('keeps a lightweight loading fallback for the lazy screens', () => {
    // Common-path screens must not pay a Suspense cost, but the lazy ones need a
    // fallback so navigation to them is not a blank frame.
    expect(SOURCE).toMatch(/loading:\s*ScreenLoading/);
  });
});
