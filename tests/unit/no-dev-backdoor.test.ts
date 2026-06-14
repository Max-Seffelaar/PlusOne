import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Guardrail for the LOCAL-ONLY dev fast-login (docs/auth-setup.md §9):
// `scripts/dev-code.mjs` + the verified TOTP factor seeded in
// `supabase/seed.sql` under the fixed secret below.
//
// Only `supabase/migrations/**` reaches a real database (via `supabase db
// push`); `seed.sql` and `scripts/` never do. So the one unacceptable mistake
// is letting this backdoor leak into a migration or into the shipped app
// bundle. These tests fail CI if that happens. They stay GREEN both while the
// dev shortcut exists (it lives only in seed + scripts) and after it is removed
// at go-live — see the checklist in docs/launch.md.

const ROOT = process.cwd();
const DEV_TOTP_SECRET = 'PLUSONELOCALADMINDEVSECRET234567';

function collectSql(dir: string): string {
  if (!existsSync(dir)) return '';
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

function walk(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

describe('local dev fast-login must never reach production', () => {
  const migrations = collectSql(join(ROOT, 'supabase', 'migrations'));

  it('no migration embeds the dev TOTP secret', () => {
    // Migrations are the only SQL that `supabase db push` applies to prod.
    expect(migrations).not.toContain(DEV_TOTP_SECRET);
  });

  it('no migration writes to auth.mfa_factors', () => {
    // Catches a promoted factor even if its secret were changed. Factors are
    // only ever seeded locally; production enrolls real authenticators.
    expect(/insert\s+into\s+auth\.mfa_factors/i.test(migrations)).toBe(false);
  });

  it('the dev secret never enters the shipped app bundle (src/**)', () => {
    const offenders = walk(join(ROOT, 'src'), ['.ts', '.tsx', '.js', '.jsx', '.mjs']).filter(
      (file) => readFileSync(file, 'utf8').includes(DEV_TOTP_SECRET)
    );
    expect(offenders, `dev secret found in: ${offenders.join(', ')}`).toEqual([]);
  });
});
