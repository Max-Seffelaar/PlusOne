/**
 * Stripe-confinement guard (FE-5 CI guardrail half, K4).
 *
 * CLAUDE.md's billing abstraction-layer rule: "All Stripe interaction lives in
 * `src/features/billing/` behind the `BillingProvider` interface (a vitest
 * guard fails if `stripe` is imported elsewhere, incl. dynamic imports)." No
 * such guard existed yet (verified: no test anywhere matched this rule) — this
 * closes that gap, mirroring the walk/offenders pattern of the sibling
 * `service-role` confinement guard (`src/lib/supabase/service-confinement.test.ts`).
 *
 * Catches both the static form (`import Stripe from 'stripe'`, `require('stripe')`)
 * and the dynamic form (`import('stripe')`, `await import('stripe')`) — a dynamic
 * import would otherwise dodge a naive static-import-only regex while still
 * pulling the Stripe SDK (and its trust boundary) into whatever module calls it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(process.cwd(), 'src');
const ALLOWED_DIR = path.join('features', 'billing');

// Static: `import ... from 'stripe'` / `import 'stripe'`. Dynamic: `import('stripe')`,
// with or without `await`/parens around it. Also `require('stripe')`. Anchored to the
// exact 'stripe' specifier (single or double quotes) so it doesn't match subpaths
// like '@/features/billing/stripe-adapter' or unrelated '...-stripe...' strings.
const STRIPE_IMPORT = /(?:from\s+|import\s*\(\s*)['"]stripe['"]|require\(\s*['"]stripe['"]\s*\)/;

/** Every .ts/.tsx under src/, excluding test files (a test may name the package). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC);

describe('stripe package confinement (billing abstraction layer)', () => {
  it('finds source files to scan (sanity — the walk is not empty)', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('imports the stripe package only from src/features/billing/ (static or dynamic)', () => {
    const offenders = FILES.filter((f) => {
      const rel = path.relative(SRC, f);
      if (rel.startsWith(ALLOWED_DIR + path.sep)) return false;
      return STRIPE_IMPORT.test(readFileSync(f, 'utf8'));
    }).map((f) => path.relative(SRC, f));

    expect(
      offenders,
      `These files import the 'stripe' package outside src/features/billing/: ` +
        `${offenders.join(', ')}. All Stripe interaction must go through the ` +
        'BillingProvider abstraction in src/features/billing/ (CLAUDE.md Billing #32).',
    ).toEqual([]);
  });
});
