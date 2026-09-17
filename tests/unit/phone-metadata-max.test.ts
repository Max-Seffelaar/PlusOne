/**
 * Phone metadata build guard (86eyke279).
 *
 * The landing form makes a phone number REQUIRED. A required field is only
 * worth anything if it refuses a non-number — and the default
 * `react-phone-number-input` entry does not: it ships libphonenumber's `min`
 * metadata, which knows each country's LENGTH BANDS but not its numbering plan.
 * Measured against the installed 3.4.17 / libphonenumber-js 1.13.6:
 *
 *     isValidPhoneNumber('+3112345')  →  min/default: true    max: false
 *
 * so `12345` typed into the NL field was accepted by the form and stored as
 * `+3112345`, a number nobody can call. The DB regex `^\+[1-9][0-9]{1,14}$` is
 * a deliberate SHAPE check and cannot catch it either.
 *
 * Two things are locked here:
 *  1. behaviour — `/max` refuses the reported case while keeping a real NL
 *     mobile AND a real NL landline valid (`/mobile` would drop the landline);
 *  2. wiring — every phone entry point resolves to the SAME `/max` build. A
 *     mixed set both bundles two metadata blobs and lets the input format a
 *     number the validator then rejects.
 *
 * This complements `phone-lazy-imports.test.ts` (which keeps the library OUT of
 * First Load JS); it does not replace or relax it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isValidPhoneNumber as isValidMin } from 'react-phone-number-input';
import { isValidPhoneNumber as isValidMax } from 'react-phone-number-input/max';
import { isPhoneValid } from '@/components/po/phone-lazy';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

/** The reported blocker: `12345` in the NL field normalises to this. */
const NOT_A_NUMBER = '+3112345';
/** Must stay valid — a real NL mobile. */
const NL_MOBILE = '+31612345678';
/** Must stay valid — a real NL landline (this is why `/mobile` is wrong). */
const NL_LANDLINE = '+31201234567';

describe('phone validation uses the /max numbering-plan metadata (86eyke279)', () => {
  it('reproduces why the default entry was not enough', () => {
    // Documents the bug rather than asserting the fix: min accepts the junk.
    expect(isValidMin(NOT_A_NUMBER)).toBe(true);
  });

  it('refuses a number that only passes a length-band check', () => {
    expect(isValidMax(NOT_A_NUMBER)).toBe(false);
  });

  it('keeps real Dutch mobile AND landline numbers valid', () => {
    expect(isValidMax(NL_MOBILE)).toBe(true);
    expect(isValidMax(NL_LANDLINE)).toBe(true);
  });

  it('keeps international numbers valid', () => {
    expect(isValidMax('+447911123456')).toBe(true);
    expect(isValidMax('+14155552671')).toBe(true);
  });

  it('still refuses numbers that were already refused', () => {
    for (const bad of ['+31612345', '+3161234567890', '+312']) {
      expect(isValidMax(bad), bad).toBe(false);
    }
  });
});

describe("the app's own isPhoneValid (what the landing form calls)", () => {
  it('refuses the reported blocker', async () => {
    // RED before 86eyke279's metadata switch: the default entry answered true
    // here, so `12345` in the NL field submitted and stored as '+3112345'.
    await expect(isPhoneValid(NOT_A_NUMBER)).resolves.toBe(false);
  });

  it('accepts a real Dutch mobile and a real Dutch landline', async () => {
    await expect(isPhoneValid(NL_MOBILE)).resolves.toBe(true);
    await expect(isPhoneValid(NL_LANDLINE)).resolves.toBe(true);
  });

  it('accepts international numbers', async () => {
    await expect(isPhoneValid('+447911123456')).resolves.toBe(true);
    await expect(isPhoneValid('+14155552671')).resolves.toBe(true);
  });
});

describe('every phone entry point resolves to the same /max metadata build', () => {
  const CASES: { file: string; specifiers: string[] }[] = [
    {
      file: 'src/components/po/phone-lazy.tsx',
      // The lazily-imported input build + both validators.
      specifiers: [
        'react-phone-number-input/input-max',
        'react-phone-number-input/max',
      ],
    },
    {
      file: 'src/components/po/country-select.tsx',
      specifiers: ['react-phone-number-input/max'],
    },
  ];

  for (const { file, specifiers } of CASES) {
    it(`${file} imports only /max phone builds`, () => {
      const src = read(file);
      for (const spec of specifiers) {
        expect(src.includes(spec), `${file} should import from '${spec}'`).toBe(true);
      }

      // No value import may resolve to a non-max build. `import type … ` is
      // fine (types carry no metadata), and the two asset subpaths (`/flags`,
      // `/locale/*`) are metadata-free.
      const offenders = [
        ...src.matchAll(
          /(?:^|[^.\w])import\s+(?!type\s)[^;]*?from\s+['"](react-phone-number-input(?:\/[^'"]*)?)['"]|import\(\s*['"](react-phone-number-input(?:\/[^'"]*)?)['"]\s*\)/g,
        ),
      ]
        .map((m) => m[1] ?? m[2])
        .filter((spec): spec is string => Boolean(spec))
        .filter(
          (spec) =>
            !spec.endsWith('/max') &&
            !spec.endsWith('/input-max') &&
            spec !== 'react-phone-number-input/flags' &&
            !spec.startsWith('react-phone-number-input/locale/'),
        );

      expect(
        offenders,
        `${file} pulls a non-/max phone build. The default and /input entries ship ` +
          `libphonenumber's 'min' metadata, which accepts '${NOT_A_NUMBER}' — the ` +
          `86eyke279 blocker. Use 'react-phone-number-input/max' and ` +
          `'react-phone-number-input/input-max'.`,
      ).toEqual([]);
    });
  }
});
