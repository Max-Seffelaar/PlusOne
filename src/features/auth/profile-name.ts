// The who-did-what labels (spec #62a) and a blank name are not a name a user
// may take. Defence in depth only: the PRIMARY guarantee is structural — every
// surface renders PlusOne's labels as a typed label (kit `ActorName`, see
// src/lib/po/actor-kind.ts), so no name text can pass for one, look-alikes
// included. This file is the app mirror of the DB rule in
// supabase/migrations/20261016140100_actor_names_hardening.sql
// (public.profile_name_key + CHECK user_profiles_full_name_not_reserved).
//
//   * INVISIBLE: every Default_Ignorable_Code_Point plus Cc (controls) and Cf
//     (format) — refused outright in a name, deleted when building the key.
//     The DB needs explicit ranges (no \p{} in Postgres regex), so the list
//     lives here as INVISIBLE_RANGES and the migration carries the identical
//     class; profile-name.cross-check.test.ts proves the migration matches this
//     list and that the list covers everything this runtime's Unicode tables
//     call DI/Cc/Cf (U+0000 aside: Postgres text cannot hold it).
//   * SPACES: every Unicode space separator plus U+2800 (braille blank) count
//     as one ordinary space; the Hangul fillers are default-ignorable, so they
//     vanish — a name of only fillers / blanks is blank.

/** [from, to] code point ranges: Default_Ignorable_Code_Point ∪ Cc ∪ Cf (from U+0001).
 *  KEEP IDENTICAL to the class in 20261016140100_actor_names_hardening.sql. */
export const INVISIBLE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0001, 0x001f], [0x007f, 0x009f], [0x00ad, 0x00ad], [0x034f, 0x034f],
  [0x0600, 0x0605], [0x061c, 0x061c], [0x06dd, 0x06dd], [0x070f, 0x070f],
  [0x0890, 0x0891], [0x08e2, 0x08e2], [0x115f, 0x1160], [0x17b4, 0x17b5],
  [0x180b, 0x180f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f],
  [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xffa0, 0xffa0],
  [0xfff0, 0xfffb], [0x110bd, 0x110bd], [0x110cd, 0x110cd], [0x13430, 0x1343f],
  [0x1bca0, 0x1bca3], [0x1d173, 0x1d17a], [0xe0000, 0xe0fff],
];

/** [from, to] ranges that count as ONE space in the key. KEEP IDENTICAL to the SQL. */
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
const SPACES = new RegExp(`${classOf(SPACE_RANGES)}+`, 'gu');

const RESERVED = new Set(['plusone support', 'system', 'unnamed', 'unknown']);

/** The comparison key: invisible characters removed, Unicode spaces collapsed
 *  to one ASCII space, lower-cased, trimmed. Mirror of public.profile_name_key. */
export function profileNameKey(name: string | null | undefined): string {
  return (name ?? '').replace(INVISIBLE_ALL, '').replace(SPACES, ' ').toLowerCase().trim();
}

export function hasInvisibleChars(name: string): boolean {
  return PROFILE_NAME_INVISIBLE.test(name);
}

/** Is this KEY (already normalised) one of the label words? */
export function isReservedKey(key: string): boolean {
  return RESERVED.has(key);
}

/** Blank (after normalisation) or one of the label words. */
export function isBlankOrReservedName(name: string | null | undefined): boolean {
  const key = profileNameKey(name);
  return key === '' || RESERVED.has(key);
}

/** True when a user may NOT take this as their own name (the DB CHECK refuses
 *  exactly these): invisible characters, blank, or a label word. */
export function isReservedProfileName(name: string): boolean {
  return hasInvisibleChars(name) || isBlankOrReservedName(name);
}
