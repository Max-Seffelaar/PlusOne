/**
 * Mail-provider confinement guard (Mail-infra F0, z8uq9m2yvt), the sibling of
 * the billing stripe-confinement guard: every Resend interaction lives in
 * src/features/mail/ behind the MailProvider interface. Fails when
 *   1. the `resend` package is imported outside src/features/mail/ (static,
 *      dynamic `import()` or `require`), or
 *   2. the Resend API host is named outside it (the adapter is plain fetch, so
 *      a second hand-rolled caller would dodge rule 1), or
 *   3. anything under src/features/door/ imports the mail module: the door
 *      never sends or waits on mail (#25), or
 *   4. an Edge Function under supabase/functions/ names the Resend host or
 *      imports `resend`, except the platform digest (z8uq9m2ybj): Deno cannot
 *      import this directory, so that one function carries its own sender.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(process.cwd(), 'src');
const ALLOWED_DIR = path.join('features', 'mail');
const DOOR_DIR = path.join('features', 'door');

const RESEND_IMPORT = /(?:from\s+|import\s*\(\s*)['"]resend['"]|require\(\s*['"]resend['"]\s*\)/;
// Assembled so this test file is not itself a match.
const RESEND_HOST = ['api', 'resend', 'com'].join('.');
const MAIL_MODULE_IMPORT = /['"](?:@\/features\/mail|(?:\.\.\/)+mail)(?:\/[^'"]*)?['"]/;

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
const FUNCTIONS = path.resolve(process.cwd(), 'supabase', 'functions');
const FUNCTION_FILES = sourceFiles(FUNCTIONS);
const DIGEST_DIR = path.join(FUNCTIONS, 'platform-digest') + path.sep;
const inMail = (f: string) => path.relative(SRC, f).startsWith(ALLOWED_DIR + path.sep);

describe('mail provider confinement', () => {
  it('finds source files to scan (sanity — the walk is not empty)', () => {
    expect(FILES.length).toBeGreaterThan(50);
    expect(FILES.some(inMail)).toBe(true);
  });

  it('imports the resend package only from src/features/mail/ (static or dynamic)', () => {
    const offenders = FILES.filter((f) => !inMail(f) && RESEND_IMPORT.test(readFileSync(f, 'utf8'))).map(
      (f) => path.relative(SRC, f)
    );
    expect(offenders, `resend imported outside src/features/mail/: ${offenders.join(', ')}`).toEqual([]);
  });

  it('names the Resend API host only from src/features/mail/', () => {
    const offenders = FILES.filter((f) => !inMail(f) && readFileSync(f, 'utf8').includes(RESEND_HOST)).map((f) =>
      path.relative(SRC, f)
    );
    expect(offenders).toEqual([]);
  });

  it('no Edge Function but platform-digest talks to Resend', () => {
    expect(FUNCTION_FILES.some((f) => f.startsWith(DIGEST_DIR))).toBe(true);
    const offenders = FUNCTION_FILES.filter((f) => {
      if (f.startsWith(DIGEST_DIR)) return false;
      const src = readFileSync(f, 'utf8');
      return src.includes(RESEND_HOST) || RESEND_IMPORT.test(src);
    }).map((f) => path.relative(FUNCTIONS, f));
    expect(offenders).toEqual([]);
  });

  it('the regexes catch the forms they claim to (self-test)', () => {
    expect(RESEND_IMPORT.test(`import { Resend } from 'resend';`)).toBe(true);
    expect(RESEND_IMPORT.test(`const m = await import("resend");`)).toBe(true);
    expect(RESEND_IMPORT.test(`const m = require('resend');`)).toBe(true);
    expect(RESEND_IMPORT.test(`import x from '@/features/mail/resend-adapter';`)).toBe(false);
    expect(MAIL_MODULE_IMPORT.test(`import { sendTeamMail } from '@/features/mail/send';`)).toBe(true);
    expect(MAIL_MODULE_IMPORT.test(`import x from '../mail/send';`)).toBe(true);
  });

  it('the door never imports the mail module (#25: no mail on the door path)', () => {
    const offenders = FILES.filter(
      (f) => path.relative(SRC, f).startsWith(DOOR_DIR + path.sep) && MAIL_MODULE_IMPORT.test(readFileSync(f, 'utf8'))
    ).map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
