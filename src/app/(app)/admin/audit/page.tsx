import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppAccess } from '@/lib/auth/guards';
import { getReportingVenues } from '@/lib/auth/memberships';
import {
  fetchAuditFeed,
  fetchAuditFilterOptions,
  fetchGuestHistory,
} from '@/features/audit/queries';
import { AuditFilters } from '@/features/audit/components/AuditFilters';
import { AuditTable } from '@/features/audit/components/AuditTable';
import { GuestHistoryTimeline } from '@/features/audit/components/GuestHistoryTimeline';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Audit log — PLUSONE' };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    venue?: string;
    event?: string;
    user?: string;
    guest?: string;
    action?: string;
    q?: string;
  }>;
}): Promise<JSX.Element> {
  const ctx = await requireAppAccess('/admin/audit');
  const sp = await searchParams;

  const venues = await getReportingVenues();
  if (venues.length === 0) {
    return (
      <div className="card mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Audit log</h1>
        <p className="text-dim mt-2">Je hebt geen rechten om het audit log in te zien.</p>
      </div>
    );
  }

  const active = venues.find((v) => v.venueId === sp.venue) ?? venues[0];

  // Per-guest "geschiedenis"-view (#15).
  if (sp.guest) {
    const history = await fetchGuestHistory(sp.guest);
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="font-display text-2xl font-bold">Geschiedenis</h1>
          <p className="text-dim mt-1 text-sm">Wat is er met deze gast gebeurd?</p>
        </header>
        <GuestHistoryTimeline history={history} venueId={active.venueId} />
      </div>
    );
  }

  // Inzage vereist een MFA-geverifieerde sessie (audit_log RLS, CLAUDE.md §Auth).
  if (!ctx.isAal2) {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <h1 className="font-display text-2xl font-bold">Audit log</h1>
        </header>
        <section className="border-acc-dim bg-acc-dim rounded-card border p-4 text-sm">
          <p className="text-text font-semibold">MFA vereist om het audit log in te zien</p>
          <p className="text-dim mt-1">
            Inzage in het onveranderlijke logboek vereist een MFA-geverifieerde sessie.{' '}
            <Link
              href={ctx.hasVerifiedTotp ? '/mfa/verify' : '/mfa/enroll'}
              className="text-acc-soft underline"
            >
              {ctx.hasVerifiedTotp ? 'Verifieer met je authenticator' : 'Stel MFA in'}
            </Link>
            .
          </p>
        </section>
      </div>
    );
  }

  const [{ events, actors }, lines] = await Promise.all([
    fetchAuditFilterOptions(active.venueId),
    fetchAuditFeed({
      venueId: active.venueId,
      eventId: sp.event,
      actorId: sp.user,
      action: sp.action,
      search: sp.q,
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Audit log</h1>
        <p className="text-dim mt-1 text-sm">
          Onveranderlijk logboek — wie deed wat, wanneer · <span className="text-text">{active.venueName}</span>
        </p>
      </header>

      {venues.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label="Venue kiezen">
          {venues.map((v) => (
            <Link
              key={v.venueId}
              href={`/admin/audit?venue=${v.venueId}`}
              className={cn(
                'rounded-btn border px-3 py-1.5 text-sm transition-colors',
                v.venueId === active.venueId
                  ? 'border-acc bg-acc-dim text-text'
                  : 'border-line text-dim hover:border-acc'
              )}
            >
              {v.venueName}
            </Link>
          ))}
        </nav>
      )}

      <AuditFilters
        events={events}
        actors={actors}
        current={{ action: sp.action ?? 'all', eventId: sp.event, actorId: sp.user, search: sp.q }}
      />

      <AuditTable lines={lines} venueId={active.venueId} />
    </div>
  );
}
