import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppAccess } from '@/lib/auth/guards';
import { getReportingVenues } from '@/lib/auth/memberships';
import { fetchVenueStats } from '@/features/stats/queries';
import { formatDay, formatPct } from '@/features/stats/format';
import { StatCard } from '@/features/stats/components/StatCard';
import { PeriodControls } from '@/features/stats/components/PeriodControls';
import { Avatar, Label } from '@/components/po/kit';
import { DCard } from '@/components/po/desktop/kit';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Venue-overzicht — PLUSONE' };

const ROLLUP_GRID = 'grid-cols-[1.6fr_90px_90px_90px_80px]';

// Parse a YYYY-MM-DD date input into an ISO instant; `to` is exclusive end-of-day.
function dayStart(v?: string): string | null {
  return v ? new Date(`${v}T00:00:00`).toISOString() : null;
}
function dayEnd(v?: string): string | null {
  if (!v) return null;
  const d = new Date(`${v}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string; from?: string; to?: string }>;
}): Promise<JSX.Element> {
  await requireAppAccess('/admin/overview');
  const sp = await searchParams;

  const venues = await getReportingVenues();
  if (venues.length === 0) {
    return (
      <div className="card mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Venue-overzicht</h1>
        <p className="text-dim mt-2">Je hebt geen rechten om venue-statistieken in te zien.</p>
      </div>
    );
  }

  const active = venues.find((v) => v.venueId === sp.venue) ?? venues[0];
  const { summary, rollup, users, refusals } = await fetchVenueStats(
    active.venueId,
    dayStart(sp.from),
    dayEnd(sp.to)
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Venue-overzicht</h1>
        <p className="text-dim mt-1 text-sm">
          Alle events samen · <span className="text-text">{active.venueName}</span>
        </p>
      </header>

      {venues.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label="Venue kiezen">
          {venues.map((v) => (
            <Link
              key={v.venueId}
              href={`/admin/overview?venue=${v.venueId}`}
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

      <PeriodControls from={sp.from ?? null} to={sp.to ?? null} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard value={String(summary?.events ?? 0)} label="Events" sub="in deze periode" />
        <StatCard
          value={formatPct(summary?.attendance_pct ?? 0)}
          label="Gem. opkomst"
          sub={`${summary?.present_headcount ?? 0} van ${summary?.registered_headcount ?? 0}`}
          accent
        />
        <StatCard
          value={String(summary?.present_headcount ?? 0)}
          label="Gasten binnen"
          sub={`${summary?.no_shows ?? 0} no-shows`}
        />
        <StatCard
          value={String(summary?.refused ?? 0)}
          label="Weigeringen"
          sub="totaal aan de deur"
        />
      </div>

      <DCard className="overflow-hidden p-0">
        <div className={cn('grid border-b border-line bg-bg px-[22px] py-[13px]', ROLLUP_GRID)}>
          {['Event', 'Aangem.', 'Binnen', 'Opkomst', 'Geweig.'].map((h) => (
            <Label key={h}>{h}</Label>
          ))}
        </div>
        {rollup.length === 0 ? (
          <div className="p-8 text-center text-[14px] text-faint">Geen events in deze periode.</div>
        ) : (
          rollup.map((e, i) => (
            <Link
              key={e.event_id}
              href={`/admin/stats?venue=${active.venueId}&event=${e.event_id}`}
              className={cn(
                'grid items-center px-[22px] py-[14px] transition-colors hover:bg-white/[0.025]',
                ROLLUP_GRID,
                i < rollup.length - 1 && 'border-b border-line2'
              )}
            >
              <div className="min-w-0">
                <div className="truncate font-display text-[14.5px] font-bold text-text">{e.name}</div>
                <div className="text-[12px] text-faint">{formatDay(e.starts_at)}</div>
              </div>
              <div className="font-display text-[14px] text-dim">{e.registered_headcount}</div>
              <div className="font-display text-[14px] font-bold text-text">{e.present_headcount}</div>
              <div className="font-display text-[14px] text-acc">{formatPct(e.attendance_pct)}</div>
              <div className="font-display text-[14px] text-dim">{e.refused}</div>
            </Link>
          ))
        )}
      </DCard>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <DCard className="p-6">
          <div className="mb-4 font-display text-[17px] font-bold text-text">
            Toevoegingen per gebruiker
          </div>
          {users.length === 0 ? (
            <p className="text-[14px] text-faint">Nog geen toevoegingen in deze periode.</p>
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

        <DCard className="p-6">
          <div className="mb-4 font-display text-[17px] font-bold text-text">Weigeringen met reden</div>
          {refusals.length === 0 ? (
            <p className="text-[14px] text-faint">Geen weigeringen in deze periode.</p>
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
      </div>
    </div>
  );
}
