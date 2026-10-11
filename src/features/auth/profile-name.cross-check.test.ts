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
import { INVISIBLE_RANGES, SPACE_RANGES } from './profile-name';

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

// The CHECK's "no invisible character" clause: full_name !~ '[...]'
const invisibleBody = /full_name !~ '\[([^\]]+)\]'/.exec(MIGRATION)?.[1];
// profile_name_key's space class: the second regexp_replace, '[...]+', ' '
const spaceBody = /'\[([^\]]+)\]\+', ' ', 'g'/.exec(MIGRATION)?.[1];

describe('profile name: the migration and the app agree on every code point', () => {
  it('finds both classes in the migration', () => {
    expect(invisibleBody).toBeTruthy();
    expect(spaceBody).toBeTruthy();
  });

  it('every occurrence of the invisible class in the migration is the same class', () => {
    const all = [...MIGRATION.matchAll(/'\[(\\u0001[^\]]+)\]'/g)].map((m) => m[1]);
    expect(all.length).toBeGreaterThanOrEqual(3); // key function, CHECK, sanitizer
    for (const body of all) expect(body).toBe(invisibleBody);
  });

  it('1. the migration class equals INVISIBLE_RANGES and SPACE_RANGES', () => {
    expect(parseClass(invisibleBody!)).toEqual(merge(INVISIBLE_RANGES));
    expect(parseClass(spaceBody!)).toEqual(merge(SPACE_RANGES));
  });

  it('2 + 3. the list covers every DI/Cc/Cf code point of this runtime, and nothing assigned besides', () => {
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
