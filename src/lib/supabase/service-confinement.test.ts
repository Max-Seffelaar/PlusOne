/**
 * Secret-grep guard (CLAUDE.md "service_role" rule, launchplan DEEL D "secret-grep
 * in CI"). The service-role key bypasses RLS, so it must never reach a client
 * bundle. This runs inside `pnpm test` — which CI already executes — so the
 * invariant is enforced on every push/PR without a separate CI step:
 *
 *   1. `SUPABASE_SERVICE_ROLE_KEY` is referenced in exactly ONE module, the
 *      server-only service client.
 *   2. That module opts into `server-only`, so importing it from a Client
 *      Component is a build-time error (the structural boundary).
 *   3. No file carrying the `'use client'` directive imports the service client.
 *
 * A regression on any of these is exactly the leak CLAUDE.md says to "stop and fix
 * immediately" — here it fails the suite instead.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(process.cwd(), 'src');
const SERVICE_MODULE = path.join('lib', 'supabase', 'service.ts');
// The env var, assembled so this test file is not itself a "reference" to grep.
const SERVICE_ROLE_ENV = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');

/** Every .ts/.tsx under src/, excluding test files (a test may name the secret). */
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

describe('service-role key confinement (secret-grep)', () => {
  it('finds source files to scan (sanity — the walk is not empty)', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('references the service-role key in only the server-only service module', () => {
    const offenders = FILES.filter(
      (f) => !f.endsWith(SERVICE_MODULE) && readFileSync(f, 'utf8').includes(SERVICE_ROLE_ENV)
    ).map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('keeps the service client behind `server-only`', () => {
    const src = readFileSync(path.join(SRC, SERVICE_MODULE), 'utf8');
    expect(src).toMatch(/import\s+['"]server-only['"]/);
    expect(src).toContain(SERVICE_ROLE_ENV);
  });

  it('is never imported by a Client Component', () => {
    const offenders = FILES.filter((f) => {
      const src = readFileSync(f, 'utf8');
      const isClient = /^\s*['"]use client['"]/m.test(src);
      if (!isClient) return false;
      return /from\s+['"][^'"]*lib\/supabase\/service['"]/.test(src) || src.includes('createServiceClient');
    }).map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
