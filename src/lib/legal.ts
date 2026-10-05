// Central source of truth for the legal consent gate (#20/#40): the Terms &
// Privacy links shown at first-login consent AND at venue creation, plus the
// accepted-terms version. Bumping TERMS_VERSION re-prompts every user to accept.
//
// The legal pages live on the marketing site (plus-one.io, repo Plus-One.io),
// not in this app (app.plus-one.io): one `/legal` page whose tab is picked by
// the hash (#terms, #privacy, #dpa, #guest-terms). Override per-environment via
// NEXT_PUBLIC_TERMS_URL / NEXT_PUBLIC_PRIVACY_URL / NEXT_PUBLIC_GUEST_TERMS_URL.
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

/**
 * Guest Terms (decision 11, Legal v0.3): accepted by a guest on the public request
 * page (/e/[slug]) by sending the form (art. 6:234 BW).
 */
export const GUEST_TERMS_URL =
  process.env.NEXT_PUBLIC_GUEST_TERMS_URL ?? 'https://plus-one.io/legal#guest-terms';

/**
 * Guest-facing section of the Privacy Policy (plan §4 anchor). The venue has no
 * privacy URL of its own in the app, so "{venue}'s privacy notice" points here too.
 */
export const GUEST_PRIVACY_URL = `${PRIVACY_URL.split('#')[0]}#guests`;

/**
 * Account deletion request page (Google Play account-deletion policy, 86ey6bfyj).
 * Accounts are invite-only, so there is no self-service delete: the page on the
 * marketing site explains the by-request flow (privacy@plus-one.io). Opened from
 * Profile → Delete account via the kit's `openExternal`.
 */
export const DELETE_ACCOUNT_URL =
  process.env.NEXT_PUBLIC_DELETE_ACCOUNT_URL ?? 'https://www.plus-one.io/delete-account';
