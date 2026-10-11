/**
 * Review #466 round 3: the DB and the app must agree on what an "invisible"
 * character is, for EVERY code point — not a hand-picked list.
 *
 * Postgres regex has no \p{}, so the migration carries explicit ranges. This
 * test parses the class out of 20261016140100_actor_names_hardening.sql and
 * proves, walking U+0001..U+10FFFF:
 *   1. the migration's invisible class == INVISIBLE_RANGES (profile-name.ts),
 *      and its space class == SPACE_RANGES;
 *   2. every code point this runtime's Unicode tables call
 *      Default_Ignorable_Code_Point, Cc or Cf is in the list (so the DB refuses
 *      everything the app's \p{} regex refuses);
 *   3. any listed code point the runtime does NOT call DI/Cc/Cf is unassigned
 *      in this runtime (Cn) — i.e. the list is only ever ahead of an older
 *      runtime's Unicode version, never wrong about an assigned character.
 * U+0000 is out of scope: Postgres text cannot contain it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALLOWED_IN_NAME,
  INVISIBLE_RANGES,
  INVISIBLE_RANGES_UNICODE_VERSION,
  SPACE_RANGES,
} from './profile-name';

type Range = [number, number];

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261016140100_actor_names_hardening.sql'),
  'utf8',
);
const BS = String.fromCharCode(92);

/** Parse a Postgres bracket class body (\uXXXX, \UXXXXXXXX, literal chars, a-b ranges). */
function parseClass(body: string): Range[] {
  const cps: number[] = [];
  const isRange: boolean[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] === '-' && cps.length > 0) {
      isRange[cps.length] = true;
      i += 1;
      continue;
    }
    if (body[i] === BS && body[i + 1] === 'u') {
      cps.push(parseInt(body.slice(i + 2, i + 6), 16));
      i += 6;
    } else if (body[i] === BS && body[i + 1] === 'U') {
      cps.push(parseInt(body.slice(i + 2, i + 10), 16));
      i += 10;
    } else {
      const cp = body.codePointAt(i)!;
      cps.push(cp);
      i += cp > 0xffff ? 2 : 1;
    }
  }
  const out: Range[] = [];
  for (let k = 0; k < cps.length; k++) {
    if (isRange[k + 1]) {
      out.push([cps[k]!, cps[k + 1]!]);
      k += 1;
    } else {
      out.push([cps[k]!, cps[k]!]);
    }
  }
  return merge(out);
}

function merge(ranges: ReadonlyArray<readonly [number, number]>): Range[] {
  const sorted = [...ranges].map(([a, b]) => [a, b] as Range).sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

function inRanges(cp: number, ranges: Range[]): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = ranges[mid]!;
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return true;
  }
  return false;
}

// The KEY class: profile_name_key strips it after NFKC.
const keyBody = /NFKC\), '\[([^\]]+)\]', '', 'g'/.exec(MIGRATION)?.[1];
// The REFUSED class: the CHECK's full_name !~ '[...]' (and the sanitizer).
const invisibleBody = /full_name !~ '\[([^\]]+)\]'/.exec(MIGRATION)?.[1];
const sanitizerBody = /new\.full_name := regexp_replace\(coalesce\(new\.full_name, ''\), '\[([^\]]+)\]'/.exec(MIGRATION)?.[1];

/** INVISIBLE_RANGES minus the code points a stored name may keep. */
function minusAllowed(ranges: ReadonlyArray<readonly [number, number]>): Range[] {
  const out: Range[] = [];
  for (const [a, b] of ranges) {
    let start = -1;
    for (let cp = a; cp <= b; cp++) {
      const keep = !ALLOWED_IN_NAME.has(cp);
      if (keep && start < 0) start = cp;
      if (!keep && start >= 0) {
        out.push([start, cp - 1]);
        start = -1;
      }
    }
    if (start >= 0) out.push([start, b]);
  }
  return merge(out);
}

/** a.b version compare: true when runtime <= stamp. */
function unicodeAtOrBelow(runtime: string, stamp: string): boolean {
  const [ra = 0, rb = 0] = runtime.split('.').map(Number);
  const [sa = 0, sb = 0] = stamp.split('.').map(Number);
  return ra < sa || (ra === sa && rb <= sb);
}
// profile_name_key's space class: the second regexp_replace, '[...]+', ' '
const spaceBody = /'\[([^\]]+)\]\+', ' ', 'g'/.exec(MIGRATION)?.[1];

describe('profile name: the migration and the app agree on every code point', () => {
  it('finds the key, refused, sanitizer and space classes in the migration', () => {
    expect(keyBody).toBeTruthy();
    expect(invisibleBody).toBeTruthy();
    expect(sanitizerBody).toBeTruthy();
    expect(spaceBody).toBeTruthy();
  });

  it('1. SQL == app, unconditionally: key class = INVISIBLE_RANGES, refused class = minus the allowed joiners', () => {
    expect(parseClass(keyBody!)).toEqual(merge(INVISIBLE_RANGES));
    // The CHECK and the sanitizer refuse the same set, and that set is the key
    // set minus U+200C / U+200D / U+FE0F (allowed in a stored name, round 4).
    expect(sanitizerBody).toBe(invisibleBody);
    expect(parseClass(invisibleBody!)).toEqual(minusAllowed(INVISIBLE_RANGES));
    for (const cp of ALLOWED_IN_NAME) expect(parseClass(keyBody!).some(([a, b]) => cp >= a && cp <= b)).toBe(true);
    expect(parseClass(spaceBody!)).toEqual(merge(SPACE_RANGES));
  });

  it('2 + 3. the list covers every DI/Cc/Cf code point of this runtime, and nothing assigned besides', () => {
    const runtime = process.versions.unicode ?? '0.0';
    if (!unicodeAtOrBelow(runtime, INVISIBLE_RANGES_UNICODE_VERSION)) {
      // A runtime NEWER than the list may know DI/Cf code points we have not
      // listed yet. Not a CI failure: regenerate INVISIBLE_RANGES (+ the
      // migration's class, + the stamp) when you move to it.
      console.info(
        `profile-name cross-check: runtime Unicode ${runtime} > list ${INVISIBLE_RANGES_UNICODE_VERSION}; coverage direction skipped`,
      );
      return;
    }
    const listed = merge(INVISIBLE_RANGES);
    const invisible = /^[\p{Default_Ignorable_Code_Point}\p{Cc}\p{Cf}]$/u;
    const unassigned = /^\p{Cn}$/u;
    const missing: string[] = [];
    const wrong: string[] = [];
    for (let cp = 1; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue; // surrogates are not characters
      const ch = String.fromCodePoint(cp);
      const isInvisible = invisible.test(ch);
      const isListed = inRanges(cp, listed);
      if (isInvisible && !isListed) missing.push(cp.toString(16));
      else if (!isInvisible && isListed && !unassigned.test(ch)) wrong.push(cp.toString(16));
    }
    expect(missing, 'DI/Cc/Cf code points the DB class does not refuse').toEqual([]);
    expect(wrong, 'listed code points this runtime knows are visible').toEqual([]);
  });

  it('the space list is only separators + the braille blank', () => {
    const sep = /^[\p{Zs}\p{Zl}\p{Zp}]$/u;
    for (const [a, b] of SPACE_RANGES) {
      for (let cp = a; cp <= b; cp++) {
        expect(sep.test(String.fromCodePoint(cp)) || cp === 0x2800).toBe(true);
      }
    }
  });
});
