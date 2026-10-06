// Central source of truth for the legal consent gate (#20/#40): the Terms &
// Privacy links shown at first-login consent AND at venue creation, plus the
// accepted-terms version. Bumping TERMS_VERSION re-prompts every user to accept.
//
// The legal pages live on the marketing site (plus-one.io, repo Plus-One.io),
// not in this app (app.plus-one.io): one `/legal` page whose tab is picked by
// the hash (#terms, #privacy, #dpa, #subprocessors, #guest-terms, #guests).
// Override per-environment via NEXT_PUBLIC_TERMS_URL / NEXT_PUBLIC_PRIVACY_URL /
// NEXT_PUBLIC_GUEST_TERMS_URL.
//
// Legal v0.3 wave D (z8uq9m2hm7, 86ey1vbrj): the site publishes the lawyer-approved
// texts as Version 1.0 (2026-10-06), generated from docs/legal/ (Plus-One.io
// scripts/gen-legal.mjs). A wording change there means a new TERMS_VERSION here.

/** Version of the legal docs a user/venue consents to. Bump on a material change. */
export const TERMS_VERSION = '2026-10-06';

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
 * Privacy notice linked from the request page ("{venue}'s privacy notice", "How your
 * details are used"). The venue has no privacy URL of its own in the app, so this is
 * the guest section (§4) of the PlusOne Privacy Policy: the site's `#guests` anchor
 * selects the Privacy tab and scrolls to it.
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
