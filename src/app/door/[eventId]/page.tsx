import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { DoorRoute } from '@/features/door/components/DoorRoute';
import { isMobileUA } from '@/lib/ua';

// The door experience for one event. Access is enforced here (doorhost/admin at
// the venue, or organizer of the event) AND by RLS on every query/mutation.
//
// Deliberately NOT SSR-ing the guest snapshot: the offline service worker caches
// this navigation for offline boot, so the HTML must stay PII-free on a shared
// device (spec §5). The client fetches + persists the snapshot to IndexedDB and
// keeps it fresh via realtime + delta-sync, writing through the offline outbox.
export default async function DoorEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}): Promise<JSX.Element> {
  const { eventId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/door/${eventId}`);

  const { data: event } = await supabase
    .from('events')
    .select('id, venue_id, status')
    .eq('id', eventId)
    .maybeSingle();
  if (!event) notFound();

  const [{ data: membership }, { data: organizer }] = await Promise.all([
    supabase
      .from('venue_memberships')
      .select('roles')
      .eq('venue_id', event.venue_id)
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('event_organizers')
      .select('id')
      .eq('event_id', eventId)
      .eq('user_id', user.id)
      .maybeSingle(),
  ]);
  const roles = membership?.roles ?? [];
  const canWorkDoor = roles.includes('doorhost') || roles.includes('admin') || Boolean(organizer);
  if (!canWorkDoor) notFound();

  // Desktop split (G2 retest 13/7): a laptop/desktop visitor gets redirected to
  // the full /app shell's Deur tab instead of this focused Door-modus — see
  // DoorRoute. serverHint just picks the first-paint guess; DoorRoute corrects
  // it client-side via matchMedia before deciding whether to redirect.
  const serverHint = isMobileUA((await headers()).get('user-agent'));

  return <DoorRoute eventId={eventId} serverHint={serverHint} />;
}
