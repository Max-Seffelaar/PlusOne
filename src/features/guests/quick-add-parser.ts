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
  return { count: null, consumed };
}

/**
 * Parse one line. `defaultTierId` is the tier used for a bare name (case a) and
 * offered as the "Regular" chip in the ambiguous case (c); the caller picks it
 * (there is no is_default column — typically the tier named "Regular" or the
 * first tier). Returns status 'needs_name' when no name remains.
 */
// E-mail / phone embedded in a line ("Max Jansen max@x.nl 0612345678 +2 vip").
// Pulled out BEFORE +N parsing so a phone's digits are never read as plus-ones,
// and stripped from the name. Permissive on purpose — this is capture, not
// validation (the schema bounds length; #9 keeps the fields optional).
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_RE = /(?:\+|00)?[0-9][0-9\s().-]{7,}[0-9]/;

function extractContact(raw: string): { cleaned: string; email: string | null; phone: string | null } {
  let cleaned = raw;
  const emailMatch = cleaned.match(EMAIL_RE);
  const email = emailMatch ? emailMatch[0] : null;
  if (email) cleaned = cleaned.replace(email, ' ');
  let phone: string | null = null;
  const phoneMatch = cleaned.match(PHONE_RE);
  if (phoneMatch) {
    const digits = phoneMatch[0].replace(/\D/g, '');
    if (digits.length >= 9 && digits.length <= 15) {
      phone = phoneMatch[0].trim();
      cleaned = cleaned.replace(phoneMatch[0], ' ');
    }
  }
  return { cleaned: cleaned.replace(/\s+/g, ' ').trim(), email, phone };
}

export function parseQuickAdd(
  input: string,
  tiers: QuickAddTier[],
  defaultTierId: string
): ParseResult {
  const raw = input.trim();
  // Strip any e-mail/phone first so they don't pollute the name or the +N count.
  const { cleaned, email, phone } = extractContact(raw);
  const defaultTier = tiers.find((t) => t.id === defaultTierId);
  const defaultTierName = defaultTier?.name ?? '';

  // Tokenize the contact-stripped line, keeping original casing for the name and
  // a normalized parallel for matching. Split "+" off neighbouring words so
  // "Jan+2" works.
  const originalTokens = cleaned.replace(/\+/g, ' +').split(/\s+/).filter(Boolean);
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

/** Parse a pasted block (WhatsApp list) into one result per non-empty line. */
export function parseBulk(
  text: string,
  tiers: QuickAddTier[],
  defaultTierId: string
): ParseResult[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => parseQuickAdd(line, tiers, defaultTierId));
}

/** Total quota impact of a set of parsed/resolved lines (1 + plusOnes each). */
export function totalSlots(results: Array<{ slots?: number; plusOnes: number }>): number {
  return results.reduce((sum, r) => sum + (r.slots ?? 1 + r.plusOnes), 0);
}
