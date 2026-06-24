// Central source of truth for the legal consent gate (#20/#40): the Terms &
// Privacy links shown at first-login consent AND at venue creation, plus the
// accepted-terms version. Bumping TERMS_VERSION re-prompts every user to accept.
//
// TODO(go-live — ClickUp 86ey1vbrj): the URLs below are PLACEHOLDERS. The real
// legal pages don't exist yet (domain not chosen, still testing). Set the real
// URLs here, or override per-environment via NEXT_PUBLIC_TERMS_URL /
// NEXT_PUBLIC_PRIVACY_URL, BEFORE production launch.

/** Version of the legal docs a user/venue consents to. Bump on a material change. */
export const TERMS_VERSION = '2026-06-24';

/** Terms of Service. */
export const TERMS_URL = process.env.NEXT_PUBLIC_TERMS_URL ?? 'https://plusone.app/terms';

/** Privacy Policy. */
export const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL ?? 'https://plusone.app/privacy';
