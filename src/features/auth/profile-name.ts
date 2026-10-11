// The who-did-what labels (spec #62a: "PlusOne support", "System", "Unnamed")
// and a blank name are not a name a user may take. This is the app mirror of
// the DB rule in 20261016140100_actor_names_hardening.sql — keep the character
// classes IDENTICAL to `public.profile_name_key` and the CHECK
// user_profiles_full_name_not_reserved:
//
//   * control + format characters (C0/C1 controls, soft hyphen, zero-width
//     space/joiners, LRM/RLM, bidi embeddings/overrides, word joiner and the
//     invisible operators, BOM) are refused outright — no real name has them,
//     and they let "PlusOne support" hide behind an invisible prefix/suffix;
//   * every Unicode space (NBSP, ideographic space, en/em spaces, …) counts as
//     one ordinary space when deciding blank / reserved, so " PlusOne support"
//     with a no-break space is still the label.
//
// Residual, accepted: look-alike letters ("PIusOne", Cyrillic) pass.

/** Control + format characters: never part of a real name. */
export const PROFILE_NAME_INVISIBLE =
  /[\u0001-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/;
const INVISIBLE_ALL = new RegExp(PROFILE_NAME_INVISIBLE.source, 'g');
/** Any run of Unicode whitespace (JS \s already covers NBSP, U+1680, U+2000–200A,
 *  U+2028/2029, U+202F, U+205F, U+3000; listed explicitly to mirror the SQL). */
const SPACES = /[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

const RESERVED = new Set(['plusone support', 'system', 'unnamed']);

/** The comparison key: invisible characters removed, Unicode spaces collapsed
 *  to one ASCII space, lower-cased, trimmed. Mirror of public.profile_name_key. */
export function profileNameKey(name: string | null | undefined): string {
  return (name ?? '').replace(INVISIBLE_ALL, '').replace(SPACES, ' ').toLowerCase().trim();
}

export function hasInvisibleChars(name: string): boolean {
  return PROFILE_NAME_INVISIBLE.test(name);
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
