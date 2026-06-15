import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { submitGuestRequest } from '@/features/requests/actions';
import { LandingForm, LandingClosed, type LandingEvent } from '@/components/po/landing';

export const metadata: Metadata = {
  title: 'Zet jezelf op de lijst · PLUSONE',
  // Per-event request links are private; never index them.
  robots: { index: false, follow: false },
};

const dateFmt = new Intl.DateTimeFormat('nl-NL', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Amsterdam',
});
const timeFmt = new Intl.DateTimeFormat('nl-NL', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Amsterdam',
});

/**
 * Public per-event landing page (#12/#28). Resolves the event through the anon
 * RLS boundary: events_select_landing only returns it while landing_active and
 * status<>'closed'. A null result therefore covers "unknown slug" and
 * "deactivated link" identically → the closed page leaks nothing (no
 * enumeration). The form posts to the rate-limited submit_guest_request action.
 */
export default async function LandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<JSX.Element> {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: event } = await supabase
    .from('events')
    .select('id, name, starts_at')
    .eq('landing_slug', slug)
    .maybeSingle();

  if (!event) return <LandingClosed />;

  const starts = new Date(event.starts_at);
  const display: LandingEvent = {
    name: event.name,
    date: dateFmt.format(starts),
    time: timeFmt.format(starts),
  };

  return <LandingForm event={display} slug={slug} action={submitGuestRequest} />;
}
