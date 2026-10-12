/**
 * Privacy surface copy: the cookie banner on the public pages and the product
 * analytics switch in Profile (PostHog, docs/posthog-implementation-plan.md).
 *
 * Voice: billing/legal/data, so no wink (tone-of-voice.md). Variants and the
 * choice per string are in the PostHog foundation PR body under "Copy choices"
 * (docs/copy-prompt.md). Wired into `t` as `privacy`.
 */
export const privacy = {
  // ── Cookie banner (public pages: /, /login, /e/<slug>) ────────────────────
  bannerTitle: 'Cookies',
  bannerBody:
    'We use the cookies this site needs to work. With your OK we also measure how the site is used, so we can improve it.',
  bannerAcceptAll: 'Accept all',
  bannerNecessaryOnly: 'Only necessary',
  bannerChoose: 'Choose',
  bannerSave: 'Save choices',
  bannerPolicy: 'Cookie policy',
  catNecessaryTitle: 'Necessary',
  catNecessarySub: 'Keeps the site and your login working. Always on.',
  catAnalyticsTitle: 'Analytics',
  catAnalyticsSub: 'Counts visits so we can see what works. No names.',
  catMarketingTitle: 'Marketing',
  catMarketingSub: 'Lets ads measure whether they worked. We use none yet.',

  // ── Profile → product analytics (in-app opt-out, decision 1) ─────────────
  sectionLabel: 'Privacy',
  optOutTitle: 'Product analytics',
  optOutSub: 'Share which features you use, so we can improve PlusOne. Never guest data.',
  saving: 'Saving…',
  saved: 'Saved',
  error: "Couldn't save. Try again.",
};
