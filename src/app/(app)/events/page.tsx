import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppAccess } from '@/lib/auth/guards';
import { getManageableEvents, getAdminVenues, type ManageableEvent } from '@/features/events/queries';
import { formatEventRange } from '@/features/events/format';
import { isEffectivelyLocked } from '@/features/events/lock';
import { StatusBadge } from '@/features/events/components/StatusBadge';
import { EventsTopbar } from '@/features/events/components/EventsTopbar';

export const metadata: Metadata = { title: 'Events — PLUSONE' };

function groupByVenue(events: ManageableEvent[]): Array<{ venueName: string; events: ManageableEvent[] }> {
  const map = new Map<string, { venueName: string; events: ManageableEvent[] }>();
  for (const e of events) {
    const g = map.get(e.venueId) ?? { venueName: e.venueName, events: [] };
    g.events.push(e);
    map.set(e.venueId, g);
  }
  return [...map.values()].sort((a, b) => a.venueName.localeCompare(b.venueName, 'nl'));
}

export default async function EventsPage(): Promise<JSX.Element> {
  await requireAppAccess('/events');
  const [events, adminVenues] = await Promise.all([getManageableEvents(), getAdminVenues()]);
  const groups = groupByVenue(events);

  return (
    <>
      <EventsTopbar />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold">Events</h1>
            <p className="text-dim mt-1 text-sm">Maak en beheer je evenementen, tiers en lijst-lock.</p>
          </div>
          {adminVenues.length > 0 && (
            <Link href="/events/new" className="btn-primary text-sm">
              Nieuw event
            </Link>
          )}
        </header>

        {groups.length === 0 ? (
          <div className="card">
            <p className="text-dim">
              Je beheert nog geen events.
              {adminVenues.length > 0
                ? ' Maak er een aan met “Nieuw event”.'
                : ' Alleen een admin kan events aanmaken.'}
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.venueName} className="flex flex-col gap-3">
              <h2 className="label">{g.venueName}</h2>
              <ul className="flex flex-col gap-2">
                {g.events.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/events/${e.id}`}
                      className="card hover:border-acc flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="font-display truncate font-bold">{e.name}</p>
                        <p className="text-faint mt-0.5 truncate text-sm">
                          {formatEventRange(e.startsAt, e.endsAt)}
                          {e.landingActive ? ' · aanvraaglink aan' : ''}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          <StatusBadge status={e.status} />
                          {isEffectivelyLocked(e.listLocked, e.autoLockAt) && (
                            <span className="border-line text-faint rounded-full border px-2.5 py-0.5 text-xs">
                              Vergrendeld
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="btn-secondary hidden shrink-0 px-3 py-1.5 text-xs sm:inline-block">
                        Beheren →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </main>
    </>
  );
}
