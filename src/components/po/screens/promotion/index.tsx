'use client';

/**
 * Promotion hub (G3, 86ey7e03j) — Promo + Links + Influencers regrouped into
 * one area with three tabs:
 *   Overview   venue-wide funnel + influencer leaderboard (overview.tsx)
 *   Per event  request-link management with results, event picker (event-links.tsx)
 *   Roster     the influencer roster + stats tokens (roster.tsx)
 *
 * Gating (ux-ia-audit vraag 6): the hub is for VENUE MEMBERS with reporting
 * access (`statsVenues`, admin/finance) — deliberately decoupled from the
 * per-event links screen: an external organizer (event-scoped, no membership)
 * keeps managing his own event's links via `/app/events/[id]/links` (ScreenName
 * 'links'), which stays outside this hub. A direct deep link here without
 * access gets a plain no-access state (role-hide, M3), not an empty dashboard.
 */
import { type JSX, useState } from 'react';
import { t } from '@/lib/i18n';
import { usePoEvents } from '@/features/po/hooks';
import { useNav, usePo } from '../../context';
import { Empty, IconBtn, Scroll, Seg, Top } from '../../kit';
import { CreateLinkFlow } from './create-link-flow';
import { PromotionOverview } from './overview';
import { PromotionRoster } from './roster';
import { EventLinks } from './event-links';
import { soonestUpcoming } from './shared';

type PromoTab = 'overview' | 'events' | 'roster';

const TABS: readonly (readonly [PromoTab, string])[] = [
  ['overview', t.promo.tabOverview],
  ['events', t.promo.tabPerEvent],
  ['roster', t.promo.tabRoster],
];

export function PromotionHub({ tab, eventId }: { tab?: string; eventId?: string }): JSX.Element {
  const nav = useNav();
  const { statsVenues } = usePo();
  const active: PromoTab = tab === 'events' || tab === 'roster' ? tab : 'overview';
  // A persistent "+ New link" lives in the hub header (not just the Per-event
  // tab) so creating one doesn't require navigating there first (feedback:
  // tucking link creation only inside "Per event" read as illogical). Reuses
  // the venue's event list already needed elsewhere in the hub; defaults to
  // the same "soonest upcoming, else newest" pick as the Overview tab, and
  // CreateLinkFlow's own EventPicker lets the user redirect it before saving.
  const eventsQ = usePoEvents();
  const events = eventsQ.data ?? [];
  const defaultEvent = soonestUpcoming(events) ?? events[0] ?? null;
  const [creating, setCreating] = useState(false);

  if (statsVenues.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <Top onBack={nav.back} title={t.promo.title} />
        <div className="po-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-[28px]">
          <Empty text={t.promo.noRights} />
        </div>
      </div>
    );
  }

  // Sub-tabs replace (not push): the hub is one destination — back leaves the
  // whole Promotion area instead of unwinding every tab visit. 'overview' is
  // the URL-less default (see routes.ts); the event id only rides on Per event.
  const switchTab = (next: PromoTab): void =>
    nav.replace('promotion', next === 'overview' ? {} : next === 'events' ? { tab: next, id: eventId } : { tab: next });

  return (
    <div className="flex h-full flex-col">
      <Top
        onBack={nav.back}
        title={t.promo.title}
        right={
          active !== 'roster' && defaultEvent ? (
            <IconBtn name="plus" ariaLabel={t.promo.newLink} onClick={() => setCreating(true)} />
          ) : undefined
        }
      />
      <Scroll bottom={40}>
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
          <Seg value={active} onChange={switchTab} items={TABS} className="max-w-[420px]" />
          {active === 'overview' ? (
            <PromotionOverview />
          ) : active === 'events' ? (
            <EventLinks eventId={eventId} embedded />
          ) : (
            <PromotionRoster />
          )}
        </div>
      </Scroll>
      {creating && defaultEvent && (
        <CreateLinkFlow
          eventId={defaultEvent.id}
          eventName={defaultEvent.name}
          events={events}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}
