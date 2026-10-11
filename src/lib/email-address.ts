// One syntax for every address that ends up in a mail header (guest mail F):
// the company and event contact addresses (Reply-To, footer) and a guest's own
// address (To). Shared by the Zod schemas (browser + server) and the mail job;
// the DB checks venues_contact_email_check / venues_contact_email_ascii_check /
// events_contact_email_check (20261013180100, 20261013180500) hold the same
// rule.
//
//   - printable ASCII only (0x21-0x7e): no control, zero-width, bidi or other
//     invisible characters, which `\s` does not cover and a paste from a PDF
//     or website can carry (review #456 S1);
//   - no header syntax: no whitespace, <>, quotes, commas, semicolons, colons;
//   - one @, a dot in the domain.
//
// An internationalised domain (café.nl) is stored as punycode
// (xn--caf-dma.nl), so it passes the ASCII rule and the DNS check sees the
// name the resolver knows. A non-ASCII local part is refused.

export const EMAIL_ADDRESS_RE = /^(?=[\x21-\x7e]+$)[^@\s<>",;:]+@[^@\s<>",;:]+\.[^@\s<>",;:]+$/;

/** Characters that would make URL parsing reinterpret the domain. */
const NOT_A_HOSTNAME = /[\s/?#\\@:[\]%]/;

/**
 * Lower-case and trim; a non-ASCII domain becomes punycode. Anything that
 * can't be converted is returned as is, and EMAIL_ADDRESS_RE then refuses it.
 */
export function normalizeEmailAddress(raw: string): string {
  const value = raw.trim().toLowerCase();
  const at = value.lastIndexOf('@');
  if (at < 1) return value;
  const domain = value.slice(at + 1);
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(domain) || NOT_A_HOSTNAME.test(domain)) return value;
  try {
    const ascii = new URL(`http://${domain}`).hostname;
    return ascii ? `${value.slice(0, at)}@${ascii}` : value;
  } catch {
    return value;
  }
}
