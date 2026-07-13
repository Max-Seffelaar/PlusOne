'use client';

/** Mobile Statistieken (#26, spec §6) — event-first (M6, 86ey7dzmp): pick an event,
 *  then land on the SAME per-event-stats view as the event-home (EventStatsPanel —
 *  one shared component, one fetch, per the K-10-les). Venue-wide KPIs are parked
 *  for now (retention/comparisons only mean something once they're built right);
 *  the picker itself stays client-side over the browser client (RLS + the
 *  functions self-guard on role). Reached from the Meer hub, admin/finance only. */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/client';
import { fetchVenueEvents, type PickerEvent } from '@/features/stats/data';
import { formatDay } from '@/features/stats/format';
import { poKeys } from '@/features/po/keys';
import { useNav, usePo } from '../context';
import { Icon } from '../icon';
import { Empty, IconBtn, Label, Scroll, Top, press } from '../kit';
import { Sheet } from '../shell';
import { EventStatsPanel } from './events/stats-panel';

const col = 'flex h-full flex-col';

export function Stats(): JSX.Element {
  const nav = useNav();
  const { statsVenues, activeVenueId: globalVenueId } = usePo();
  // Stats scope to the globally-active venue (one switcher, not a second per-screen one).
  const venue = statsVenues.find((v) => v.venueId === globalVenueId) ?? statsVenues[0] ?? null;
  const activeVenueId = venue?.venueId ?? null;

  const qc = useQueryClient();
  const [events, setEvents] = useState<PickerEvent[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // A real fetch failure (network/transient DB/RPC error) vs. a legitimate
  // empty result — data.ts throws on the former (C25), so this state is only
  // ever set on an actual error, never on a role-gated empty result.
  const [error, setError] = useState(false);

  // The event picker's list, when the venue changes or on manual refresh.
  useEffect(() => {
    if (!activeVenueId) return;
    const client = createClient();
    let alive = true;
    setLoading(true);
    setError(false);
    void fetchVenueEvents(client, activeVenueId)
      .then((evs) => {
        if (!alive) return;
        setEvents(evs);
        setEventId((cur) => (evs.some((e) => e.id === cur) ? cur : (evs[0]?.id ?? null)));
      })
      .catch(() => {
        if (alive) setError(true);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [activeVenueId, reloadKey]);

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

  const selectedEvent = events.find((e) => e.id === eventId) ?? null;

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.analytics.title}
        sub={venue.venueName}
        right={
          <IconBtn
            name="refresh"
            onClick={() => {
              setReloadKey((k) => k + 1);
              if (eventId) void qc.invalidateQueries({ queryKey: poKeys.eventActivity(eventId) });
            }}
          />
        }
      />
      <Scroll bottom={28} className={cn(loading && 'opacity-60 transition-opacity')}>
        {/* Cross-link to the Promotion dashboard (S15) — link funnels per
            influencer live there, not in the generic analytics. */}
        <button
          type="button"
          onClick={() => nav.push('promotion')}
          className={cn(
            'mb-4 flex w-full items-center gap-[11px] rounded-[14px] border border-line bg-elev px-[14px] py-[12px] text-left',
            'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]'
          )}
        >
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-acc-dim text-acc">
            <Icon name="link" size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-[14.5px] font-bold text-text">
              {t.promo.title}
            </span>
            <span className="block text-[12px] text-faint">{t.promo.hubSub}</span>
          </span>
          <Icon name="chev" size={18} className="text-ghost" />
        </button>

        {error ? (
          <div className="mb-4 rounded-[18px] border border-line bg-elev px-4 py-[22px] text-center">
            <Empty text={t.analytics.fetchError} />
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className={cn(
                'mt-1 inline-flex items-center justify-center rounded-[12px] bg-acc px-[18px] py-[10px] font-display text-[13.5px] font-bold text-ink',
                press
              )}
            >
              {t.analytics.retry}
            </button>
          </div>
        ) : (
          <>
            {/* Venue-wide trends (retention, comparisons across events) are parked
                for now — a calm note instead of numbers that don't say anything
                yet (8/7 UX/IA decision, M6). */}
            <div className="mb-5 rounded-[16px] border border-line bg-elev px-4 py-[13px] text-[12.5px] leading-[1.5] text-faint">
              {t.analytics.venueTrendsLater}
            </div>

            {/* Event-first: pick an event, then see its stats below. */}
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
                {selectedEvent
                  ? selectedEvent.name
                  : events.length === 0
                    ? t.analytics.noEventsYet
                    : t.analytics.pickEvent}
              </span>
              {selectedEvent && (
                <span className="shrink-0 text-[12.5px] text-faint">
                  {formatDay(selectedEvent.startsAt)}
                </span>
              )}
              <Icon name="chevD" size={16} className="text-ghost" />
            </button>

            {/* Same shared component the event-home shows (K-10-les) — never a
                second per-event-stats implementation. */}
            {selectedEvent && <EventStatsPanel eventId={selectedEvent.id} />}
          </>
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
                <span className="min-w-0 truncate font-display text-[14.5px] font-bold text-text">
                  {e.name}
                </span>
                <span className="shrink-0 text-[12.5px] text-faint">{formatDay(e.startsAt)}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
