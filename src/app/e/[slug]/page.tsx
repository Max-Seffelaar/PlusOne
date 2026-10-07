import type { JSX } from 'react';
import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { submitGuestRequest } from '@/features/requests/actions';
import { landingClientIpHash } from '@/features/requests/ip-hash';
import { publicRpcTrustHeaders } from '@/features/requests/rpc-trust';
import { LandingForm, LandingClosed, type LandingEvent } from '@/components/po/landing';
import { resolveEventLocation } from '@/features/po/adapters';

export const metadata: Metadata = {
  title: 'Get on the list · PlusOne',
  // Per-event request links are private; never index them.
  robots: { index: false, follow: false },
};

// See src/lib/public-route-viewport.ts — overrides the root layout's locked
// viewport so a guest filling in this form can pinch-zoom (WCAG 1.4.4).
export { publicRouteViewport as viewport } from '@/lib/public-route-viewport';

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
  const supabase = await createClient({ headers: publicRpcTrustHeaders() });

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
  // Same fallback rule as the app (one helper), but the company address is
  // never public here: get_landing_event does not return it (spec #48(c)), so
  // an event without its own location shows the company name, as before.
  const location = resolveEventLocation({
    location_name: event.location_name,
    location_address: event.location_address,
    venue_name: event.venue_name,
    venue_address: null,
  });
  const display: LandingEvent = {
    name: event.event_name,
    date: dateFmt.format(starts),
    time: timeFmt.format(starts),
    venue: event.venue_name,
    // Own location: name and address both (the guest has to get there);
    // fallback: the company name.
    place: (location.own ? [location.name, location.address].filter(Boolean).join(', ') : location.label) || undefined,
    via: event.via_label ?? undefined,
    spotsLeft: event.spots_left,
  };

  return <LandingForm event={display} slug={slug} action={submitGuestRequest} />;
}
