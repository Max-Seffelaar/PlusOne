/**
 * Public influencer stats page copy (Requests-epic F2, 86ey6b3fe — S16, the
 * /i/[token] bearer URL). Voice: direct at the influencer, energetic, zero app
 * jargon. Strings are the approved Claude Design copy, verbatim. {placeholders}
 * are filled via fmt().
 */
export const influencerStats = {
  /** Browser-tab title (metadata). */
  pageTitle: 'Your numbers · PlusOne',

  // ── Header ──────────────────────────────────────────────────────────────────
  greeting: 'Hey {name} 👋',
  headerSub: 'Your numbers at {venue}.',

  // ── Totals card ─────────────────────────────────────────────────────────────
  totalViews: 'Views',
  totalRequests: 'Requests',
  totalApproved: 'Approved',
  totalDoor: 'Through the door',
  zeroTitle: 'Share your link',
  zeroBody: 'This fills up tonight. Every tap, request and check-in lands right here.',

  // ── Search + groups ─────────────────────────────────────────────────────────
  searchPlaceholder: 'Search events',
  searchClearAria: 'Clear search',
  noMatch: 'No events match “{q}”.',
  groupUpcoming: 'Upcoming',
  groupPast: 'Past',
  groupYourEvents: 'Your events',
  showMore: 'Show {n} more · {left} left',

  // ── Event card ──────────────────────────────────────────────────────────────
  chipUpcoming: 'Upcoming',
  chipPast: 'Past',
  funnelViews: 'Views',
  funnelRequests: 'Requests',
  funnelApproved: 'Approved',
  funnelIn: 'In',
  notLive: 'Not live yet — share to get this rolling.',
  copyLink: 'Copy link',
  copied: 'Copied',
  qrCode: 'QR code',

  // ── QR modal ────────────────────────────────────────────────────────────────
  qrHint: 'Point a phone camera here to open your link.',
  qrClose: 'Close',
  qrDownload: 'Download',
  qrGenerating: 'Generating…',
  qrUnavailable: 'QR unavailable',
  qrImageAlt: 'QR code for {url}',

  // ── Footer ──────────────────────────────────────────────────────────────────
  footerLive: 'Live numbers. Only you can see this link.',
  footerBrand: 'Guest list, handled by PlusOne',

  // ── Not found (invalid / revoked token) ─────────────────────────────────────
  notFoundTitle: 'Nothing here.',
  notFoundBody: 'This stats link is not active. Ask the venue for a fresh one.',
} as const;
