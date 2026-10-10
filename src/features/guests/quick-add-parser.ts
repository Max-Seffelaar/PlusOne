import { normalizeImportPhone } from '@/features/contacts/import/parse';

/**
 * Quick-add parser (decision #33) — pure, deterministic, offline-proof.
 *
 * Turns one line of free text ("Juri Braakman +2 vip fles") into a name, a
 * plus-ones count and a tier resolution, with NO network and NO side effects.
 * It is the single source of truth for both the staff quick-add field and the
 * door app's add-on-the-spot flow (fase 9), so it lives in the feature layer
 * and is unit-tested in isolation.
 *
 * Three cases the UI must distinguish (decision #33):
 *   (a) name only            -> default tier, no question        (status 'ok',   'default')
 *   (b) recognised tier word -> direct match (exact or close)    (status 'ok',   'exact'|'fuzzy')
 *   (c) unrecognised extra   -> inline question with tier chips   (status 'ambiguous')
 * A bare name never silently asks; a tier-like-but-uncertain word never
 * silently falls back to the default — it asks.
 *
 * +N grammar (NL): "+2", "+ 2", "+twee", "plus 2", "plus twee", "p2", and the
 * number words een..tien. A name that merely contains "plus" or a tier word
 * (e.g. surname "Plus", first name "Tien") is left intact — only a real trigger
 * followed by a number is consumed.
 */

export interface QuickAddTier {
  id: string;
  name: string;
  /** Organizer-managed aliases (decision #33). Matched case/diacritic-insensitively. */
  aliases: string[];
}

export type TierMatchKind = 'default' | 'exact' | 'fuzzy';

export interface AmbiguousTier {
  /** The unrecognised words, in their original casing (e.g. "champ"). */
  text: string;
  /** Best-guess tier(s) to offer as chips, closest first. May be empty. */
  suggestions: Array<{ tierId: string; tierName: string }>;
}

export interface ParseResult {
  /** Name with the tier/+N stripped, original casing preserved. */
  name: string;
  plusOnes: number;
  /** Quota impact = 1 + plusOnes (decision #22). */
  slots: number;
  status: 'ok' | 'needs_name' | 'ambiguous';
  /** Present when status is 'ok'. */
  tierId?: string;
  tierName?: string;
  matchedVia?: TierMatchKind;
  /** Present when status is 'ambiguous' (case c). */
  ambiguous?: AmbiguousTier;
  /** The trimmed original line. */
  raw: string;
  /** An e-mail found anywhere in the line, stripped from the name (#9). */
  email?: string | null;
  /** A phone number found anywhere in the line, stripped from the name (#9). */
  phone?: string | null;
  /** Paste only: the line's count column (total people) is not a number ≥ 1. */
  countError?: 'invalid';
}

const NUMBER_WORDS: Record<string, number> = {
  nul: 0,
  een: 1,
  eén: 1,
  één: 1,
  twee: 2,
  drie: 3,
  vier: 4,
  vijf: 5,
  zes: 6,
  zeven: 7,
  acht: 8,
  negen: 9,
  tien: 10,
};

/** Lowercase, strip diacritics, collapse whitespace. */
function normalize(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .toLowerCase()
    .trim();
}

function parseCount(word: string): number | null {
  if (/^\d+$/.test(word)) return parseInt(word, 10);
  const n = NUMBER_WORDS[word];
  return n === undefined ? null : n;
}

/** Levenshtein distance, capped iteration; fine for short tier words. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

type WordConfidence = 'confident' | 'ambiguous' | 'none';

/**
 * Compare one input token to one alias word. Deliberately conservative for
 * short aliases (<= 2 chars never fuzzy-match) so random name fragments don't
 * get pulled into a tier.
 */
function classifyWord(token: string, aliasWord: string): { conf: WordConfidence; dist: number } {
  if (token === aliasWord) return { conf: 'confident', dist: 0 };
  if (aliasWord.length < 3) return { conf: 'none', dist: Infinity };

  const [short, long] = token.length <= aliasWord.length ? [token, aliasWord] : [aliasWord, token];
  // Abbreviation / diminutive: one is a prefix of the other ("fles"->"flesje",
  // "vip"->"vipp", "champ"->"champagne").
  if (short.length >= 3 && long.startsWith(short)) {
    const extra = long.length - short.length;
    if (extra <= 2) return { conf: 'confident', dist: extra };
    if (extra <= 5) return { conf: 'ambiguous', dist: extra };
    return { conf: 'none', dist: Infinity };
  }

  // Single/double typo on a non-trivial word.
  const d = levenshtein(token, aliasWord);
  if (d === 1 && aliasWord.length >= 4) return { conf: 'confident', dist: 1 };
  if (d <= 2 && aliasWord.length >= 4) return { conf: 'ambiguous', dist: d };
  return { conf: 'none', dist: Infinity };
}

interface AliasEntry {
  tierId: string;
  tierName: string;
  words: string[]; // normalized alias words
}

/** Every tier's name + aliases, flattened to normalized word-lists. */
function buildAliasIndex(tiers: QuickAddTier[]): AliasEntry[] {
  const entries: AliasEntry[] = [];
  for (const tier of tiers) {
    const phrases = [tier.name, ...tier.aliases];
    for (const phrase of phrases) {
      const words = normalize(phrase).split(/\s+/).filter(Boolean);
      if (words.length > 0) entries.push({ tierId: tier.id, tierName: tier.name, words });
    }
  }
  return entries;
}

interface RunMatch {
  entry: AliasEntry;
  k: number; // number of trailing tokens consumed
  conf: 'confident' | 'ambiguous';
  dist: number; // total distance (lower = better)
}

/**
 * Best alias match against a trailing run of the normalized tokens.
 * Longest run wins; ties break to confident-over-ambiguous, then lowest dist.
 */
function matchTrailingTier(normTokens: string[], index: AliasEntry[]): RunMatch | null {
  let best: RunMatch | null = null;
  for (const entry of index) {
    const k = entry.words.length;
    if (k === 0 || k > normTokens.length) continue;
    const tail = normTokens.slice(normTokens.length - k);
    let worst: WordConfidence = 'confident';
    let dist = 0;
    let ok = true;
    for (let i = 0; i < k; i++) {
      const c = classifyWord(tail[i], entry.words[i]);
      if (c.conf === 'none') {
        ok = false;
        break;
      }
      if (c.conf === 'ambiguous') worst = 'ambiguous';
      dist += c.dist;
    }
    if (!ok) continue;
    const candidate: RunMatch = { entry, k, conf: worst, dist };
    if (best === null || isBetter(candidate, best)) best = candidate;
  }
  return best;
}

function isBetter(a: RunMatch, b: RunMatch): boolean {
  if (a.k !== b.k) return a.k > b.k; // longest match wins (#33)
  if (a.conf !== b.conf) return a.conf === 'confident';
  return a.dist < b.dist;
}

interface PlusOnes {
  count: number | null;
  consumed: Set<number>;
}

// A bare trailing number above this is never read as a party size (gap-sweep
// #36, 86ey9e8bd) — real +N intent has an explicit trigger ("+25", "plus 25")
// above this range. Below it, "Naam 2" still just works.
const MAX_BARE_TRAILING_PLUS_ONES = 9;

/** Find the first +N expression and the token indices it consumes. */
function findPlusOnes(normTokens: string[]): PlusOnes {
  const consumed = new Set<number>();
  for (let i = 0; i < normTokens.length; i++) {
    const t = normTokens[i];

    // "+2", "+twee"
    let m = t.match(/^\+(.+)$/);
    if (m) {
      const c = parseCount(m[1]);
      if (c !== null) {
        consumed.add(i);
        return { count: c, consumed };
      }
    }
    // "plus2", "plustwee"
    m = t.match(/^plus(.+)$/);
    if (m) {
      const c = parseCount(m[1]);
      if (c !== null) {
        consumed.add(i);
        return { count: c, consumed };
      }
    }
    // "p2"
    m = t.match(/^p(\d+)$/);
    if (m) {
      consumed.add(i);
      return { count: parseInt(m[1], 10), consumed };
    }
    // "+ 2" / "+ twee" / "plus 2" / "plus twee" (trigger + following number)
    if ((t === '+' || t === 'plus') && i + 1 < normTokens.length) {
      const c = parseCount(normTokens[i + 1]);
      if (c !== null) {
        consumed.add(i);
        consumed.add(i + 1);
        return { count: c, consumed };
      }
    }
  }
  // Fallback: a small trailing bare number is the guest count ("Naam 2" → +2).
  // Phones are already stripped (≥8 digits), so a lone trailing integer is a
  // small count, not a phone. Explicit +N above always wins. Capped at
  // MAX_BARE_TRAILING_PLUS_ONES so a numeric surname/stray number ("Adele 25",
  // "Blink 182") isn't misread as a huge party size — that needs an explicit
  // "+N"/"plus N" to be intentional.
  const last = normTokens.length - 1;
  if (last >= 0 && /^\d+$/.test(normTokens[last])) {
    const n = parseInt(normTokens[last], 10);
    if (n <= MAX_BARE_TRAILING_PLUS_ONES) {
      consumed.add(last);
      return { count: n, consumed };
    }
  }
  return { count: null, consumed };
}

/**
 * Parse one line. `defaultTierId` is the tier used for a bare name (case a) and
 * offered as the "Regular" chip in the ambiguous case (c); the caller picks it
 * (there is no is_default column — typically the tier named "Regular" or the
 * first tier). Returns status 'needs_name' when no name remains.
 */
// E-mail / phone in a line are pulled out BEFORE +N/tier parsing, at two levels:
//   • CELL level — a whole CSV column ("Naam, e-mail, 06 12 34 56 78, vip") that
//     is wholly an e-mail or a phone (spaces/dashes allowed inside the cell).
//   • TOKEN level — an inline whitespace token in a delimiter-free line
//     ("Max max@x.nl 0612345678 +2 vip").
// Either way a phone's digits are never read as plus-ones and never land in the
// name. Permissive on purpose: capture, not validation (the schema bounds length;
// #9 keeps the fields optional).
const EMAIL_TOKEN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_TOKEN = /^\+?[\d().-]*\d[\d().-]*$/;
// Whole-cell phone: only phone-ish chars, incl. internal spaces ("06 12 34 56 78").
const CELL_PHONE = /^\+?[\d\s().-]*\d[\d\s().-]*$/;

function digitCount(token: string): number {
  return token.replace(/\D/g, '').length;
}

/** Pull an e-mail / phone column out of the CSV cells (spaced phones allowed). */
function extractContactCells(cells: string[]): {
  kept: string[];
  email: string | null;
  phone: string | null;
} {
  let email: string | null = null;
  let phone: string | null = null;
  const kept: string[] = [];
  for (const c of cells) {
    if (!email && EMAIL_TOKEN.test(c)) {
      email = c;
      continue;
    }
    const digits = digitCount(c);
    if (!phone && CELL_PHONE.test(c) && digits >= 8 && digits <= 15) {
      phone = c.replace(/\s+/g, ''); // store contiguous
      continue;
    }
    kept.push(c);
  }
  return { kept, email, phone };
}

function extractContactTokens(tokens: string[]): {
  kept: string[];
  email: string | null;
  phone: string | null;
} {
  let email: string | null = null;
  let phone: string | null = null;
  const kept: string[] = [];
  for (const t of tokens) {
    if (!email && EMAIL_TOKEN.test(t)) {
      email = t;
      continue;
    }
    if (!phone && PHONE_TOKEN.test(t) && digitCount(t) >= 8 && digitCount(t) <= 15) {
      phone = t;
      continue;
    }
    kept.push(t);
  }
  return { kept, email, phone };
}

export function parseQuickAdd(
  input: string,
  tiers: QuickAddTier[],
  defaultTierId: string
): ParseResult {
  const raw = input.trim();
  const defaultTier = tiers.find((t) => t.id === defaultTierId);
  const defaultTierName = defaultTier?.name ?? '';

  // (1) Split into columns on CSV-style delimiters (comma / semicolon / tab) when
  // present, so a pasted "Naam, e-mail, 06 12 34 56 78, vip" row classifies each
  // column (a spaced phone in its own cell is still captured). A delimiter-free
  // line is a single cell — the #33 whitespace grammar, unchanged.
  const cells = raw.split(/[,;\t]/).map((c) => c.trim()).filter(Boolean);
  const { kept: contentCells, email: cellEmail, phone: cellPhone } = extractContactCells(cells);

  // (2) Pull any INLINE e-mail/phone token out of the remaining columns FIRST, on
  // plain whitespace tokens — before the "+" is split off its neighbours. Doing
  // this after the +-split would tear a plus-addressed email in two ("jan+vip@x.nl"
  // -> "jan" + "+vip@x.nl", the latter still matching EMAIL_TOKEN on its own and
  // swallowing the mailbox tag). A single delimiter-free cell like
  // "Max max@x.nl 0612345678 +2 vip" is still handled; cell matches win.
  const plainTokens = contentCells.join(' ').split(/\s+/).filter(Boolean);
  const { kept: survivorTokens, email: tokEmail, phone: tokPhone } = extractContactTokens(plainTokens);
  const email = cellEmail ?? tokEmail;
  const phone = cellPhone ?? tokPhone;

  // (3) NOW split "+" off its neighbours ("Jan+2" -> "Jan" "+2") on what's left.
  const originalTokens = survivorTokens.join(' ').replace(/\+/g, ' +').split(/\s+/).filter(Boolean);
  const normTokens = originalTokens.map(normalize);

  const base = (over: Partial<ParseResult>): ParseResult => {
    const plusOnes = over.plusOnes ?? 0;
    return { name: '', plusOnes, slots: 1 + plusOnes, status: 'ok', raw, email, phone, ...over };
  };

  if (originalTokens.length === 0) {
    return base({ status: 'needs_name', tierId: defaultTierId, tierName: defaultTierName, matchedVia: 'default' });
  }

  // 1. Pull out the +N expression (if any).
  const plus = findPlusOnes(normTokens);
  const plusOnes = plus.count ?? 0;
  const keptOriginal = originalTokens.filter((_, i) => !plus.consumed.has(i));
  const keptNorm = normTokens.filter((_, i) => !plus.consumed.has(i));

  // 2. Match a trailing tier run on the remaining tokens.
  const index = buildAliasIndex(tiers);
  const match = matchTrailingTier(keptNorm, index);

  const finish = (nameTokens: string[], rest: Partial<ParseResult>): ParseResult => {
    const name = nameTokens.join(' ');
    const status = rest.status ?? (name === '' ? 'needs_name' : 'ok');
    return base({ ...rest, name, plusOnes, status });
  };

  if (!match) {
    // No tier resemblance at all -> everything is the name (case a).
    return finish(keptOriginal, {
      tierId: defaultTierId,
      tierName: defaultTierName,
      matchedVia: 'default',
    });
  }

  const nameTokens = keptOriginal.slice(0, keptOriginal.length - match.k);
  const tierWords = keptOriginal.slice(keptOriginal.length - match.k);

  if (match.conf === 'confident') {
    // Case (b): exact or close tier word.
    return finish(nameTokens, {
      tierId: match.entry.tierId,
      tierName: match.entry.tierName,
      matchedVia: match.dist === 0 ? 'exact' : 'fuzzy',
    });
  }

  // Case (c): tier-like but uncertain — ask, never silently default (#33).
  // The leading tokens are the name so far; the UI resolves the trailing words.
  const suggestions = collectSuggestions(tierWords.map(normalize), index, match.entry.tierId);
  return finish(nameTokens, {
    status: 'ambiguous',
    ambiguous: { text: tierWords.join(' '), suggestions },
  });
}

/** Up to 3 distinct tier suggestions for the ambiguous chips, best first. */
function collectSuggestions(
  tierWords: string[],
  index: AliasEntry[],
  primaryTierId: string
): Array<{ tierId: string; tierName: string }> {
  const scored = new Map<string, { tierName: string; dist: number }>();
  for (const entry of index) {
    if (entry.words.length !== tierWords.length) continue;
    let dist = 0;
    let ok = true;
    for (let i = 0; i < entry.words.length; i++) {
      const c = classifyWord(tierWords[i], entry.words[i]);
      if (c.conf === 'none') {
        ok = false;
        break;
      }
      dist += c.dist;
    }
    if (!ok) continue;
    const prev = scored.get(entry.tierId);
    if (!prev || dist < prev.dist) scored.set(entry.tierId, { tierName: entry.tierName, dist });
  }
  return [...scored.entries()]
    .sort((a, b) => {
      if (a[0] === primaryTierId) return -1;
      if (b[0] === primaryTierId) return 1;
      return a[1].dist - b[1].dist;
    })
    .slice(0, 3)
    .map(([tierId, v]) => ({ tierId, tierName: v.tierName }));
}

/** How the user resolved an ambiguous line via the inline chips (#33). */
export type AmbiguityChoice =
  | { kind: 'tier'; tierId: string }
  | { kind: 'default' }
  | { kind: 'name' };

export interface ResolvedGuest {
  name: string;
  plusOnes: number;
  tierId: string;
}

/**
 * Apply an ambiguity choice to a parsed line, yielding the final guest. For
 * "belongs to the name" the uncertain words are folded back into the name;
 * otherwise they are dropped and the chosen tier is used.
 */
export function resolveAmbiguity(
  result: ParseResult,
  choice: AmbiguityChoice,
  defaultTierId: string
): ResolvedGuest {
  const extra = result.ambiguous?.text ?? '';
  if (choice.kind === 'name') {
    const name = [result.name, extra].filter(Boolean).join(' ');
    return { name, plusOnes: result.plusOnes, tierId: defaultTierId };
  }
  const tierId = choice.kind === 'tier' ? choice.tierId : defaultTierId;
  return { name: result.name, plusOnes: result.plusOnes, tierId };
}

// ── Pasted / shared blocks (share-import S2) ────────────────────────────────
// A list that arrives from Notes or a WhatsApp message is often bulleted or
// numbered ("- Milan +2", "• Fleur", "3. Sem"), and a range copied out of Excel
// or Sheets usually brings its column header ("Name<TAB>Email"). Both are list
// furniture, not guests: strip the marker, skip the header.

// One leading bullet (-, •, *, ·, –, —) or a 1–3 digit "1." / "1)" number, then
// whitespace. A "+2" or a phone ("06 12…") never matches: neither is followed by
// "." / ")" and they carry no bullet glyph.
const LIST_MARKER = /^(?:[-•*·–—]|\d{1,3}[.)])\s+/;

// ── Columns (share-import S2 follow-up, decisions Max 2026-10-10) ─────────────
// A range copied out of Excel or Sheets is tab-separated and usually brings its
// header ("Voornaam<TAB>Achternaam<TAB>Aantal tickets<TAB>Tier<TAB>Email<TAB>
// Telefoonnummer"). With a header the columns are read BY ROLE: first + last
// name together are the name, a count column is the TOTAL number of people
// (tickets: 2 = the guest +1), and a phone column is always a phone. Without a
// header each row keeps the #33 token grammar, plus: a bare small number in its
// own column is the total number of people too.

/** What a header cell names. */
type ColumnRole = 'first' | 'last' | 'name' | 'count' | 'plus' | 'tier' | 'email' | 'phone' | 'note';

// Exact (normalized) header titles. Name roles only ever match exactly, so a
// guest called "Name Hendriks" on the first line is never taken for a header.
const COLUMN_TITLES: Record<string, ColumnRole> = {
  'first name': 'first', firstname: 'first', voornaam: 'first', 'given name': 'first', roepnaam: 'first',
  tussenvoegsel: 'last', 'last name': 'last', lastname: 'last', achternaam: 'last', surname: 'last', 'family name': 'last',
  name: 'name', names: 'name', naam: 'name', namen: 'name', 'full name': 'name', 'volledige naam': 'name',
  guest: 'name', gast: 'name', 'guest name': 'name', gastnaam: 'name',
  '+1': 'plus', '+n': 'plus', 'plus ones': 'plus', 'plus-ones': 'plus', plusones: 'plus', 'plus one': 'plus', extra: 'plus',
  tier: 'tier', ticket: 'tier', 'ticket type': 'tier', type: 'tier', soort: 'tier', categorie: 'tier', category: 'tier', rol: 'tier', role: 'tier',
  notes: 'note', note: 'note', notitie: 'note', opmerking: 'note', opmerkingen: 'note',
};
// Word-level titles for the roles Max named (2026-10-10): any of these words in
// a cell makes it that column ("Aantal tickets", "Telefoonnummer", "E-mailadres").
const COUNT_WORDS = new Set(['tickets', 'aantal', 'personen', 'persons', 'people', 'qty', 'quantity', 'guests', 'gasten', 'pax']);
const PHONE_PREFIX = /^(?:tel|phone|telefoon|mobiel|mobile|gsm)/;

function cellTitle(cell: string): string {
  return normalize(cell).replace(/^[^a-z0-9+]+|[^a-z0-9]+$/g, '');
}

function columnRole(cell: string): ColumnRole | null {
  const title = cellTitle(cell);
  if (title === '') return null;
  const exact = COLUMN_TITLES[title];
  if (exact) return exact;
  const words = title.split(/[\s_-]+/);
  if (/mail/.test(title)) return 'email';
  if (words.some((w) => PHONE_PREFIX.test(w))) return 'phone';
  if (words.some((w) => COUNT_WORDS.has(w))) return 'count';
  return null;
}

/** A recognised header row: the delimiter it uses and each column's role. */
export interface PasteHeader {
  delimiter: '\t' | ';' | ',';
  roles: Array<ColumnRole | null>;
}

function delimiterOf(line: string): PasteHeader['delimiter'] {
  return line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
}

/** The header on the FIRST line, or null. A header names the guest (a name
 *  role), at least half its cells are known column titles, and none of its
 *  cells looks like data (an e-mail, a phone, a number). Unknown extra columns
 *  ("Bedrijf") are allowed and ignored. */
export function readPasteHeader(line: string): PasteHeader | null {
  const delimiter = delimiterOf(line);
  const cells = line.split(delimiter).map((c) => c.trim());
  const filled = cells.filter((c) => c !== '');
  if (filled.length === 0) return null;
  const looksLikeData = (c: string): boolean => EMAIL_TOKEN.test(c) || (c !== '+1' && /^[+\d\s().-]*\d[\d\s().-]*$/.test(c));
  if (filled.some(looksLikeData)) return null;
  const roles = cells.map(columnRole);
  const known = roles.filter((r) => r !== null).length;
  const named = roles.some((r) => r === 'first' || r === 'last' || r === 'name');
  return named && known * 2 >= filled.length ? { delimiter, roles } : null;
}

/** True when a line is a column header ("Name, Email" / "Voornaam<TAB>Telefoon").
 *  Only ever asked of the FIRST line — a guest called "Name" further down stays. */
export function isHeaderLine(line: string): boolean {
  return readPasteHeader(line) !== null;
}

/** Most extra guests one line may bring — the same bound as the guest schemas
 *  (`plusOnes` in ./schemas.ts). A larger count is flagged on its row. */
export const PLUS_ONES_MAX = 50;

/** A count cell: the TOTAL number of people (2 = the guest +1). */
function readTicketCount(raw: string): { plusOnes: number } | { countError: 'invalid' } {
  const v = raw.trim();
  if (!/^-?\d+$/.test(v)) return { countError: 'invalid' };
  const n = parseInt(v, 10);
  return n >= 1 ? { plusOnes: n - 1 } : { countError: 'invalid' };
}

/** A bare number with no header: the total number of people when it is small
 *  (≤ 20), 0 or negative is an error; anything bigger is left alone (a 9-digit
 *  number is a phone, never a count — decision Max 2026-10-10). */
function looseCountCell(cell: string): boolean {
  return /^-?\d{1,3}$/.test(cell.trim()) && parseInt(cell, 10) <= 20;
}

/**
 * Undo what Excel does to a phone number it reads as a number: the leading 0
 * and the `+` are dropped, so NL mobile 06 46003664 arrives as `646003664`
 * (decision Max 2026-10-10). Only these shapes are rewritten — through the one
 * E.164 normaliser (`normalizeImportPhone`) — and every other phone stays as
 * typed: rewriting a plain `0612345678` would change the digits contacts are
 * matched on (`phone_norm`).
 *   9 digits, no leading 0 → +31…   ·   31 + 9 digits → +31…   ·   0031… → +31…
 */
export function repairPastedPhone(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim();
  if (v === '') return null;
  if (v.startsWith('+')) return v;
  const digits = v.replace(/\D/g, '');
  if (!/^[\d\s().-]+$/.test(v)) return v;
  const mangled =
    (digits.length === 9 && !digits.startsWith('0')) ||
    (digits.length === 11 && digits.startsWith('31')) ||
    digits.startsWith('0031');
  return mangled ? normalizeImportPhone(digits) ?? v : v;
}

/** One data row under a header, read column by column. */
function parseColumnRow(raw: string, header: PasteHeader, tiers: QuickAddTier[], defaultTierId: string): ParseResult {
  const cells = raw.split(header.delimiter).map((c) => c.trim());
  const pick = (role: ColumnRole): string[] =>
    header.roles.flatMap((r, i) => (r === role && cells[i] ? [cells[i]] : []));
  const name = [...pick('first'), ...pick('name'), ...pick('last')]
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Name + tier through the #33 grammar: tier words and aliases resolve the same
  // way as everywhere else (an unknown tier word asks, never defaults silently).
  const base = parseQuickAdd([name, ...pick('tier')].join(' '), tiers, defaultTierId);
  const out: ParseResult = { ...base, raw: raw.trim() };
  const email = pick('email')[0];
  if (email) out.email = email;
  const phone = pick('phone')[0];
  if (phone) out.phone = repairPastedPhone(phone);
  else if (out.phone) out.phone = repairPastedPhone(out.phone);
  const count = pick('count')[0];
  const plus = pick('plus')[0];
  // No count column named: a bare small number in a column the header doesn't
  // name is the total number of people, as on a row without a header.
  const loose = header.roles.some((r) => r === 'count' || r === 'plus')
    ? undefined
    : cells.find((c, i) => (header.roles[i] ?? null) === null && c !== '' && looseCountCell(c));
  if (count) applyCount(out, readTicketCount(count));
  else if (plus) applyCount(out, /^\d+$/.test(plus) ? { plusOnes: parseInt(plus, 10) } : { countError: 'invalid' });
  else if (loose) applyCount(out, readTicketCount(loose));
  return out;
}

/** One row without a header: the #33 grammar, plus a bare small number in its
 *  own column or as the last word as the TOTAL number of people (`Henk Jansen 2`
 *  = Henk +1, decision Max 2026-10-10), and the Excel phone repair. `+2` keeps
 *  meaning plus-ones. Quick add and the door are deliberately different: there a
 *  bare trailing number stays +N (`parseQuickAdd`, untouched). */
function parseLooseRow(line: string, tiers: QuickAddTier[], defaultTierId: string): ParseResult {
  if (!/[,;\t]/.test(line)) {
    const words = line.split(/\s+/);
    const last = words[words.length - 1];
    if (words.length > 1 && looseCountCell(last)) {
      const rest = parseQuickAdd(words.slice(0, -1).join(' '), tiers, defaultTierId);
      // An explicit +N elsewhere on the line wins; the number then stays as the
      // #33 grammar reads it.
      if (rest.plusOnes === 0) {
        const out: ParseResult = { ...rest, raw: line, phone: rest.phone ? repairPastedPhone(rest.phone) : rest.phone };
        applyCount(out, readTicketCount(last));
        return out;
      }
    }
    const r = parseQuickAdd(line, tiers, defaultTierId);
    return r.phone ? { ...r, phone: repairPastedPhone(r.phone) } : r;
  }
  const delimiter = delimiterOf(line);
  const cells = line.split(delimiter);
  // Never the first column: that is the name ("3 Doors Down" stays a name).
  const countAt = cells.findIndex((c, i) => i > 0 && looseCountCell(c));
  const rest = countAt < 0 ? cells : cells.filter((_, i) => i !== countAt);
  const r = parseQuickAdd(rest.join(delimiter), tiers, defaultTierId);
  const out: ParseResult = { ...r, raw: line, phone: r.phone ? repairPastedPhone(r.phone) : r.phone };
  if (countAt >= 0) applyCount(out, readTicketCount(cells[countAt]));
  return out;
}

function applyCount(out: ParseResult, count: { plusOnes: number } | { countError: 'invalid' }): void {
  if ('countError' in count) {
    out.countError = count.countError;
    return;
  }
  out.plusOnes = count.plusOnes;
  out.slots = 1 + count.plusOnes;
}

interface PasteLine {
  /** The line as pasted (only a trailing CR dropped): columns keep their places. */
  raw: string;
  /** Trimmed, list marker stripped — what the token grammar reads. */
  clean: string;
}

function pasteLines(text: string): PasteLine[] {
  return text
    .split(/\r?\n/)
    .map((raw) => ({ raw, clean: raw.trim().replace(LIST_MARKER, '').trim() }))
    .filter((l) => l.clean.length > 0);
}

/** Split a pasted block into its guest lines: trimmed, list markers stripped,
 *  blanks dropped, a leading column header skipped. */
export function bulkLines(text: string): string[] {
  const lines = pasteLines(text);
  const header = lines.length > 0 ? readPasteHeader(lines[0].clean) : null;
  return (header ? lines.slice(1) : lines).map((l) => l.clean);
}

/** Parse a pasted block (WhatsApp list, Notes, an Excel range) into one result
 *  per guest line. With a header row the columns are read by role; without
 *  one, each line by the #33 grammar (see `parseLooseRow`). */
export function parseBulk(
  text: string,
  tiers: QuickAddTier[],
  defaultTierId: string
): ParseResult[] {
  const lines = pasteLines(text);
  const header = lines.length > 0 ? readPasteHeader(lines[0].clean) : null;
  if (!header) return lines.map((l) => parseLooseRow(l.clean, tiers, defaultTierId));
  return lines.slice(1).map((l) =>
    l.raw.includes(header.delimiter)
      ? parseColumnRow(l.raw, header, tiers, defaultTierId)
      : parseLooseRow(l.clean, tiers, defaultTierId),
  );
}

/** Total quota impact of a set of parsed/resolved lines (1 + plusOnes each). */
export function totalSlots(results: Array<{ slots?: number; plusOnes: number }>): number {
  return results.reduce((sum, r) => sum + (r.slots ?? 1 + r.plusOnes), 0);
}

/** The preview's count line (share-import S2): "6 entries = 9 total guests
 *  (2 with email)". `guests` is the head count, 1 + plusOnes per entry — the
 *  same number the quota math uses (decision #22). */
export function pasteSummary(rows: Array<{ plusOnes: number; email?: string | null }>): {
  entries: number;
  guests: number;
  withEmail: number;
} {
  return {
    entries: rows.length,
    guests: totalSlots(rows),
    withEmail: rows.filter((r) => !!r.email && r.email.trim() !== '').length,
  };
}
