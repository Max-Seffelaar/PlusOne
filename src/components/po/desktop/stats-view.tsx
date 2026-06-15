'use client';

/** Live Statistieken for the desktop dashboard (#26, spec §6). Same visuals as the
 *  former mock `Stats()` in views.tsx — KPI grid, inline "Instroom per kwartier"
 *  bars, per-tier stacked bars, "Toevoegingen per gebruiker" — but fed by the
 *  Postgres analytics functions (20260614120000_admin_analytics.sql) via the
 *  isomorphic data layer. Org-level KPIs (opkomst, weigeringen) come from
 *  venue_stats_summary so they show WITHOUT picking an event; instroom/tier/user
 *  detail is per selected event. Snapshot + "Ververs"; no realtime. */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import {
  fetchEventStats,
  fetchVenueStats,
  type EventStats,
  type PickerEvent,
  type VenueStats,
} from '@/features/stats/data';
import { formatDay } from '@/features/stats/format';
import { eventKpis, toPerKwartier, toPerTier, toPerUser, venueKpis } from '@/features/stats/po-adapter';
import { Icon } from '../icon';
import { Avatar } from '../kit';
import { DBtn, DCard } from './kit';

export interface StatsBootstrap {
  venueId: string;
  venueName: string;
  venues: { venueId: string; venueName: string }[];
  venueStats: VenueStats;
  events: PickerEvent[];
  selectedEventId: string | null;
  eventStats: EventStats | null;
}

const pad = 'px-[34px] pb-10';

/** Topbar event picker (rendered by the desktop shell). Styled like the prototype's
 *  `EventPick` button; a native <select> so switching is a snappy client refetch. */
export function EventSelect({
  events,
  value,
  onChange,
}: {
  events: PickerEvent[];
  value: string | null;
  onChange: (id: string) => void;
}): JSX.Element {
  return (
    <div className="relative inline-flex items-center gap-[9px] rounded-[12px] border border-line bg-elev px-[14px] py-[10px] font-display text-[14px] font-bold text-text">
      <span className="h-2 w-2 shrink-0 rounded-full bg-acc" />
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Kies event"
        className="cursor-pointer appearance-none bg-transparent pr-5 font-display text-[14px] font-bold text-text outline-none"
      >
        {events.map((e) => (
          <option key={e.id} value={e.id} className="bg-elev text-text">
            {e.name} · {formatDay(e.startsAt)}
          </option>
        ))}
      </select>
      <Icon name="chevD" size={15} className="pointer-events-none absolute right-3 text-ghost" />
    </div>
  );
}

export function Stats({
  bootstrap,
  eventId,
}: {
  bootstrap: StatsBootstrap | null;
  eventId: string | null;
}): JSX.Element {
  if (!bootstrap) {
    return (
      <div className={cn('pt-7', pad)}>
        <DCard className="p-8 text-center text-[14px] text-faint">
          Je hebt geen rechten om statistieken in te zien.
        </DCard>
      </div>
    );
  }
  return <StatsBody bootstrap={bootstrap} eventId={eventId} />;
}

function StatsBody({ bootstrap, eventId }: { bootstrap: StatsBootstrap; eventId: string | null }): JSX.Element {
  const [venueStats, setVenueStats] = useState(bootstrap.venueStats);
  const [eventStats, setEventStats] = useState<EventStats | null>(bootstrap.eventStats);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const initial = useRef(true);

  // Refetch event detail when the selection changes or on manual refresh. The first
  // render already has the SSR-prefetched default event, so skip that fetch.
  useEffect(() => {
    if (initial.current && eventId === bootstrap.selectedEventId) {
      initial.current = false;
      return;
    }
    if (!eventId) {
      setEventStats(null);
      return;
    }
    const client = createClient();
    let alive = true;
    setLoading(true);
    void fetchEventStats(client, eventId)
      .then((s) => {
        if (alive) setEventStats(s);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [eventId, reloadKey, bootstrap.selectedEventId]);

  // Manual refresh also refreshes the org-level KPIs (check-ins move them too).
  useEffect(() => {
    if (reloadKey === 0) return;
    const client = createClient();
    let alive = true;
    void fetchVenueStats(client, bootstrap.venueId, null, null).then((s) => {
      if (alive) setVenueStats(s);
    });
    return () => {
      alive = false;
    };
  }, [reloadKey, bootstrap.venueId]);

  const vk = venueKpis(venueStats.summary);
  const ek = eventKpis(eventStats?.summary ?? null);
  const perKwartier = eventStats ? toPerKwartier(eventStats.perQuarter) : [];
  const perTier = eventStats ? toPerTier(eventStats.tiers) : [];
  const perUser = eventStats ? toPerUser(eventStats.users) : [];
  const maxK = Math.max(1, ...perKwartier.map((x) => x.n));
  const maxT = Math.max(1, ...perTier.map((x) => x.aangemeld));
  const selectedEvent = bootstrap.events.find((e) => e.id === eventId) ?? null;

  const kpis: { v: string; l: string; s: string }[] = [
    { v: vk.attendancePct, l: 'Gem. opkomst', s: `over ${vk.events} events` },
    {
      v: ek.peak ?? '—',
      l: 'Piek instroom',
      s: ek.peakCount > 0 ? `${ek.peakCount} in 15 min` : 'nog geen check-ins',
    },
    { v: String(vk.refused), l: 'Weigeringen', s: 'totaal aan de deur' },
    { v: String(ek.noShows), l: 'No-show', s: `${ek.noShowPct}% niet verschenen` },
  ];

  return (
    <div className={cn('flex flex-col gap-[22px] pt-7', pad, loading && 'opacity-60 transition-opacity')}>
      <div className="grid grid-cols-4 gap-4">
        {kpis.map((k) => (
          <DCard key={k.l} className="p-5">
            <div className="font-display text-[32px] font-extrabold tracking-[-0.02em] text-text">{k.v}</div>
            <div className="mt-[10px] text-[14px] font-semibold text-text">{k.l}</div>
            <div className="mt-0.5 text-[12.5px] text-faint">{k.s}</div>
          </DCard>
        ))}
      </div>

      <DCard className="p-6">
        <div className="mb-[22px] flex items-center justify-between">
          <div>
            <div className="font-display text-[17px] font-bold text-text">Instroom per kwartier</div>
            <div className="mt-0.5 text-[12.5px] text-faint">
              Check-ins aan de deur{selectedEvent ? ` · ${selectedEvent.name}` : ''}
            </div>
          </div>
          <DBtn sm kind="ghost" icon="refresh" onClick={() => setReloadKey((k) => k + 1)}>
            Ververs
          </DBtn>
        </div>
        {perKwartier.length === 0 ? (
          <div className="flex h-[180px] items-center justify-center text-[14px] text-faint">
            {selectedEvent ? 'Nog geen check-ins voor dit event.' : 'Kies een event voor instroomdetails.'}
          </div>
        ) : (
          <div className="flex h-[180px] items-end gap-[10px]">
            {perKwartier.map((b) => (
              <div key={b.t} className="flex flex-1 flex-col items-center gap-2">
                <div className="font-display text-[11px] font-bold text-dim">{b.n}</div>
                <div
                  className={cn(
                    'w-full max-w-[38px] rounded-[7px] border',
                    b.n === maxK ? 'border-transparent bg-acc' : 'border-line bg-elev2'
                  )}
                  style={{ height: (b.n / maxK) * 130 }}
                />
                <div className="font-display text-[10.5px] text-faint">{b.t}</div>
              </div>
            ))}
          </div>
        )}
      </DCard>

      <div className="grid grid-cols-[1.3fr_1fr] gap-4">
        <DCard className="p-6">
          <div className="mb-5 font-display text-[17px] font-bold text-text">Aanwezig vs. aangemeld per tier</div>
          {perTier.length === 0 ? (
            <p className="text-[14px] text-faint">Geen tierdata voor dit event.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {perTier.map((t) => (
                <div key={t.tier}>
                  <div className="mb-[7px] flex justify-between">
                    <span className="text-[13.5px] font-semibold text-text">{t.tier}</span>
                    <span className="font-display text-[12.5px] text-faint">
                      <b className="text-acc">{t.binnen}</b> / {t.aangemeld}
                    </span>
                  </div>
                  <div className="relative h-[10px] overflow-hidden rounded-[6px] bg-elev2">
                    <div
                      className="absolute inset-0 rounded-[6px] bg-white/[0.08]"
                      style={{ width: (t.aangemeld / maxT) * 100 + '%' }}
                    />
                    <div className="absolute inset-0 rounded-[6px] bg-acc" style={{ width: (t.binnen / maxT) * 100 + '%' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </DCard>
        <DCard className="p-6">
          <div className="mb-4 font-display text-[17px] font-bold text-text">Toevoegingen per gebruiker</div>
          {perUser.length === 0 ? (
            <p className="text-[14px] text-faint">Nog niemand heeft gasten toegevoegd.</p>
          ) : (
            <div className="flex flex-col">
              {perUser.map((u, i) => (
                <div
                  key={`${u.who}-${i}`}
                  className={cn('flex items-center gap-3 py-3', i < perUser.length - 1 && 'border-b border-line2')}
                >
                  <Avatar name={u.who} size={34} />
                  <div className="flex-1">
                    <div className="text-[13.5px] font-semibold text-text">{u.who}</div>
                    <div className="text-[11.5px] text-faint">
                      {u.in} binnen van {u.added}
                    </div>
                  </div>
                  <div className="font-display text-[20px] font-extrabold text-text">{u.added}</div>
                </div>
              ))}
            </div>
          )}
        </DCard>
      </div>
    </div>
  );
}
