// Lightweight, UX-only validators for the landing form's inline feedback. The
// authoritative gates live elsewhere: the server's Zod .email() for e-mail, and
// libphonenumber (via react-phone-number-input's isValidPhoneNumber) for phone.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}
