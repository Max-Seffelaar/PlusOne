/**
 * Review #466 N1: the app mirror of public.profile_name_key and the CHECK
 * user_profiles_full_name_not_reserved (20261016140100) covers the same Unicode
 * cases as the pgTAP probes. Characters are built with fromCharCode so the
 * probes stay visible in this file.
 */
import { describe, it, expect } from 'vitest';
import {
  hasInvisibleChars,
  isBlankOrReservedName,
  isReservedProfileName,
  profileNameKey,
  stripRefusedInvisible,
} from './profile-name';
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

describe('round 4: styled look-alikes, the phrase, and joiners real names use (same cases as pgTAP K1-K9)', () => {
  const cp = String.fromCodePoint;
  /** ASCII letters to a styled alphabet (upper/lower base code points). */
  const styled = (s: string, upper: number, lower: number, space: number): string =>
    [...s]
      .map((ch) => {
        const c = ch.charCodeAt(0);
        if (c >= 65 && c <= 90) return cp(upper + c - 65);
        if (c >= 97 && c <= 122) return cp(lower + c - 97);
        if (ch === ' ') return cp(space);
        return ch;
      })
      .join('');

  it.each([
    ['shield + Math Sans-Serif Italic + U+2800', cp(0x26e8) + styled('PlusOne support', 0x1d608, 0x1d622, 0x2800)],
    ['fullwidth', styled('PlusOne support', 0xff21, 0xff41, 0x3000)],
    ['Mathematical Bold "System"', styled('System', 0x1d400, 0x1d41a, 0x20)],
    ['a name containing the phrase', `${cp(0x26e8)} PlusOne support desk`],
    ['"System" + ZWJ', `System${cp(0x200d)}`],
  ])('refuses %s', (_label, name) => {
    expect(isReservedProfileName(name)).toBe(true);
  });

  it.each([
    ['Systema Smith', 'Systema Smith'],
    ['Zoe + CJK', `Zo${cp(0xeb)} ${cp(0x674e)}`],
    ['accented', `Jos${cp(0xe9)} M${cp(0xfc)}ller`],
    ['emoji ZWJ sequence', `Family ${cp(0x1f468)}${cp(0x200d)}${cp(0x1f469)}`],
    ['emoji + U+FE0F', `Heart ${cp(0x2764)}${cp(0xfe0f)}`],
    ['ZWNJ in a Persian-style name', `Mehr${cp(0x200c)}dad`],
  ])('accepts %s', (_label, name) => {
    expect(isReservedProfileName(name)).toBe(false);
  });

  it('NFKC folds the styled forms into the key', () => {
    expect(profileNameKey(styled('PlusOne support', 0x1d608, 0x1d622, 0x2800))).toBe('plusone support');
    expect(profileNameKey(styled('System', 0x1d400, 0x1d41a, 0x20))).toBe('system');
  });
});

describe('the forms STRIP refused invisible characters, then validate (review #466 r5)', () => {
  const cp = String.fromCodePoint;
  const lrm = cp(0x200e);
  const rlm = cp(0x200f);
  const tag = (s: string): string => [...s].map((ch) => cp(0xe0000 + ch.charCodeAt(0))).join('');
  const englandFlag = `${cp(0x1f3f4)}${tag('gbeng')}${cp(0xe007f)}`;

  it.each([
    ['WhatsApp bidi wrapping', `${lrm}Tom${rlm}`, 'Tom'],
    ['a Khmer ZWSP', `Sok${ZWSP}Dara`, 'SokDara'],
    ['a kanji variation selector', `${cp(0x8fbb)}${cp(0xe0100)}`, cp(0x8fbb)],
    ['U+FE0E text presentation', `Star${cp(0x2b50)}${cp(0xfe0e)}`, `Star${cp(0x2b50)}`],
    ['a soft hyphen', `Jo${cp(0xad)}hann`, 'Johann'],
    ['the England flag tags', `Harry ${englandFlag}`, `Harry ${cp(0x1f3f4)}`],
  ])('accepts a name with %s, stored stripped', (_label, raw, stored) => {
    const res = profileNameSchema.safeParse({ fullName: raw });
    expect(res.success).toBe(true);
    expect(res.data?.fullName).toBe(stored);
    expect(stripRefusedInvisible(raw)).toBe(stored);
  });

  it('turns pasted tab / CR / LF into one space instead of gluing the words (review #466 r6)', () => {
    const tab = cp(9);
    const crlf = `${cp(13)}${cp(10)}`;
    expect(stripRefusedInvisible(`Max${tab}Smith`)).toBe('Max Smith');
    expect(stripRefusedInvisible(`Max ${crlf} Smith`)).toBe('Max Smith');
    const res = profileNameSchema.safeParse({ fullName: `Anna${tab}${tab}de Vries${cp(10)}` });
    expect(res.data?.fullName).toBe('Anna de Vries');
  });

  it('keeps ZWNJ / ZWJ / U+FE0F (allowed in names)', () => {
    const name = `Mehr${cp(0x200c)}dad ${cp(0x2764)}${cp(0xfe0f)}`;
    expect(stripRefusedInvisible(name)).toBe(name);
  });

  it('profileSchema strips first and last name too', () => {
    const res = profileSchema.safeParse({ firstName: `${lrm}Tom`, lastName: `Bakker${ZWSP}`, phone: '' });
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ firstName: 'Tom', lastName: 'Bakker' });
  });

  it('still refuses blank or reserved AFTER stripping', () => {
    expect(profileNameSchema.safeParse({ fullName: `${ZWSP}${lrm}` }).success).toBe(false);
    const res = profileNameSchema.safeParse({ fullName: `${ZWSP}System${lrm}` });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe(t.shared.actor.reservedName);
  });

  it('refuses the chip hint phrase in a name ("plusone label")', () => {
    expect(isReservedProfileName(`Syst${cp(0x0435)}m, PlusOne label`)).toBe(true);
    expect(isReservedProfileName('Max (PlusOne label, not a name)')).toBe(true);
  });
});

describe('Zod refuses them with the catalogue messages', () => {

  it('profileSchema: NBSP-joined label → reservedName message', () => {
    const res = profileSchema.safeParse({ firstName: `PlusOne${NBSP}`, lastName: 'support', phone: '' });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe(t.shared.actor.reservedName);
  });

  it('profileNameSchema: zero-width-prefixed System is refused (as reserved, after stripping)', () => {
    const res = profileNameSchema.safeParse({ fullName: `${ZWSP}System` });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe(t.shared.actor.reservedName);
  });

  it('profileNameSchema: "Anne Marie" with an NBSP is fine', () => {
    expect(profileNameSchema.safeParse({ fullName: `Anne${NBSP}Marie` }).success).toBe(true);
  });
});
