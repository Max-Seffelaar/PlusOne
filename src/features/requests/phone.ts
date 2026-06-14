// Phone + e-mail helpers for the landing form. Phone numbers MUST be stored
// with a country code (E.164, e.g. +31612345678) or they are useless for the
// venue — so the form pairs a dial-code selector with a national number and we
// normalise here. Shared by the client (inline errors) and the unit tests.

export interface DialCode {
  /** E.164 country calling code, e.g. "+31". */
  code: string;
  /** What the <option> shows, e.g. "🇳🇱 NL +31". */
  label: string;
  /** ISO country, used for country-specific validation (currently only NL). */
  iso: string;
}

// Curated for a Dutch venue audience (NL default) + the common EU/relevant
// codes. Extendable; an unlisted country is a rare case for these guest lists.
export const DIAL_CODES: DialCode[] = [
  { code: '+31', iso: 'NL', label: '🇳🇱 NL +31' },
  { code: '+32', iso: 'BE', label: '🇧🇪 BE +32' },
  { code: '+49', iso: 'DE', label: '🇩🇪 DE +49' },
  { code: '+44', iso: 'GB', label: '🇬🇧 UK +44' },
  { code: '+33', iso: 'FR', label: '🇫🇷 FR +33' },
  { code: '+34', iso: 'ES', label: '🇪🇸 ES +34' },
  { code: '+39', iso: 'IT', label: '🇮🇹 IT +39' },
  { code: '+351', iso: 'PT', label: '🇵🇹 PT +351' },
  { code: '+48', iso: 'PL', label: '🇵🇱 PL +48' },
  { code: '+43', iso: 'AT', label: '🇦🇹 AT +43' },
  { code: '+41', iso: 'CH', label: '🇨🇭 CH +41' },
  { code: '+46', iso: 'SE', label: '🇸🇪 SE +46' },
  { code: '+45', iso: 'DK', label: '🇩🇰 DK +45' },
  { code: '+353', iso: 'IE', label: '🇮🇪 IE +353' },
  { code: '+90', iso: 'TR', label: '🇹🇷 TR +90' },
  { code: '+212', iso: 'MA', label: '🇲🇦 MA +212' },
  { code: '+597', iso: 'SR', label: '🇸🇷 SR +597' },
  { code: '+1', iso: 'US', label: '🇺🇸 US/CA +1' },
];

export const DEFAULT_DIAL_CODE = '+31';

export type PhoneResult =
  | { ok: true; empty: true } // nothing entered (phone is optional)
  | { ok: true; empty: false; e164: string }
  | { ok: false; reason: string };

/**
 * Combine a dial code + a national number into E.164. Strips spaces, dashes and
 * a single national trunk "0" ("06 12 34 56 78" → "+31612345678"). NL gets a
 * strict 9-digit check (so a too-short "06" number is caught); other countries
 * get a loose 6–14 digit length check.
 */
export function toE164(dialCode: string, national: string): PhoneResult {
  const raw = (national ?? '').trim();
  if (raw === '') return { ok: true, empty: true };

  // Only digits matter; drop separators and a leading trunk zero.
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');

  if (digits === '') return { ok: false, reason: 'Vul een geldig telefoonnummer in.' };

  const dial = DIAL_CODES.find((d) => d.code === dialCode);
  if (dial?.iso === 'NL') {
    // NL national numbers are 9 digits after the trunk 0 (06xxxxxxxx mobile,
    // 0xxxxxxxx landline).
    if (digits.length !== 9) {
      return { ok: false, reason: 'Controleer je telefoonnummer (bijv. 06 12 34 56 78).' };
    }
  } else if (digits.length < 6 || digits.length > 14) {
    return { ok: false, reason: 'Controleer je telefoonnummer (inclusief netnummer).' };
  }

  return { ok: true, empty: false, e164: `${dialCode}${digits}` };
}

// Loose, UX-only e-mail check for inline feedback. The server's Zod .email() is
// the authoritative gate; this just catches the obvious typo before submit.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}
