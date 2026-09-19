// Central source of truth for the legal consent gate (#20/#40): the Terms &
// Privacy links shown at first-login consent AND at venue creation, plus the
// accepted-terms version. Bumping TERMS_VERSION re-prompts every user to accept.
//
// The legal pages live on the marketing site (plus-one.io, repo Plus-One.io),
// not in this app (app.plus-one.io): one `/legal` page whose tab is picked by
// the hash (#terms, #privacy, #dpa). Override per-environment via
// NEXT_PUBLIC_TERMS_URL / NEXT_PUBLIC_PRIVACY_URL.
//
// TODO(go-live — ClickUp 86ey1vbrj): the URLs are final, the text behind them is
// not. The site's /legal page must carry the final Terms and Privacy Policy
// (drafts in docs/legal/) BEFORE production launch.

/** Version of the legal docs a user/venue consents to. Bump on a material change. */
export const TERMS_VERSION = '2026-06-24';

/** Terms of Service. */
export const TERMS_URL = process.env.NEXT_PUBLIC_TERMS_URL ?? 'https://plus-one.io/legal#terms';

/** Privacy Policy. */
export const PRIVACY_URL = process.env.NEXT_PUBLIC_PRIVACY_URL ?? 'https://plus-one.io/legal#privacy';
