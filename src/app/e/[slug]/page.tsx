import type { Metadata } from 'next';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { submitGuestRequest } from '@/features/requests/actions';
import { LandingForm, LandingClosed, type LandingEvent } from '@/components/po/landing';

export const metadata: Metadata = {
  title: 'Get on the list · PlusOne',
  // Per-event request links are private; never index them.
  robots: { index: false, follow: false },
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

/** Salted ip hash for the pageview throttle — same recipe as the submit action. */
async function pageviewIpHash(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const ip = (forwarded ? forwarded.split(',')[0] : h.get('x-real-ip') ?? '').trim();
  const salt = process.env.LANDING_IP_SALT ?? 'plusone-landing-dev-salt';
  return createHash('sha256').update(`${salt}:${ip || 'no-ip'}`).digest('hex');
}

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

  const [{ data: rows }] = await Promise.all([
    supabase.rpc('get_landing_event', { p_slug: slug }),
    supabase.rpc('record_link_pageview', { p_slug: slug, p_ip_hash: await pageviewIpHash() }),
  ]);

  const event = rows?.[0];
  if (!event) return <LandingClosed />;

  const starts = new Date(event.starts_at);
  const display: LandingEvent = {
    name: event.event_name,
    date: dateFmt.format(starts),
    time: timeFmt.format(starts),
    via: event.via_label ?? undefined,
  };

  return <LandingForm event={display} slug={slug} action={submitGuestRequest} />;
}
