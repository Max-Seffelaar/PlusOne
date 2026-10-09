import type { JSX } from 'react';
import type { Metadata } from 'next';
import { t } from '@/lib/i18n';
import { loadGuestStatus } from '@/features/mail/guest-status-fetch';
import { GuestStatus } from '@/components/po/guest-status';

export const metadata: Metadata = {
  title: t.guestStatus.pageTitle,
  // Bearer status URLs are private; never index them.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

// See src/lib/public-route-viewport.ts — overrides the root layout's locked
// viewport for this public route (WCAG 1.4.4).
export { publicRouteViewport as viewport } from '@/lib/public-route-viewport';

/**
 * Guest status page (/s/[token], guest mail F): the "Check your status" button
 * in every guest mail with a spot. The token is a per-mail bearer token; only
 * its sha256 is looked up (get_guest_status: SECURITY DEFINER, throttled,
 * minimal payload). Invalid, expired, anonymized and throttled tokens all
 * render the identical neutral not-found.
 */
export default async function GuestStatusPage({ params }: { params: Promise<{ token: string }> }): Promise<JSX.Element> {
  const { token } = await params;
  const view = await loadGuestStatus(token);
  return <GuestStatus view={view} icsHref={`/s/${encodeURIComponent(token)}/calendar.ics`} />;
}
