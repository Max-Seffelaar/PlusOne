/**
 * Review #466 N1: the app mirror of public.profile_name_key and the CHECK
 * user_profiles_full_name_not_reserved (20261016140100) covers the same Unicode
 * cases as the pgTAP probes. Characters are built with fromCharCode so the
 * probes stay visible in this file.
 */
import { describe, it, expect } from 'vitest';
import { hasInvisibleChars, isBlankOrReservedName, isReservedProfileName, profileNameKey } from './profile-name';
import { profileNameSchema, profileSchema } from './schemas';
import { t } from '@/lib/i18n';

const c = String.fromCharCode;
const TAB = c(9);
const LF = c(10);
const CR = c(13);
const NBSP = c(160);
const ZWSP = c(8203);
const IDEO = c(12288);
const BOM = c(0xfeff);
const RLO = c(0x202e);

describe('profileNameKey', () => {
  it('drops invisible characters, collapses Unicode spaces, lower-cases, trims', () => {
    expect(profileNameKey(`${NBSP}PlusOne${IDEO}${TAB}Support${LF}`)).toBe('plusone support');
    expect(profileNameKey(`${ZWSP}System${BOM}`)).toBe('system');
    expect(profileNameKey(`${IDEO}${ZWSP}${TAB}`)).toBe('');
    expect(profileNameKey(null)).toBe('');
  });
});

describe('isReservedProfileName (same cases as pgTAP I1–I11)', () => {
  it.each([
    ['NBSP-prefixed', `${NBSP}PlusOne support`],
    ['newline-suffixed', `PlusOne support${LF}`],
    ['CR-suffixed System', `System${CR}`],
    ['tab-prefixed System', `${TAB}System`],
    ['zero-width inside', `PlusOne${ZWSP} support`],
    ['zero-width-prefixed System', `${ZWSP}System`],
    ['inner NBSP', `PlusOne${NBSP}support`],
    ['ideographic-space blank', `${IDEO}${IDEO}`],
    ['tab blank', TAB],
    ['zero-width blank', ZWSP],
    ['bidi override around a normal name', `${RLO}Tom`],
  ])('refuses %s', (_label, name) => {
    expect(isReservedProfileName(name)).toBe(true);
  });

  it('accepts a normal name with an inner NBSP ("Anne Marie")', () => {
    expect(isReservedProfileName(`Anne${NBSP}Marie`)).toBe(false);
    expect(hasInvisibleChars(`Anne${NBSP}Marie`)).toBe(false);
  });

  it('separates "invisible character" from "blank or reserved"', () => {
    expect(hasInvisibleChars(`Tom${ZWSP}`)).toBe(true);
    expect(isBlankOrReservedName(`Tom${ZWSP}`)).toBe(false);
    expect(isBlankOrReservedName(`${NBSP}system`)).toBe(true);
  });
});

describe('round 3: every default-ignorable / control / format code point (same cases as pgTAP J1-J13)', () => {
  const cp = String.fromCodePoint;
  it.each([
    ['System + U+2066', `System${cp(0x2066)}`],
    ['PlusOne support + U+034F', `PlusOne support${cp(0x034f)}`],
    ['Unnamed + U+FE0F', `Unnamed${cp(0xfe0f)}`],
    ['U+3164 only', cp(0x3164)],
    ['U+2800 only', `${cp(0x2800)}${cp(0x2800)}`],
    ['Tom + U+E0001', `Tom${cp(0xe0001)}`],
    ['Unknown', ' Unknown '],
    ['Tom + U+180E', `Tom${cp(0x180e)}`],
    ['U+061C + System', `${cp(0x061c)}System`],
    ['U+115F only', cp(0x115f)],
    ['U+FFA0 only', cp(0xffa0)],
  ])('refuses %s', (_label, name) => {
    expect(isReservedProfileName(name)).toBe(true);
  });

  it('accepts an ordinary accented name ("José Müller")', () => {
    expect(isReservedProfileName(`Jos${cp(0xe9)} M${cp(0xfc)}ller`)).toBe(false);
  });

  it('the Hangul fillers and the braille blank make a name blank', () => {
    expect(profileNameKey(`${cp(0x3164)}${cp(0x2800)}${cp(0x115f)}`)).toBe('');
  });
});

describe('Zod refuses them with the catalogue messages', () => {
  it('profileSchema: invisible character → invisibleChars message', () => {
    const res = profileSchema.safeParse({ firstName: 'Tom', lastName: `Bakker${ZWSP}`, phone: '' });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe(t.shared.actor.invisibleChars);
  });

  it('profileSchema: NBSP-joined label → reservedName message', () => {
    const res = profileSchema.safeParse({ firstName: `PlusOne${NBSP}`, lastName: 'support', phone: '' });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe(t.shared.actor.reservedName);
  });

  it('profileNameSchema: zero-width-prefixed System is refused', () => {
    const res = profileNameSchema.safeParse({ fullName: `${ZWSP}System` });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe(t.shared.actor.invisibleChars);
  });

  it('profileNameSchema: "Anne Marie" with an NBSP is fine', () => {
    expect(profileNameSchema.safeParse({ fullName: `Anne${NBSP}Marie` }).success).toBe(true);
  });
});
