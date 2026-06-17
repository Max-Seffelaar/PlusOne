import type { Metadata } from 'next';
import { requireAppAccess } from '@/lib/auth/guards';
import { getAdminVenues } from '@/features/events/queries';
import { EventForm } from '@/features/events/components/EventForm';
import { EventsTopbar } from '@/features/events/components/EventsTopbar';

export const metadata: Metadata = { title: 'Nieuw event — PLUSONE' };

export default async function NewEventPage(): Promise<JSX.Element> {
  await requireAppAccess('/events/new');
  const adminVenues = await getAdminVenues();

  return (
    <>
      <EventsTopbar backHref="/events" />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        <header>
          <h1 className="font-display text-2xl font-bold">Nieuw event</h1>
          <p className="text-dim mt-1 text-sm">
            Naam, datum/tijd en — optioneel — meteen de aanvraaglink aan. Tiers en organisatoren
            stel je daarna in.
          </p>
        </header>

        {adminVenues.length === 0 ? (
          <div className="card">
            <p className="text-dim">Alleen een admin kan events aanmaken.</p>
          </div>
        ) : (
          <EventForm mode="create" venues={adminVenues} />
        )}
      </main>
    </>
  );
}
