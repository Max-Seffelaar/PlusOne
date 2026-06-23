'use client';

/** Mobile Statistieken (#26, spec §6) — the same live analytics as the desktop
 *  dashboard, in po mobile language. Org-level KPIs (venue_stats_summary) show
 *  WITHOUT picking an event; a bottom-sheet event picker drives the per-event
 *  instroom/tier/user detail. Client-side fetch through the browser client (RLS +
 *  the functions self-guard on role); snapshot + a refresh button, no realtime.
 *  Reached from the Meer hub, gated to reporting venues (admin/finance). */
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/client';
import {
  fetchEventStats,
  fetchVenueEvents,
  fetchVenueStats,
  type EventStats,
  type PickerEvent,
  type VenueStats,
} from '@/features/stats/data';
import { formatDay } from '@/features/stats/format';
import { eventKpis, toPerKwartier, toPerTier, toPerUser, venueKpis } from '@/features/stats/po-adapter';
import { useNav, usePo } from '../context';
import { Icon } from '../icon';
import { Avatar, Empty, IconBtn, Label, Scroll, Top } from '../kit';
import { Sheet } from '../shell';

const col = 'flex h-full flex-col';
const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';

export function Stats(): JSX.Element {
  const nav = useNav();
  const { statsVenues } = usePo();
  const [venueIdx, setVenueIdx] = useState(0);
  const venue = statsVenues[venueIdx] ?? null;
  const activeVenueId = venue?.venueId ?? null;

  const [venueStats, setVenueStats] = useState<VenueStats | null>(null);
  const [events, setEvents] = useState<PickerEvent[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [eventStats, setEventStats] = useState<EventStats | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Venue-level stats + events when the venue changes or on manual refresh.
  useEffect(() => {
    if (!activeVenueId) return;
    const client = createClient();
    let alive = true;
    setLoading(true);
    void Promise.all([
      fetchVenueStats(client, activeVenueId, null, null),
      fetchVenueEvents(client, activeVenueId),
    ])
      .then(([vs, evs]) => {
        if (!alive) return;
        setVenueStats(vs);
        setEvents(evs);
        setEventId((cur) => (evs.some((e) => e.id === cur) ? cur : (evs[0]?.id ?? null)));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeVenueId, reloadKey]);

  // Per-event detail when the selected event changes or on manual refresh.
  useEffect(() => {
    if (!eventId) {
      setEventStats(null);
      return;
    }
    const client = createClient();
    let alive = true;
    void fetchEventStats(client, eventId).then((s) => {
      if (alive) setEventStats(s);
    });
    return () => {
      alive = false;
    };
  }, [eventId, reloadKey]);

  if (!venue) {
    return (
      <div className={col}>
        <Top onBack={nav.back} title={t.analytics.title} />
        <Scroll bottom={28}>
          <Empty text={t.analytics.noRights} />
        </Scroll>
      </div>
    );
  }

  const vk = venueKpis(venueStats?.summary ?? null);
  const ek = eventKpis(eventStats?.summary ?? null);
  const perKwartier = eventStats ? toPerKwartier(eventStats.perQuarter) : [];
  const perTier = eventStats ? toPerTier(eventStats.tiers) : [];
  const perUser = eventStats ? toPerUser(eventStats.users) : [];
  const maxK = Math.max(1, ...perKwartier.map((x) => x.n));
  const maxT = Math.max(1, ...perTier.map((x) => x.aangemeld));
  const selectedEvent = events.find((e) => e.id === eventId) ?? null;

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.analytics.title}
        sub={venue.venueName}
        right={<IconBtn name="refresh" onClick={() => setReloadKey((k) => k + 1)} />}
      />
      <Scroll bottom={28} className={cn(loading && 'opacity-60 transition-opacity')}>
        {statsVenues.length > 1 && (
          <div className="po-scroll mb-4 flex gap-2 overflow-x-auto">
            {statsVenues.map((v, i) => (
              <button
                key={v.venueId}
                type="button"
                onClick={() => setVenueIdx(i)}
                className={cn(
                  'inline-flex shrink-0 items-center rounded-full border px-[14px] py-[8px] font-display text-[13px] font-bold',
                  press,
                  i === venueIdx ? 'border-transparent bg-acc text-on-acc' : 'border-line text-dim'
                )}
              >
                {v.venueName}
              </button>
            ))}
          </div>
        )}

        {/* Org-level KPIs — meaningful without selecting an event. Stacked on
            mobile (hero + a 2-up row); a single 3-across band on desktop. */}
        <div className="mb-5 flex flex-col gap-[10px] lg:grid lg:grid-cols-[1.3fr_1fr_1fr] lg:items-stretch lg:gap-3">
          <div className="rounded-[18px] bg-acc-dim p-[18px]">
            <Label className="mb-[10px] text-acc-soft">{t.analytics.venueTurnoutLabel}</Label>
            <div className="flex items-end gap-[10px]">
              <div className="font-display text-[54px] font-extrabold leading-[0.9] text-text">{vk.attendancePct}</div>
              <div className="pb-1.5">
                <div className="text-[14px] font-semibold text-text">{t.analytics.turnoutWord}</div>
                <div className="text-[12.5px] text-dim">{fmt(t.analytics.overEvents, { n: vk.events })}</div>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-[10px] lg:contents">
            <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px] lg:flex lg:flex-col lg:justify-center">
              <div className="font-display text-[30px] font-extrabold leading-none text-acc">{vk.presentHeadcount}</div>
              <div className="mt-1 text-[12.5px] text-dim">{t.analytics.guestsInside}</div>
            </div>
            <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px] lg:flex lg:flex-col lg:justify-center">
              <div className="font-display text-[30px] font-extrabold leading-none text-text">{vk.refused}</div>
              <div className="mt-1 text-[12.5px] text-faint">{t.analytics.refusals}</div>
            </div>
          </div>
        </div>

        {/* Per-event detail. */}
        <Label className="mb-[10px]">{t.analytics.perEvent}</Label>
        <button
          type="button"
          onClick={() => setPickOpen(true)}
          disabled={events.length === 0}
          className={cn(
            'mb-4 flex w-full items-center gap-[10px] rounded-[14px] border border-line bg-elev px-[14px] py-[13px] text-left',
            press,
            events.length === 0 && 'opacity-50'
          )}
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-acc" />
          <span className="min-w-0 flex-1 truncate font-display text-[14.5px] font-bold text-text">
            {selectedEvent ? selectedEvent.name : events.length === 0 ? t.analytics.noEventsYet : t.analytics.pickEvent}
          </span>
          {selectedEvent && <span className="shrink-0 text-[12.5px] text-faint">{formatDay(selectedEvent.startsAt)}</span>}
          <Icon name="chevD" size={16} className="text-ghost" />
        </button>

        {!selectedEvent ? null : !eventStats ? (
          <Empty text={t.analytics.loading} />
        ) : (
          // Desktop: two balanced columns (KPIs + instroom · tier + per-user).
          // Mobile: the two column wrappers are plain blocks, so the original
          // single-column order (KPIs → instroom → tier → per-user) is preserved.
          <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-4">
            <div>
              <div className="mb-4 grid grid-cols-2 gap-[10px]">
                <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
                  <div className="font-display text-[24px] font-extrabold text-text">{ek.peak ?? '—'}</div>
                  <div className="mt-[3px] text-[12px] text-faint">
                    {ek.peakCount > 0 ? fmt(t.analytics.peakWithCount, { n: ek.peakCount }) : t.analytics.peakLabel}
                  </div>
                </div>
                <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
                  <div className="font-display text-[24px] font-extrabold text-text">{ek.noShows}</div>
                  <div className="mt-[3px] text-[12px] text-faint">{fmt(t.analytics.noShowLabel, { pct: ek.noShowPct })}</div>
                </div>
              </div>

              <Label className="mb-[10px]">{t.analytics.arrivalsLabel}</Label>
              <div className="mb-4 rounded-[18px] border border-line bg-elev p-4">
                {perKwartier.length === 0 ? (
                  <div className="py-[18px] text-center text-[13px] text-faint">{t.analytics.noCheckins}</div>
                ) : (
                  <div className="flex h-[120px] items-end gap-[5px]">
                    {perKwartier.map((b) => (
                      <div key={b.t} className="flex flex-1 flex-col items-center gap-1.5">
                        <div className="font-display text-[10px] font-bold text-dim">{b.n}</div>
                        <div
                          className={cn(
                            'w-full rounded-[5px] border',
                            b.n === maxK ? 'border-transparent bg-acc' : 'border-line bg-elev2'
                          )}
                          style={{ height: (b.n / maxK) * 80 }}
                        />
                        <div className="font-display text-[9px] text-faint">{b.t}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label className="mb-[10px]">{t.analytics.tierLabel}</Label>
              <div className="mb-4 rounded-[18px] border border-line bg-elev p-4">
                {perTier.length === 0 ? (
                  <div className="py-[14px] text-center text-[13px] text-faint">{t.analytics.noTierData}</div>
                ) : (
                  perTier.map((row, i) => (
                    <div key={row.tier} className={i < perTier.length - 1 ? 'mb-[13px]' : ''}>
                      <div className="mb-1.5 flex justify-between">
                        <span className="text-[13px] font-semibold text-text">{row.tier}</span>
                        <span className="font-display text-[12px] text-faint">
                          <b className="text-acc">{row.binnen}</b>/{row.aangemeld}
                        </span>
                      </div>
                      <div className="relative h-[8px] overflow-hidden rounded-[5px] bg-elev2">
                        <div className="absolute inset-0 bg-white/[0.08]" style={{ width: (row.aangemeld / maxT) * 100 + '%' }} />
                        <div className="absolute inset-0 rounded-[5px] bg-acc" style={{ width: (row.binnen / maxT) * 100 + '%' }} />
                      </div>
                    </div>
                  ))
                )}
              </div>

              <Label className="mb-[10px]">{t.analytics.addedByLabel}</Label>
              <div className="mb-[14px] rounded-[18px] border border-line bg-elev px-[14px] py-0.5">
                {perUser.length === 0 ? (
                  <div className="py-[14px] text-center text-[13px] text-faint">{t.analytics.noOneAdded}</div>
                ) : (
                  perUser.map((u, i) => (
                    <div
                      key={`${u.who}-${i}`}
                      className={cn('flex items-center gap-[12px] py-[11px]', i < perUser.length - 1 && 'border-b border-line2')}
                    >
                      <Avatar name={u.who} size={36} />
                      <div className="min-w-0 flex-1">
                        <div className="font-display text-[14.5px] font-bold text-text">{u.who}</div>
                        <div className="mt-0.5 text-[12px] text-faint">
                          {fmt(t.analytics.userInOfAdded, { in: u.in, added: u.added })}
                        </div>
                      </div>
                      <div className="font-display text-[18px] font-extrabold text-text">{u.added}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <div className="px-1 text-[11.5px] leading-[1.5] text-faint">{t.analytics.footerNote}</div>
      </Scroll>

      {pickOpen && (
        <Sheet onClose={() => setPickOpen(false)} center={false}>
          <Label className="mb-3">{t.analytics.pickEventTitle}</Label>
          <div className="flex flex-col gap-1.5">
            {events.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => {
                  setEventId(e.id);
                  setPickOpen(false);
                }}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-[13px] border px-[14px] py-[12px] text-left',
                  press,
                  e.id === eventId ? 'border-transparent bg-acc-dim' : 'border-line bg-elev'
                )}
              >
                <span className="min-w-0 truncate font-display text-[14.5px] font-bold text-text">{e.name}</span>
                <span className="shrink-0 text-[12.5px] text-faint">{formatDay(e.startsAt)}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
