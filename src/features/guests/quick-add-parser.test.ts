import { describe, it, expect } from 'vitest';
import {
  parseQuickAdd,
  parseBulk,
  resolveAmbiguity,
  totalSlots,
  type QuickAddTier,
} from './quick-add-parser';

// Mirrors the seed tiers (supabase/seed.sql): Regular is the default; the
// fles-tier carries a multi-word alias and a champagne alias.
const TIERS: QuickAddTier[] = [
  { id: 'regular', name: 'Regular', aliases: [] },
  { id: 'vip', name: 'VIP', aliases: ['vip'] },
  { id: 'fles', name: 'VIP + fles op tafel', aliases: ['fles', 'champagne', 'vip fles'] },
];
const DEFAULT = 'regular';

const parse = (s: string) => parseQuickAdd(s, TIERS, DEFAULT);

describe('case (a) — bare name -> default tier, no question', () => {
  it('parses a plain name to the default tier with no plus-ones', () => {
    const r = parse('Juri Braakman');
    expect(r.status).toBe('ok');
    expect(r.name).toBe('Juri Braakman');
    expect(r.plusOnes).toBe(0);
    expect(r.slots).toBe(1);
    expect(r.tierId).toBe('regular');
    expect(r.matchedVia).toBe('default');
  });

  it('keeps a single-word name', () => {
    expect(parse('Madonna').name).toBe('Madonna');
  });

  it('preserves original casing and diacritics in the name', () => {
    const r = parse('José Çelik');
    expect(r.name).toBe('José Çelik');
    expect(r.tierId).toBe('regular');
  });

  it('collapses stray whitespace and tabs', () => {
    const r = parse('   Juri    Braakman   ');
    expect(r.name).toBe('Juri Braakman');
  });
});

describe('+N grammar', () => {
  it.each([
    ['Juri +2', 2],
    ['Juri + 2', 2],
    ['Juri +twee', 2],
    ['Juri plus 2', 2],
    ['Juri plus twee', 2],
    ['Juri plus2', 2],
    ['Juri p2', 2],
    ['Jan+2', 2],
    ['Juri plus tien', 10],
    ['Juri +0', 0],
    ['Juri plus een', 1],
  ])('parses %j as +%d', (input, expected) => {
    const r = parse(input as string);
    expect(r.plusOnes).toBe(expected);
    expect(r.slots).toBe(1 + (expected as number));
    expect(r.name).not.toContain('+');
    expect(r.name).not.toMatch(/\bplus\b|\bp2\b/i);
  });

  it('counts slots as 1 + plusOnes (decision #22)', () => {
    expect(parse('Jan +2').slots).toBe(3);
  });
});

describe('case (b) — recognised tier word (exact / fuzzy)', () => {
  it('matches an exact alias', () => {
    const r = parse('Juri Braakman vip');
    expect(r.tierId).toBe('vip');
    expect(r.matchedVia).toBe('exact');
    expect(r.name).toBe('Juri Braakman');
  });

  it('matches a single-word alias of the fles tier', () => {
    expect(parse('Sanne fles').tierId).toBe('fles');
  });

  it('prefers the longest multi-word alias (vip fles beats vip)', () => {
    const r = parse('Juri vip fles');
    expect(r.tierId).toBe('fles');
    expect(r.name).toBe('Juri');
  });

  it('matches the tier name itself, not only aliases', () => {
    expect(parse('Lotte Regular').tierId).toBe('regular');
  });

  it('fuzzy-matches a diminutive (flesje -> fles)', () => {
    const r = parse('Juri flesje');
    expect(r.tierId).toBe('fles');
    expect(r.matchedVia).toBe('fuzzy');
  });

  it('fuzzy-matches a doubled-letter typo (vipp -> vip)', () => {
    expect(parse('Juri vipp').tierId).toBe('vip');
  });

  it('combines +N with a tier, in either order', () => {
    expect(parse('Juri Braakman vip +2')).toMatchObject({ tierId: 'vip', plusOnes: 2, name: 'Juri Braakman' });
    expect(parse('Juri Braakman +2 vip')).toMatchObject({ tierId: 'vip', plusOnes: 2, name: 'Juri Braakman' });
    expect(parse('Juri +2 vip fles')).toMatchObject({ tierId: 'fles', plusOnes: 2, name: 'Juri' });
  });

  it('is case- and diacritic-insensitive on the tier word', () => {
    expect(parse('Juri VIP').tierId).toBe('vip');
  });
});

describe('case (c) — unrecognised extra word -> ask, never silent default', () => {
  it('flags a tier-like typo as ambiguous and suggests the tier', () => {
    const r = parse('Juri champ');
    expect(r.status).toBe('ambiguous');
    expect(r.name).toBe('Juri');
    expect(r.ambiguous?.text).toBe('champ');
    expect(r.ambiguous?.suggestions.map((s) => s.tierId)).toContain('fles');
    // crucially NOT silently the default tier
    expect(r.tierId).toBeUndefined();
  });

  it('does not ask for a genuine name that resembles nothing', () => {
    const r = parse('Juri Braakman'); // no tier-ish trailing word
    expect(r.status).toBe('ok');
  });
});

describe('randcases — names that contain trigger/tier words', () => {
  it('does not treat surname "Plus" as a plus-one trigger', () => {
    const r = parse('Plus Janssen');
    expect(r.plusOnes).toBe(0);
    expect(r.name).toBe('Plus Janssen');
  });

  it('does not treat a number-word first name as plus-ones', () => {
    const r = parse('Tien de Vries');
    expect(r.plusOnes).toBe(0);
    expect(r.name).toBe('Tien de Vries');
  });

  it('does not mis-tier a leading tier word ("Vip Janssen" is a name)', () => {
    const r = parse('Vip Janssen');
    expect(r.name).toBe('Vip Janssen');
    expect(r.tierId).toBe('regular');
  });

  it('does not read "p2" out of a name like "Pieter"', () => {
    const r = parse('Pieter +2');
    expect(r.name).toBe('Pieter');
    expect(r.plusOnes).toBe(2);
  });
});

describe('needs_name', () => {
  it('flags a tier word with no name', () => {
    const r = parse('vip');
    expect(r.status).toBe('needs_name');
    expect(r.tierId).toBe('vip');
  });

  it('flags a bare +N with no name', () => {
    const r = parse('+2');
    expect(r.status).toBe('needs_name');
    expect(r.plusOnes).toBe(2);
  });

  it('flags empty input', () => {
    expect(parse('   ').status).toBe('needs_name');
  });
});

describe('resolveAmbiguity', () => {
  const ambiguous = parse('Juri champ');

  it('"belongs to the name" folds the word back into the name', () => {
    expect(resolveAmbiguity(ambiguous, { kind: 'name' }, DEFAULT)).toEqual({
      name: 'Juri champ',
      plusOnes: 0,
      tierId: DEFAULT,
    });
  });

  it('choosing a tier drops the uncertain word', () => {
    expect(resolveAmbiguity(ambiguous, { kind: 'tier', tierId: 'fles' }, DEFAULT)).toEqual({
      name: 'Juri',
      plusOnes: 0,
      tierId: 'fles',
    });
  });

  it('choosing the default tier drops the uncertain word', () => {
    expect(resolveAmbiguity(ambiguous, { kind: 'default' }, DEFAULT)).toEqual({
      name: 'Juri',
      plusOnes: 0,
      tierId: DEFAULT,
    });
  });

  it('carries plus-ones through resolution', () => {
    const r = parse('Juri +3 champ');
    expect(resolveAmbiguity(r, { kind: 'name' }, DEFAULT).plusOnes).toBe(3);
  });
});

describe('parseBulk + totalSlots', () => {
  it('parses each non-empty line and skips blanks', () => {
    const results = parseBulk('Juri +2 vip\n\n  \nSanne\nLotte fles', TIERS, DEFAULT);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ name: 'Juri', tierId: 'vip', plusOnes: 2 });
    expect(results[1]).toMatchObject({ name: 'Sanne', tierId: 'regular' });
    expect(results[2]).toMatchObject({ name: 'Lotte', tierId: 'fles' });
  });

  it('marks lines that need a decision', () => {
    const results = parseBulk('Juri\nSanne champ', TIERS, DEFAULT);
    expect(results[0].status).toBe('ok');
    expect(results[1].status).toBe('ambiguous');
  });

  it('totals the quota impact across lines', () => {
    const results = parseBulk('Juri +2\nSanne\nLotte +1', TIERS, DEFAULT);
    expect(totalSlots(results)).toBe(3 + 1 + 2); // (1+2) + 1 + (1+1)
  });
});
