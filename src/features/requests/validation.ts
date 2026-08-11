// Lightweight, UX-only validators for the landing form's inline feedback. The
// authoritative gate is `submitGuestRequestSchema` (schemas.ts) — it imports
// EMAIL_RE from here so the client's inline check and the server's Zod
// validation always agree (86eyd3men): a value that passes here never gets
// silently rejected server-side, and vice versa. Phone uses a separate check
// (libphonenumber via react-phone-number-input, see phone-lazy.tsx).
//
// This is a structural sanity check, not a deliverability check: it catches
// malformed shapes (missing/short TLD, stray dots, bad characters) but cannot
// tell a real domain from a fake-but-well-formed one (e.g. `x@example.zzzzzz`
// is syntactically fine) without a live DNS/MX lookup. The form doesn't do
// that lookup — email is optional (#9) and this is the MVP's no-outbound-mail
// posture (#10) — so an over-eager regex would only cost real guests with an
// uncommon domain, which is worse than occasionally letting a typo through.
const EMAIL_RE =
  /^[A-Za-z0-9_%+-]+(?:\.[A-Za-z0-9_%+-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}$/;

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_RE.test(trimmed);
}

export { EMAIL_RE };
