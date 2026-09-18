/**
 * No-em-dash-in-copy guard (z8uq9m0hw1, Joeri walkthrough — tone-of-voice.md §4b).
 *
 * Em-dashes (and en-dashes used as a dash) read as AI-written copy. A 2026-09
 * sweep rewrote every real sentence in the message catalogue (and the handful
 * of hardcoded non-i18n copy strings shipped outside it) to use a period,
 * comma, colon, parentheses, or a restructure instead. This guard keeps that
 * regression class from coming back:
 *
 * 1. Walks the composed i18n catalogue (`t` from `src/lib/i18n`) recursively
 *    and fails on any string containing `—` or `–`, with one deliberate
 *    exception: a string that is EXACTLY `—` is an empty-value placeholder
 *    used throughout stats/table cells (e.g. `quotaSubUnknownValue`), not a
 *    dash-as-punctuation usage — that pattern is left alone by design.
 * 2. Does the same for a small, explicit list of files that ship hardcoded
 *    English copy outside the catalogue (billing gate/action error strings,
 *    the door's outbox toasts, the MFA forms, the 404 page title, the PWA
 *    manifest name, one cockpit feed line). Comments are stripped before
 *    scanning — this codebase's engineering comments use em-dashes freely by
 *    house style, and that is not the thing this guard polices — so the
 *    check targets only string literals and rendered JSX/JSON text.
 *
 * Deliberately NOT covered (see the PR body for the full inventory): bare
 * `'—'` empty-value placeholders scattered across screens/adapters/queries,
 * an en-dash used as a NUMBER RANGE separator (`21–40`, not "used as a
 * dash"), server-only log/Sentry messages users never see, and the
 * `sentry-test` diagnostics page (404s in production, not shipped copy).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { t } from '@/lib/i18n';

const ROOT = process.cwd();

const DASH = /[—–]/; // em-dash, en-dash
const BARE_PLACEHOLDER = '—'; // exact-match exception (empty-value cells)

/** Recursively collects `{ path: 'a.b.c', value: '...' }` for every string leaf. */
function collectStrings(obj: unknown, keyPath: string, out: { path: string; value: string }[]): void {
  if (typeof obj === 'string') {
    out.push({ path: keyPath, value: obj });
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      collectStrings(v, keyPath ? `${keyPath}.${k}` : k, out);
    }
  }
}

describe('no em-dash / en-dash in the i18n catalogue', () => {
  it('finds catalogue strings to scan (sanity — the walk is not empty)', () => {
    const strings: { path: string; value: string }[] = [];
    collectStrings(t, '', strings);
    expect(strings.length).toBeGreaterThan(100);
  });

  it('never uses — or – as punctuation in a catalogue string', () => {
    const strings: { path: string; value: string }[] = [];
    collectStrings(t, '', strings);

    const offenders = strings
      .filter(({ value }) => DASH.test(value) && value !== BARE_PLACEHOLDER)
      .map(({ path: p, value }) => `t.${p}: "${value}"`);

    expect(
      offenders,
      `These catalogue strings contain an em-dash or en-dash used as punctuation: ` +
        `${offenders.join(', ')}. Rewrite with a period, comma, colon, parentheses, or a ` +
        `restructure (tone-of-voice.md §4b) — never swap in an en-dash or spaced hyphen. ` +
        `A string that is EXACTLY '—' (an empty-value placeholder) is the one allowed case.`,
    ).toEqual([]);
  });
});

// Files that ship hardcoded English copy OUTSIDE the i18n catalogue. Kept as an
// explicit, small list (not a repo-wide scan): the codebase's engineering
// comments use em-dashes freely as house style, so a blind scan would be all
// false positives. Add a file here only when it carries real user-facing copy.
const HARDCODED_COPY_FILES = [
  'src/features/billing/gate.ts',
  'src/features/billing/actions.ts',
  'src/features/door/DoorProvider.tsx',
  'src/features/auth/components/MfaChallengeForm.tsx',
  'src/features/auth/components/MfaEnrollCard.tsx',
  'src/app/not-found.tsx',
  'src/features/po/eventday/EventDayCockpit.tsx',
];

/** Strips `/* … *\/` (incl. JSX `{/* … *\/}`) and trailing `//` comments. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** A dash that is NOT the exact bare `'—'`/`"—"` placeholder token. */
const DASH_OR_BARE_PLACEHOLDER = /['"]—['"]|[—–]/g;

function findDisallowedDashes(src: string): { line: number; text: string }[] {
  const stripped = stripComments(src);
  const problems: { line: number; text: string }[] = [];
  stripped.split('\n').forEach((line, i) => {
    DASH_OR_BARE_PLACEHOLDER.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DASH_OR_BARE_PLACEHOLDER.exec(line))) {
      if (m[0] === "'—'" || m[0] === '"—"') continue; // allowed bare placeholder
      problems.push({ line: i + 1, text: line.trim() });
      break; // one flag per line is enough to point at the offender
    }
  });
  return problems;
}

describe('no em-dash / en-dash in hardcoded non-i18n copy', () => {
  it('scans a non-empty, tracked file list (sanity)', () => {
    expect(HARDCODED_COPY_FILES.length).toBeGreaterThan(0);
    for (const rel of HARDCODED_COPY_FILES) {
      expect(() => readFileSync(path.join(ROOT, rel), 'utf8'), `missing file: ${rel}`).not.toThrow();
    }
  });

  it.each(HARDCODED_COPY_FILES)('%s has no dash-as-punctuation in real code', (rel) => {
    const src = readFileSync(path.join(ROOT, rel), 'utf8');
    const offenders = findDisallowedDashes(src);

    expect(
      offenders,
      `${rel} has an em-dash/en-dash used as punctuation outside a comment: ` +
        `${offenders.map((o) => `L${o.line}: ${o.text}`).join(' | ')}. Rewrite with a period, ` +
        `comma, colon, parentheses, or a restructure (tone-of-voice.md §4b).`,
    ).toEqual([]);
  });
});

describe('no em-dash / en-dash in the PWA manifest name', () => {
  it('public/manifest.json "name" has no dash-as-punctuation', () => {
    const manifest = JSON.parse(readFileSync(path.join(ROOT, 'public', 'manifest.json'), 'utf8')) as {
      name?: string;
    };
    expect(manifest.name).toBeTruthy();
    expect(DASH.test(manifest.name ?? '')).toBe(false);
  });
});
