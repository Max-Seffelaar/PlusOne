import { describe, it, expect } from 'vitest';
import {
  parseQuickAdd,
  parseBulk,
  bulkLines,
  isHeaderLine,
  pasteSummary,
  repairPastedPhone,
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
    // In a PASTED block (decisions Max 2026-10-10): `31` + 9 digits is an NL
    // number Excel stripped the `+` from → +31…, and a bare last number is the
    // TOTAL number of people (1 = just the guest, 5 = guest +4). Quick add keeps
    // the raw phone and reads a bare number as +N.
    expect(a).toMatchObject({ name: 'jan dsadsa', tierId: 'regular', plusOnes: 0, phone: '+31646003600', email: 'Henk@henk.nl' });
    expect(b).toMatchObject({ name: 'freek', tierId: 'vip', plusOnes: 4, phone: '+31646003699', email: 'peit@piet.nl' });
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

describe('shared / pasted lists (share-import S2)', () => {
  it('"Milan Hendriks +2" is one guest with two extra', () => {
    const [r] = parseBulk('Milan Hendriks +2', TIERS, DEFAULT);
    expect(r).toMatchObject({ name: 'Milan Hendriks', plusOnes: 2, slots: 3, tierId: 'regular' });
  });

  it('"Fleur Janssen fleur@example.com" is a guest with an e-mail', () => {
    const [r] = parseBulk('Fleur Janssen fleur@example.com', TIERS, DEFAULT);
    expect(r).toMatchObject({ name: 'Fleur Janssen', email: 'fleur@example.com', plusOnes: 0 });
  });

  it('reads Name<TAB>Email<TAB>count rows copied out of Sheets/Excel', () => {
    const rows = parseBulk('Milan Hendriks\tmilan@example.com\t2\nFleur Janssen\t\t\nSem de Vries\tsem@example.com', TIERS, DEFAULT);
    expect(rows).toHaveLength(3);
    // A bare number in its own column is the TOTAL number of people: 2 = the
    // guest +1 (decision Max 2026-10-10; was +2 before).
    expect(rows[0]).toMatchObject({ name: 'Milan Hendriks', email: 'milan@example.com', plusOnes: 1 });
    expect(rows[1]).toMatchObject({ name: 'Fleur Janssen', email: null, plusOnes: 0 });
    expect(rows[2]).toMatchObject({ name: 'Sem de Vries', email: 'sem@example.com' });
  });

  it('skips a header row on the first line (tab, comma, Dutch)', () => {
    expect(parseBulk('Name\tEmail\nMilan Hendriks\tmilan@example.com', TIERS, DEFAULT).map((r) => r.name)).toEqual(['Milan Hendriks']);
    expect(bulkLines('Naam, E-mail, Telefoon\nFleur')).toEqual(['Fleur']);
    expect(bulkLines('Full name;Phone number;+1\nSem')).toEqual(['Sem']);
  });

  it('never skips a real guest as a header', () => {
    expect(isHeaderLine('Email')).toBe(false); // no name column → not a header
    expect(isHeaderLine('Milan Hendriks, milan@example.com')).toBe(false);
    expect(isHeaderLine('Name Hendriks')).toBe(false);
    // Only the first line is ever checked.
    expect(bulkLines('Milan\nName, Email')).toEqual(['Milan', 'Name, Email']);
  });

  it('strips bullets and numbering from Notes / WhatsApp lists', () => {
    expect(bulkLines('- Milan +2\n• Fleur\n* Sem\n1. Noor\n12) Daan\n– Lotte')).toEqual([
      'Milan +2', 'Fleur', 'Sem', 'Noor', 'Daan', 'Lotte',
    ]);
    // "+2" and phone numbers are not list markers.
    expect(bulkLines('+2 Milan\n06 12345678 Fleur')).toEqual(['+2 Milan', '06 12345678 Fleur']);
  });

  it('counts entries, total guests and e-mails for the preview', () => {
    const rows = parseBulk(
      'Name\tEmail\nMilan Hendriks +2\nFleur Janssen fleur@example.com\nSem +1\nNoor noor@example.com\nDaan\nLotte +2',
      TIERS,
      DEFAULT,
    );
    expect(pasteSummary(rows)).toEqual({ entries: 6, guests: 11, withEmail: 2 });
  });
});

// Share-import follow-up (decisions Max 2026-10-10): a range pasted from Excel or
// Sheets — tab-separated, with a header — is read by column. Max's paste; rows 3,
// 5 and 6 are reconstructed (his message showed three of the six) to match his
// expectations: tickets 1→+0, 2→+1, 4→+3, 6→+5, 17 people in total.
describe('pasted spreadsheet columns (share-import follow-up)', () => {
  const COLUMN_TIERS: QuickAddTier[] = [...TIERS, { id: 'guest', name: 'Guest', aliases: [] }];
  const MAX_PASTE = [
    'Voornaam\tAchternaam\tAantal tickets\tTier\tEmail\tTelefoonnummer',
    'Henk\tAchternaam\t1\tvip\tmax.seffelaar+1@gmail.com\t646003664',
    'Freek\tAchternaam\t2\tvip\tmax.seffelaar+2@gmail.com\t600000000',
    'Anna\tAchternaam\t2\tGUEST\tmax.seffelaar+3@gmail.com\t600000001',
    'Bas\tAchternaam\t6\tGUEST\tmax.seffelaar+4@gmail.com\t600000002',
    'Lisa\tAchternaam\t4\tvip\tmax.seffelaar+5@gmail.com\t600000003',
    'Tom\tAchternaam\t2\tGUEST\tmax.seffelaar+6@gmail.com\t600000004',
  ].join('\n');

  it("reads Max's paste by column: name, tickets as total people, tier, e-mail, +31 phone", () => {
    const rows = parseBulk(MAX_PASTE, COLUMN_TIERS, DEFAULT);
    expect(rows.map((r) => [r.name, r.plusOnes, r.tierId, r.email, r.phone, r.status])).toEqual([
      ['Henk Achternaam', 0, 'vip', 'max.seffelaar+1@gmail.com', '+31646003664', 'ok'],
      ['Freek Achternaam', 1, 'vip', 'max.seffelaar+2@gmail.com', '+31600000000', 'ok'],
      ['Anna Achternaam', 1, 'guest', 'max.seffelaar+3@gmail.com', '+31600000001', 'ok'],
      ['Bas Achternaam', 5, 'guest', 'max.seffelaar+4@gmail.com', '+31600000002', 'ok'],
      ['Lisa Achternaam', 3, 'vip', 'max.seffelaar+5@gmail.com', '+31600000003', 'ok'],
      ['Tom Achternaam', 1, 'guest', 'max.seffelaar+6@gmail.com', '+31600000004', 'ok'],
    ]);
    expect(pasteSummary(rows)).toEqual({ entries: 6, guests: 17, withEmail: 6 });
  });

  it('the same rows without a header: the small number column is total people, the 9-digit one a phone', () => {
    const rows = parseBulk(MAX_PASTE.split('\n').slice(1).join('\n'), COLUMN_TIERS, DEFAULT);
    expect(rows.map((r) => [r.name, r.plusOnes, r.tierId, r.email, r.phone])).toEqual([
      ['Henk Achternaam', 0, 'vip', 'max.seffelaar+1@gmail.com', '+31646003664'],
      ['Freek Achternaam', 1, 'vip', 'max.seffelaar+2@gmail.com', '+31600000000'],
      ['Anna Achternaam', 1, 'guest', 'max.seffelaar+3@gmail.com', '+31600000001'],
      ['Bas Achternaam', 5, 'guest', 'max.seffelaar+4@gmail.com', '+31600000002'],
      ['Lisa Achternaam', 3, 'vip', 'max.seffelaar+5@gmail.com', '+31600000003'],
      ['Tom Achternaam', 1, 'guest', 'max.seffelaar+6@gmail.com', '+31600000004'],
    ]);
  });

  it('a header with tel/phone/telefoon/mobiel makes that column a phone, whatever it holds', () => {
    const [r] = parseBulk('Naam\tMobiel\nNoor Bakker\t31612345678', TIERS, DEFAULT);
    expect(r).toMatchObject({ name: 'Noor Bakker', phone: '+31612345678', plusOnes: 0 });
    const [s] = parseBulk('Name,Phone\nSem,0031612345678', TIERS, DEFAULT);
    expect(s).toMatchObject({ name: 'Sem', phone: '+31612345678' });
  });

  it('count words in the header: tickets / aantal / personen / people / qty / guests', () => {
    for (const title of ['Tickets', 'Aantal', 'Personen', 'People', 'Qty', 'Guests']) {
      const [r] = parseBulk(`Name\t${title}\nNoor\t3`, TIERS, DEFAULT);
      expect(r, title).toMatchObject({ name: 'Noor', plusOnes: 2, slots: 3 });
    }
  });

  it('a count of 0, a negative count or a word is an error on that line', () => {
    const rows = parseBulk('Name\tTickets\nNoor\t0\nSem\t-2\nDaan\ttwee\nLotte\t1', TIERS, DEFAULT);
    expect(rows.map((r) => r.countError ?? null)).toEqual(['invalid', 'invalid', 'invalid', null]);
    // Headerless: a 0 in its own column is the same error.
    expect(parseBulk('Noor\t0', TIERS, DEFAULT)[0].countError).toBe('invalid');
  });

  it('+2 keeps meaning plus-ones, a +1 column too', () => {
    expect(parseBulk('Milan Hendriks +2', TIERS, DEFAULT)[0]).toMatchObject({ plusOnes: 2 });
    expect(parseBulk('Name\t+1\nMilan\t2', TIERS, DEFAULT)[0]).toMatchObject({ name: 'Milan', plusOnes: 2 });
  });

  it('a space-only line in a paste: a bare last number is the total too, +2 stays plus-ones (Max 2026-10-10)', () => {
    expect(parseBulk('Henk Jansen 2', TIERS, DEFAULT)[0]).toMatchObject({ name: 'Henk Jansen', plusOnes: 1, slots: 2 });
    expect(parseBulk('Henk Jansen +2', TIERS, DEFAULT)[0]).toMatchObject({ name: 'Henk Jansen', plusOnes: 2, slots: 3 });
    expect(parseBulk('Henk Jansen 1', TIERS, DEFAULT)[0]).toMatchObject({ name: 'Henk Jansen', plusOnes: 0 });
    expect(parseBulk('Henk Jansen 0', TIERS, DEFAULT)[0].countError).toBe('invalid');
    // A phone at the end is never a count; quick add / the door keep `Name 2` = +2.
    expect(parseBulk('Henk 646003664', TIERS, DEFAULT)[0]).toMatchObject({ name: 'Henk', plusOnes: 0, phone: '+31646003664' });
    expect(parse('Henk Jansen 2')).toMatchObject({ name: 'Henk Jansen', plusOnes: 2 });
  });

  it('under a header without a count column, a bare small number in an unnamed column is the total', () => {
    expect(parseBulk('Name\tEmail\nSem\tsem@x.nl\t2', TIERS, DEFAULT)[0]).toMatchObject({ name: 'Sem', plusOnes: 1, email: 'sem@x.nl' });
  });

  it('a header with an unknown extra column is still a header; data never is', () => {
    expect(isHeaderLine('Voornaam\tAchternaam\tBedrijf\tEmail')).toBe(true);
    expect(isHeaderLine('Henk\tAchternaam\t1\tvip')).toBe(false);
    expect(isHeaderLine('Name\tmax@x.nl')).toBe(false);
    expect(parseBulk('Voornaam\tBedrijf\nHenk\tAcme', TIERS, DEFAULT)[0]).toMatchObject({ name: 'Henk' });
  });

  it('repairPastedPhone only rewrites what Excel mangled', () => {
    expect(repairPastedPhone('646003664')).toBe('+31646003664');
    expect(repairPastedPhone('31646003664')).toBe('+31646003664');
    expect(repairPastedPhone('0031646003664')).toBe('+31646003664');
    // Left exactly as typed: contacts match on these digits (phone_norm).
    expect(repairPastedPhone('0646003664')).toBe('0646003664');
    expect(repairPastedPhone('+31646003664')).toBe('+31646003664');
    expect(repairPastedPhone('06 46 00 36 64')).toBe('06 46 00 36 64');
    expect(repairPastedPhone('')).toBeNull();
  });

  it('only a PASTE repairs phones: quick add (and the door) keep the number as typed', () => {
    expect(parse('Jan 31646003600').phone).toBe('31646003600');
    expect(parse('Jan 646003664').phone).toBe('646003664');
  });
});
