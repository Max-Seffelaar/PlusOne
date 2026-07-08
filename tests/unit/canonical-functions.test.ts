/**
 * K10 drift guard (full-app review 2026-07-07, ClickUp 86ey6xej7).
 *
 * `audit_trigger`, `run_privacy_retention`, `submit_guest_request` and
 * `approve_guest_request` are each redefined via `create or replace function`
 * across many migrations, historically kept in sync only by a "keep this in
 * LOCKSTEP" comment — which has already regressed prod GDPR behaviour twice.
 *
 * This scans every migration (in filename/timestamp order — the order they
 * actually apply in) for the LAST `create or replace function public.<name>`
 * per function — i.e. what's deployed today — and fails the suite if it
 * doesn't match the checked-in canonical body in supabase/canonical/. See
 * supabase/canonical/README.md for the update procedure.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const CANONICAL_DIR = path.join(ROOT, 'supabase', 'canonical');

const FUNCTIONS = [
  'audit_trigger',
  'run_privacy_retention',
  'submit_guest_request',
  'approve_guest_request',
] as const;

/** Line-ending + trailing-whitespace normalization only — a real body change
 * (the thing this guard exists to catch) still fails after this. */
function normalize(sql: string): string {
  return sql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

function canonicalBody(name: string): string {
  const raw = readFileSync(path.join(CANONICAL_DIR, `${name}.sql`), 'utf8');
  const idx = raw.indexOf('create or replace function');
  if (idx === -1) throw new Error(`supabase/canonical/${name}.sql has no create-or-replace statement`);
  return normalize(raw.slice(idx));
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** The LAST `create or replace function public.<name>(...) ... $$;` body
 * across every migration, in chronological (filename-timestamp) order. */
function newestDeployedBody(name: string): { file: string; sql: string } | null {
  const pattern = new RegExp(`create or replace function public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`, 'g');
  let found: { file: string; sql: string } | null = null;
  for (const file of migrationFiles()) {
    const content = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const matches = content.match(pattern);
    if (matches && matches.length > 0) {
      found = { file, sql: normalize(matches[matches.length - 1]) };
    }
  }
  return found;
}

describe('canonical function bodies (K10 drift guard)', () => {
  it.each(FUNCTIONS)('%s: finds at least one create-or-replace across migrations', (name) => {
    expect(newestDeployedBody(name)).not.toBeNull();
  });

  it.each(FUNCTIONS)(
    '%s: the newest deployed migration body matches supabase/canonical/%s.sql',
    (name) => {
      const deployed = newestDeployedBody(name)!;
      expect(deployed.sql, `drifted in ${deployed.file} vs supabase/canonical/${name}.sql`).toBe(
        canonicalBody(name)
      );
    }
  );
});
