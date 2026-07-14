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

describe('gap-sweep #36 — a bare trailing number is not an unbounded party size (86ey9e8bd)', () => {
  it('still reads a small bare trailing number as +N ("Naam 2")', () => {
    const r = parse('Naam 2');
    expect(r.name).toBe('Naam');
    expect(r.plusOnes).toBe(2);
  });

  it('does NOT read "Adele 25" as +25 — 25 stays part of the name', () => {
    const r = parse('Adele 25');
    expect(r.name).toBe('Adele 25');
    expect(r.plusOnes).toBe(0);
  });

  it('does NOT read "Blink 182" as +182 — 182 stays part of the name', () => {
    const r = parse('Blink 182');
    expect(r.name).toBe('Blink 182');
    expect(r.plusOnes).toBe(0);
  });

  it('does NOT read a mistyped huge trailing number as plus-ones ("Anna 9999999")', () => {
    const r = parse('Anna 9999999');
    expect(r.name).toBe('Anna 9999999');
    expect(r.plusOnes).toBe(0);
  });

  it('an explicit "+N" above the bare-number threshold still works', () => {
    const r = parse('Anna +25');
    expect(r.name).toBe('Anna');
    expect(r.plusOnes).toBe(25);
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

describe('e-mail + phone capture (#9)', () => {
  it('pulls an e-mail out of the line and keeps name/tier/+N', () => {
    const r = parse('Max Jansen max@host.nl +2 vip');
    expect(r.email).toBe('max@host.nl');
    expect(r.name).toBe('Max Jansen');
    expect(r.plusOnes).toBe(2);
    expect(r.tierId).toBe('vip');
    expect(r.phone).toBeNull();
  });

  it('pulls a NL mobile number out of the line', () => {
    const r = parse('Noor 0612345678');
    expect(r.phone).toBe('0612345678');
    expect(r.name).toBe('Noor');
    expect(r.plusOnes).toBe(0);
  });

  it('captures a contiguous international number and keeps the tier', () => {
    const r = parse('Sam +31612345678 vip');
    expect(r.phone).toBe('+31612345678');
    expect(r.name).toBe('Sam');
    expect(r.tierId).toBe('vip');
  });

  it('reads a trailing bare number as +N (name tier phone email N)', () => {
    const r = parse('piet hoi VIP 31646003664 hoi@hoi.nl 2');
    expect(r.name).toBe('piet hoi');
    expect(r.tierId).toBe('vip');
    expect(r.plusOnes).toBe(2);
    expect(r.phone).toBe('31646003664');
    expect(r.email).toBe('hoi@hoi.nl');
  });

  it('handles the full pasted format across lines', () => {
    const [a, b] = parseBulk(
      'jan dsadsa Regular 31646003600 Henk@henk.nl 1\nfreek VIP 31646003699 peit@piet.nl 5',
      TIERS,
      DEFAULT,
    );
    expect(a).toMatchObject({ name: 'jan dsadsa', tierId: 'regular', plusOnes: 1, phone: '31646003600', email: 'Henk@henk.nl' });
    expect(b).toMatchObject({ name: 'freek', tierId: 'vip', plusOnes: 5, phone: '31646003699', email: 'peit@piet.nl' });
  });

  it('never reads a phone number as +N plus-ones', () => {
    const r = parse('Jan 0612345678');
    expect(r.plusOnes).toBe(0);
    expect(r.phone).toBe('0612345678');
    // a real +N still parses, with no phone
    expect(parse('Jan +2').plusOnes).toBe(2);
    expect(parse('Jan +2').phone).toBeNull();
  });

  it('captures both e-mail and phone together', () => {
    const r = parse('Eva eva@host.com 0612345678 fles');
    expect(r.email).toBe('eva@host.com');
    expect(r.phone).toBe('0612345678');
    expect(r.name).toBe('Eva');
    expect(r.tierId).toBe('fles');
  });

  it('keeps a plus-addressed email whole instead of tearing it apart at the "+" (C20)', () => {
    const r = parse('Jan jan+vip@x.nl');
    expect(r.email).toBe('jan+vip@x.nl');
    expect(r.name).toBe('Jan');
    expect(r.plusOnes).toBe(0);
  });

  it('a plus-addressed email still leaves room for a real trailing +N and tier', () => {
    const r = parse('Jan jan+vip@x.nl +2 vip');
    expect(r.email).toBe('jan+vip@x.nl');
    expect(r.name).toBe('Jan');
    expect(r.plusOnes).toBe(2);
    expect(r.tierId).toBe('vip');
  });

  it('leaves email/phone null when absent', () => {
    const r = parse('Juri +2');
    expect(r.email).toBeNull();
    expect(r.phone).toBeNull();
  });

  it('carries contact fields through parseBulk', () => {
    const [a, b] = parseBulk('Max max@x.nl +1\nNoor 0612345678 vip', TIERS, DEFAULT);
    expect(a).toMatchObject({ name: 'Max', email: 'max@x.nl', plusOnes: 1 });
    expect(b).toMatchObject({ name: 'Noor', phone: '0612345678', tierId: 'vip' });
  });
});

describe('CSV-style columns (comma / semicolon / tab-separated paste)', () => {
  it('reads a comma-separated "name, email, phone, tier" row', () => {
    const r = parse('Anouk Smit, anouk@mail.com, 0612345601, vip');
    expect(r.name).toBe('Anouk Smit');
    expect(r.email).toBe('anouk@mail.com');
    expect(r.phone).toBe('0612345601');
    expect(r.tierId).toBe('vip');
  });

  it('captures a phone written with spaces between groups (own column)', () => {
    const r = parse('Femke Bakker, femke@mail.com, 06 12 34 56 01, fles');
    expect(r.phone).toBe('0612345601');
    expect(r.email).toBe('femke@mail.com');
    expect(r.name).toBe('Femke Bakker');
    expect(r.tierId).toBe('fles');
  });

  it('handles semicolon and tab delimiters', () => {
    expect(parse('Pim; pim@mail.com; 0612345602; vip')).toMatchObject({ name: 'Pim', email: 'pim@mail.com', phone: '0612345602', tierId: 'vip' });
    expect(parse('Roos\t0612345603\tvip')).toMatchObject({ name: 'Roos', phone: '0612345603', tierId: 'vip' });
  });

  it('a comma-separated name-only row stays a bare name (default tier)', () => {
    const r = parse('Koen Hendriks');
    expect(r.name).toBe('Koen Hendriks');
    expect(r.email).toBeNull();
    expect(r.phone).toBeNull();
    expect(r.matchedVia).toBe('default');
  });

  it('parses a full pasted CSV block line by line', () => {
    const [a, b] = parseBulk('Anouk Smit, anouk@mail.com, 0612345601, vip\nKoen Hendriks', TIERS, DEFAULT);
    expect(a).toMatchObject({ name: 'Anouk Smit', email: 'anouk@mail.com', phone: '0612345601', tierId: 'vip' });
    expect(b).toMatchObject({ name: 'Koen Hendriks', tierId: 'regular' });
  });
});
