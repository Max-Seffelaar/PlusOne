import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  GuestRequestsInbox,
  type PendingGuestRequest,
} from '@/features/requests/components/GuestRequestsInbox';

// Approval screen for landing-page requests (#12). Admin + organizer of the
// event only (role matrix §2). Everything is read through the USER-scoped
// client, so RLS decides visibility and the approve/deny actions are the real
// boundary. Middleware already guarantees a session on /events/*.

export default async function RequestsPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return (
      <main className="mx-auto max-w-md p-6">
        <p className="text-dim">Log eerst in om aanvragen te beheren.</p>
      </main>
    );
  }

  const { data: event } = await supabase
    .from('events')
    .select('id, name, venue_id, status')
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

  const isAdmin = (membership?.roles ?? []).includes('admin');
  const isOrganizer = Boolean(organizer);
  const canDecide = isAdmin || isOrganizer;

  if (!canDecide) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4 sm:p-6">
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-bold">{event.name}</h1>
          <p className="text-sm text-dim">Aanvragen</p>
        </header>
        <p className="text-dim">
          Alleen een admin of de organisator van dit event kan aanvragen goedkeuren.
        </p>
      </main>
    );
  }

  const [{ data: reqs }, { data: tierRows }] = await Promise.all([
    supabase
      .from('guest_requests')
      .select('id, full_name, email, phone, plus_ones, motivation, created_at')
      .eq('event_id', eventId)
      .eq('status', 'pending')
      .order('created_at'),
    supabase.from('guest_tiers').select('id, name').eq('event_id', eventId).order('name'),
  ]);

  const requests: PendingGuestRequest[] = (reqs ?? []).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    plusOnes: r.plus_ones,
    motivation: r.motivation,
    createdAt: r.created_at,
  }));
  const tiers = (tierRows ?? []).map((t) => ({ id: t.id, name: t.name }));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-display text-2xl font-bold">{event.name}</h1>
          <Link
            href={`/events/${eventId}/guests`}
            className="text-dim hover:text-text text-sm transition-colors"
          >
            Gastenlijst →
          </Link>
        </div>
        <p className="text-sm text-dim">Aanvragen via de landingpage · status {event.status}</p>
      </header>

      <GuestRequestsInbox eventId={eventId} requests={requests} tiers={tiers} />
    </main>
  );
}
