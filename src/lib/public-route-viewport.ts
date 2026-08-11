import type { Viewport } from 'next';

/**
 * Shared viewport for the public guest-facing routes (/e, /r, /i): pinch-zoom
 * enabled (WCAG 1.4.4) even though the root layout locks it app-wide. Next
 * merges `viewport` per-key across the segment tree rather than replacing
 * wholesale (verified against the running dev server: omitting
 * maximumScale/userScalable in a page override left the root's
 * `maximum-scale=1, user-scalable=no` in the rendered meta tag) — so every
 * field has to be restated here, not just the two being unlocked.
 *
 * The root lock stays app-wide rather than being lifted globally: an audit
 * (86ey9ea09 code-review, finding 10) found ~10 genuine sub-16px form inputs
 * scattered across authenticated screens (approvals, guest detail, crew,
 * the cockpit refuse modal, the event picker, country/influencer inputs…) —
 * more than "a handful". Unlocking the root would re-enable iOS Safari's
 * auto-zoom-on-focus on every one of them. A ClickUp follow-up tracks the
 * root unlock + input-size migration + retiring this file once the root
 * itself is zoomable everywhere (ClickUp MCP was rate-limited while writing
 * this PR — filed separately once it clears).
 */
export const publicRouteViewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  colorScheme: 'dark',
  themeColor: '#0B0B0D',
};
