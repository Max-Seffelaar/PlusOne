import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAppAccess } from '@/lib/auth/guards';
import {
  getManageableEvent,
  getEventTiers,
  getEventOrganizers,
  getAssignableMembers,
} from '@/features/events/queries';
import { formatEventRange } from '@/features/events/format';
import { StatusBadge } from '@/features/events/components/StatusBadge';
import { EventsTopbar } from '@/features/events/components/EventsTopbar';
import { EventForm } from '@/features/events/components/EventForm';
import { EventStatusControl } from '@/features/events/components/EventStatusControl';
import { LandingControl } from '@/features/events/components/LandingControl';
import { LockControl } from '@/features/events/components/LockControl';
import { TierManager } from '@/features/events/components/TierManager';
import { OrganizerManager } from '@/features/events/components/OrganizerManager';

export const metadata: Metadata = { title: 'Event beheren — PLUSONE' };

export default async function EventManagePage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}): Promise<JSX.Element> {
  const { eventId } = await params;
  const ctx = await requireAppAccess(`/events/${eventId}`);
  const event = await getManageableEvent(eventId);
  if (!event) notFound();

  const canManage = event.isAdmin || event.isOrganizer;

  // Anyone who can see the event but not manage it (staff/doorhost/finance) gets
  // a pointer to the guest list rather than the admin surface.
  if (!canManage) {
    return (
      <>
        <EventsTopbar backHref="/events" />
        <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
          <h1 className="font-display text-2xl font-bold">{event.name}</h1>
          <div className="card">
            <p className="text-dim">Je hebt geen beheerrechten voor dit event.</p>
            <Link href={`/events/${eventId}/guests`} className="text-acc-soft mt-2 inline-block text-sm underline">
              Naar de gastenlijst →
            </Link>
          </div>
        </main>
      </>
    );
  }

  const [tiers, organizers, candidates] = await Promise.all([
    getEventTiers(eventId),
    getEventOrganizers(eventId),
    event.isAdmin ? getAssignableMembers(event.venueId, eventId) : Promise.resolve([]),
  ]);

  return (
    <>
      <EventsTopbar backHref="/events" />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-display text-2xl font-bold">{event.name}</h1>
            <StatusBadge status={event.status} />
          </div>
          <p className="text-dim text-sm">
            {event.venueName} · {formatEventRange(event.startsAt, event.endsAt)}
          </p>
          <Link href={`/events/${eventId}/guests`} className="text-acc-soft text-sm underline">
            Naar de gastenlijst →
          </Link>
        </header>

        <EventStatusControl eventId={eventId} status={event.status} isAdmin={event.isAdmin} />

        <section className="flex flex-col gap-3">
          <h2 className="label">Gegevens</h2>
          <EventForm
            mode="edit"
            event={{
              id: event.id,
              name: event.name,
              startsAt: event.startsAt,
              endsAt: event.endsAt,
            }}
          />
        </section>

        <LandingControl eventId={eventId} landingActive={event.landingActive} slug={event.landingSlug} />

        <LockControl eventId={eventId} locked={event.listLocked} />

        <TierManager eventId={eventId} tiers={tiers} canManage={canManage} />

        <OrganizerManager
          eventId={eventId}
          organizers={organizers}
          candidates={candidates}
          isAdmin={event.isAdmin}
          isAal2={ctx.isAal2}
          hasVerifiedTotp={ctx.hasVerifiedTotp}
        />
      </main>
    </>
  );
}
