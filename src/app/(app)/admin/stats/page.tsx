import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppAccess } from '@/lib/auth/guards';
import { getReportingVenues } from '@/lib/auth/memberships';
import { fetchEventStats, fetchVenueEvents } from '@/features/stats/queries';
import { formatClock, formatDay, formatPct } from '@/features/stats/format';
import { StatCard } from '@/features/stats/components/StatCard';
import { EventPicker } from '@/features/stats/components/EventPicker';
import { InflowChart, type InflowDatum } from '@/features/stats/components/InflowChart';
import { TierChart, type TierDatum } from '@/features/stats/components/TierChart';
import { Avatar, Label } from '@/components/po/kit';
import { DCard } from '@/components/po/desktop/kit';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Statistieken — PLUSONE' };

const FALLBACK_TIER_COLOR = '#8A8A93';

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string; event?: string }>;
}): Promise<JSX.Element> {
  await requireAppAccess('/admin/stats');
  const { venue: venueParam, event: eventParam } = await searchParams;

  const venues = await getReportingVenues();
  if (venues.length === 0) {
    return (
      <div className="card mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Statistieken</h1>
        <p className="text-dim mt-2">Je hebt geen rechten om statistieken in te zien.</p>
      </div>
    );
  }

  const active = venues.find((v) => v.venueId === venueParam) ?? venues[0];
  const events = await fetchVenueEvents(active.venueId);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Statistieken</h1>
          <p className="text-dim mt-1 text-sm">
            Per event · <span className="text-text">{active.venueName}</span>
          </p>
        </div>
        {events.length > 0 && (
          <EventPicker
            options={events.map((e) => ({ id: e.id, label: `${e.name} · ${formatDay(e.startsAt)}` }))}
            current={(events.find((e) => e.id === eventParam) ?? events[0]).id}
          />
        )}
      </header>

      {venues.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label="Venue kiezen">
          {venues.map((v) => (
            <Link
              key={v.venueId}
              href={`/admin/stats?venue=${v.venueId}`}
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

      {events.length === 0 ? (
        <DCard className="p-8 text-center text-[14px] text-faint">
          Deze venue heeft nog geen events.
        </DCard>
      ) : (
        <EventStats eventId={(events.find((e) => e.id === eventParam) ?? events[0]).id} />
      )}
    </div>
  );
}

async function EventStats({ eventId }: { eventId: string }): Promise<JSX.Element> {
  const { summary, perQuarter, tiers, users, refusals } = await fetchEventStats(eventId);

  const inflow: InflowDatum[] = perQuarter.map((b) => ({
    label: formatClock(b.bucket),
    checkins: b.checkins,
    headcount: b.headcount,
  }));
  const peakLabel = summary?.peak_bucket ? formatClock(summary.peak_bucket) : null;

  const tierData: TierDatum[] = tiers.map((t) => ({
    tier: t.tier_name,
    present: t.present_headcount,
    registered: t.registered_headcount,
    gap: Math.max(t.registered_headcount - t.present_headcount, 0),
    color: t.color ?? FALLBACK_TIER_COLOR,
  }));

  const noShowPct =
    summary && summary.registered > 0 ? Math.round((summary.no_shows / summary.registered) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          value={formatPct(summary?.attendance_pct ?? 0)}
          label="Opkomst"
          sub={`${summary?.present_headcount ?? 0} van ${summary?.registered_headcount ?? 0} binnen`}
          accent
        />
        <StatCard
          value={peakLabel ?? '—'}
          label="Piek instroom"
          sub={summary?.peak_count ? `${summary.peak_count} in 15 min` : 'nog geen check-ins'}
        />
        <StatCard
          value={String(summary?.refused ?? 0)}
          label="Weigeringen"
          sub={`${summary?.present ?? 0} binnen · ${summary?.registered ?? 0} aangemeld`}
        />
        <StatCard
          value={String(summary?.no_shows ?? 0)}
          label="No-show"
          sub={`${noShowPct}% niet verschenen`}
        />
      </div>

      <DCard className="p-6">
        <div className="mb-5">
          <div className="font-display text-[17px] font-bold text-text">Instroom per kwartier</div>
          <div className="mt-0.5 text-[12.5px] text-faint">Check-ins aan de deur</div>
        </div>
        <InflowChart data={inflow} peakLabel={peakLabel} />
      </DCard>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <DCard className="min-w-0 p-6">
          <div className="mb-5 font-display text-[17px] font-bold text-text">
            Aanwezig vs. aangemeld per tier
          </div>
          <TierChart data={tierData} />
        </DCard>

        <DCard className="p-6">
          <div className="mb-4 font-display text-[17px] font-bold text-text">
            Toevoegingen per gebruiker
          </div>
          {users.length === 0 ? (
            <p className="text-[14px] text-faint">Nog niemand heeft gasten toegevoegd.</p>
          ) : (
            <div className="flex flex-col">
              {users.map((u, i) => (
                <div
                  key={u.user_id}
                  className={cn('flex items-center gap-3 py-3', i < users.length - 1 && 'border-b border-line2')}
                >
                  <Avatar name={u.full_name} size={34} />
                  <div className="flex-1">
                    <div className="text-[13.5px] font-semibold text-text">{u.full_name}</div>
                    <div className="text-[11.5px] text-faint">{u.present} binnen van {u.added}</div>
                  </div>
                  <div className="font-display text-[20px] font-extrabold text-text">{u.added}</div>
                </div>
              ))}
            </div>
          )}
        </DCard>
      </div>

      <DCard className="p-6">
        <div className="mb-4 font-display text-[17px] font-bold text-text">Weigeringen met reden</div>
        {refusals.length === 0 ? (
          <p className="text-[14px] text-faint">Geen weigeringen voor dit event.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {refusals.map((r, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-4 rounded-[12px] border border-line bg-elev2 px-4 py-3"
              >
                <span className="text-[14px] text-text">{r.reason}</span>
                <span className="font-display text-[15px] font-bold text-acc">{r.n}×</span>
              </li>
            ))}
          </ul>
        )}
      </DCard>

      <div className="flex items-center gap-2 text-[12px] text-faint">
        <Label className="normal-case tracking-normal text-faint">
          Alle cijfers hangen aan het event, niet aan de kalenderdag (#26). Aanwezig = check-in aan de
          deur.
        </Label>
      </div>
    </div>
  );
}
