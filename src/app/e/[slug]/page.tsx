import type { Metadata, Viewport } from 'next';
import { createClient } from '@/lib/supabase/server';
import { submitGuestRequest } from '@/features/requests/actions';
import { landingClientIpHash } from '@/features/requests/ip-hash';
import { LandingForm, LandingClosed, type LandingEvent } from '@/components/po/landing';

export const metadata: Metadata = {
  title: 'Get on the list · PlusOne',
  // Per-event request links are private; never index them.
  robots: { index: false, follow: false },
};

// Overrides the root layout's locked viewport for this public route — a guest
// filling in the form must be able to pinch-zoom (WCAG 1.4.4). Next merges
// viewport per-key across the segment tree rather than replacing wholesale
// (verified against the running dev server: omitting maximumScale/userScalable
// here left the root's `maximum-scale=1, user-scalable=no` in the rendered
// meta tag) — so they must be explicitly overridden, not just left out.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  colorScheme: 'dark',
  themeColor: '#0B0B0D',
};

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Amsterdam',
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Amsterdam',
});

/**
 * Public request page (#12/#28). One slug namespace: the slug resolves against
 * request_links (an event's legacy landing_slug lives on as its default link),
 * via the anon-safe get_landing_event RPC — unknown, paused, expired,
 * deactivated and cancelled are indistinguishable, so the closed page leaks
 * nothing. The render also counts the visit (funnel step 1): server-side,
 * cookie-less, rate-limited in the RPC.
 */
export default async function LandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<JSX.Element> {
  const { slug } = await params;
  const supabase = await createClient();

  // One salted IP hash feeds both the landing resolve (C4: now throttled — a
  // slug oracle otherwise) and the pageview counter.
  const ipHash = await landingClientIpHash();
  const [{ data: rows }] = await Promise.all([
    supabase.rpc('get_landing_event', { p_slug: slug, p_ip_hash: ipHash }),
    supabase.rpc('record_link_pageview', { p_slug: slug, p_ip_hash: ipHash }),
  ]);

  const event = rows?.[0];
  if (!event) return <LandingClosed />;

  const starts = new Date(event.starts_at);
  const display: LandingEvent = {
    name: event.event_name,
    date: dateFmt.format(starts),
    time: timeFmt.format(starts),
    via: event.via_label ?? undefined,
    spotsLeft: event.spots_left,
  };

  return <LandingForm event={display} slug={slug} action={submitGuestRequest} />;
}
