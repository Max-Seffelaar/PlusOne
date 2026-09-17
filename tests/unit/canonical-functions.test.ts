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

/** Matches bare `create function` too, not just `create or replace` — a
 * migration that changes the function's arg list has to `drop` + plain
 * `create` (postgres refuses `or replace` across a signature change), and
 * that body must not go invisible to the guard the way it did once already
 * (20260706103000 dropped the 7-arg overload via a bare `create function`;
 * supabase/canonical/submit_guest_request.sql kept describing that stale
 * 7-arg body for six migrations before 86eyke279 caught it by accident). */
function functionPattern(name: string): RegExp {
  return new RegExp(`create (?:or replace )?function public\\.${name}\\s*\\([\\s\\S]*?\\$\\$;`, 'g');
}

/** The LAST `create [or replace] function public.<name>(...) ... $$;` body
 * across every migration, in chronological (filename-timestamp) order. */
function newestDeployedBody(name: string): { file: string; sql: string } | null {
  const pattern = functionPattern(name);
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

describe('functionPattern (regex) — must not go blind to a signature-change migration', () => {
  // 20260706103000 dropped submit_guest_request's 7-arg overload with a bare
  // `create function` (no `or replace` — postgres rejects `or replace` across
  // an arg-list change) and the guard missed it for six migrations. This
  // proves the pattern still matches that shape, so a future arg-list change
  // can't repeat it silently.
  it('matches a bare `create function` (no `or replace`)', () => {
    const sample = [
      'create function public.audit_trigger(p_extra text)',
      'returns trigger language plpgsql as $$',
      'begin',
      '  return new;',
      'end;',
      '$$;',
    ].join('\n');
    expect(functionPattern('audit_trigger').test(sample)).toBe(true);
  });

  it('still matches `create or replace function` (unchanged behaviour)', () => {
    const sample = [
      'create or replace function public.audit_trigger()',
      'returns trigger language plpgsql as $$',
      'begin',
      '  return new;',
      'end;',
      '$$;',
    ].join('\n');
    expect(functionPattern('audit_trigger').test(sample)).toBe(true);
  });
});
