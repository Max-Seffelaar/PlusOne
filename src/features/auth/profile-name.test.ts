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
