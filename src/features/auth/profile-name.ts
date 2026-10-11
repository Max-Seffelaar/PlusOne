// The who-did-what labels (spec #62a) and a blank name are not a name a user
// may take. This is the SECOND layer. The first is structural: every surface
// renders PlusOne's own labels as a typed chip (kit `ActorName`, see
// src/lib/po/actor-kind.ts), which no name text can produce; a member's name is
// always plain text. This file is the app mirror of the DB rule in
// supabase/migrations/20261016140100_actor_names_hardening.sql
// (public.profile_name_key + CHECK user_profiles_full_name_not_reserved).
//
//   * KEY: NFKC compatibility folding first (fullwidth and Mathematical
//     alphanumerics become plain letters), then every Default_Ignorable_Code_Point
//     / Cc / Cf character is deleted, every Unicode space (plus U+2800, the
//     braille blank) becomes one ASCII space, lower-cased, trimmed.
//   * REFUSED in a name: the same invisible set, EXCEPT ZWNJ / ZWJ (U+200C/D:
//     Persian and Indic names, emoji sequences) and U+FE0F (emoji
//     presentation). Those are allowed in the stored name but still stripped
//     in the key, so "System" + ZWJ still keys to "system" and is refused.
//   * RESERVED: a key that IS "system" / "unnamed" / "unknown" / "plusone
//     support", or that CONTAINS "plusone support". "Systema Smith" is fine.
//
// The DB needs explicit ranges (no \p{} in Postgres regex), so the list lives
// here as INVISIBLE_RANGES and the migration carries the identical classes;
// profile-name.cross-check.test.ts proves they match.

/** [from, to] code point ranges: Default_Ignorable_Code_Point + Cc + Cf (from U+0001).
 *  KEY class — KEEP IDENTICAL to the class in profile_name_key (20261016140100). */
export const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0001, 0x001f], [0x007f, 0x009f], [0x00ad, 0x00ad], [0x034f, 0x034f],
  [0x0600, 0x0605], [0x061c, 0x061c], [0x06dd, 0x06dd], [0x070f, 0x070f],
  [0x0890, 0x0891], [0x08e2, 0x08e2], [0x115f, 0x1160], [0x17b4, 0x17b5],
  [0x180b, 0x180f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f],
  [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xffa0, 0xffa0],
  [0xfff0, 0xfffb], [0x110bd, 0x110bd], [0x110cd, 0x110cd], [0x13430, 0x1343f],
  [0x1bca0, 0x1bca3], [0x1d173, 0x1d17a], [0xe0000, 0xe0fff],
];

/** The Unicode version INVISIBLE_RANGES was generated from (Node 24). The
 *  cross-check only demands "runtime DI/Cc/Cf is in the list" on runtimes at
 *  or below this version; a newer runtime may know code points we don't yet. */
export const INVISIBLE_RANGES_UNICODE_VERSION = '17.0';

/** Invisible characters a NAME may still contain (allowed in the stored name,
 *  stripped from the key): ZWNJ, ZWJ, emoji presentation selector. */
export const ALLOWED_IN_NAME: ReadonlySet<number> = new Set([0x200c, 0x200d, 0xfe0f]);

/** [from, to] ranges that count as ONE space in the key and between words.
 *  KEEP IDENTICAL to the SQL. */
export const SPACE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0020, 0x0020], [0x00a0, 0x00a0], [0x1680, 0x1680], [0x2000, 0x200a],
  [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x2800, 0x2800],
  [0x3000, 0x3000],
];

/** Build a character class from ranges using the literal characters (none of
 *  them is a class metacharacter), so this file stays plain ASCII. */
function classOf(ranges: ReadonlyArray<readonly [number, number]>): string {
  const ch = (cp: number) => String.fromCodePoint(cp);
  return '[' + ranges.map(([a, b]) => (a === b ? ch(a) : `${ch(a)}-${ch(b)}`)).join('') + ']';
}

/** One invisible character: the runtime's own Unicode tables OR the explicit
 *  list (the list may be newer than an old runtime; never narrower — tested). */
export const PROFILE_NAME_INVISIBLE = new RegExp(
  `[\\p{Default_Ignorable_Code_Point}\\p{Cc}\\p{Cf}]|${classOf(INVISIBLE_RANGES)}`,
  'u',
);
const INVISIBLE_ALL = new RegExp(PROFILE_NAME_INVISIBLE.source, 'gu');
// Whitespace for splitting words: JS \s plus everything in SPACE_RANGES (U+2800).
const SPACES = new RegExp(`(?:\\s|${classOf(SPACE_RANGES)})+`, 'gu');

const RESERVED = new Set(['plusone support', 'system', 'unnamed', 'unknown']);
const RESERVED_PHRASE = 'plusone support';

/** The comparison key: NFKC, invisible characters removed, Unicode spaces
 *  collapsed to one ASCII space, lower-cased, trimmed. Mirror of
 *  public.profile_name_key. */
export function profileNameKey(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE_ALL, '')
    .replace(SPACES, ' ')
    .toLowerCase()
    .trim();
}

/** Words of a display name, split on every Unicode space incl. U+2800. */
export function nameWords(name: string): string[] {
  return name.split(SPACES).filter((w) => w !== '');
}

/** An invisible character a name may NOT contain (ZWNJ / ZWJ / U+FE0F allowed). */
export function hasInvisibleChars(name: string): boolean {
  for (const m of name.matchAll(INVISIBLE_ALL)) {
    if (!ALLOWED_IN_NAME.has(m[0].codePointAt(0)!)) return true;
  }
  return false;
}

/** Is this KEY (already normalised) reserved? Equal to a label word, or
 *  containing the "plusone support" phrase. */
export function isReservedKey(key: string): boolean {
  return RESERVED.has(key) || key.includes(RESERVED_PHRASE);
}

/** Blank (after normalisation) or reserved. */
export function isBlankOrReservedName(name: string | null | undefined): boolean {
  const key = profileNameKey(name);
  return key === '' || isReservedKey(key);
}

/** True when a user may NOT take this as their own name (the DB CHECK refuses
 *  exactly these): a refused invisible character, blank, or reserved. */
export function isReservedProfileName(name: string): boolean {
  return hasInvisibleChars(name) || isBlankOrReservedName(name);
}
