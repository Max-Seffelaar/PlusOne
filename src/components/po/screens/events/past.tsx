'use client';

/** Past-event recap + shared event-activity/audit section — split from events.tsx (FE-5). */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { usePoEvent, usePoEventRecap } from '@/features/po/hooks';
import { venueCapabilities } from '@/features/venues/access';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Avatar, Btn, Empty, IconBtn, Label, Scroll, Top, press } from '../../kit';
import { TierPill } from '../guests/_shared';
import { col, ScreenState } from './shared';
import { EventStatsPanel } from './stats-panel';

// ── PAST EVENT recap (pushed) ────────────────────────────────────────────────────
const RECAP_CAP = 8;

export function PastEvent({ id }: { id?: string }): JSX.Element {
  const nav = useNav();
  const { event, isLoading: evLoading, isError: evError, notFound } = usePoEvent(id ?? '');
  const { data: r, isLoading: rLoading, isError: rError } = usePoEventRecap(id ?? '');
  const [showAllIn, setShowAllIn] = useState(false);
  const [showAllNo, setShowAllNo] = useState(false);

  if (evLoading || rLoading) return <ScreenState onBack={nav.back} title={t.events.recapTitle} text={t.events.loading} />;
  if (evError || rError || notFound || !event || !r) {
    return <ScreenState onBack={nav.back} title={t.events.recapTitle} text={t.events.recapUnavailable} />;
  }

  const ev = event;
  const pct = r.listed > 0 ? Math.round((r.arrived / r.listed) * 100) : 0;
  const maxT = Math.max(1, ...r.perTier.map((x) => x.aangemeld));
  const inList = showAllIn ? r.checkedIn : r.checkedIn.slice(0, RECAP_CAP);
  const noList = showAllNo ? r.noShows : r.noShows.slice(0, RECAP_CAP);

  return (
    <div className={col}>
      <Top onBack={nav.back} title={ev.name} sub={`${ev.venue} · ${ev.date} ${ev.mon}`} right={<IconBtn name="share" />} />
      <Scroll bottom={28}>
        {/* Desktop (S3.3): two columns — left = opkomst + ingecheckt, right =
            no-shows + per-tier + acties. Stacks to one column below lg. */}
        <div className="lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start">
        <div>
        <div className="mb-[14px] rounded-[18px] bg-acc-dim p-[18px]">
          <Label className="mb-[10px] text-acc-soft">{t.events.recapHeading}</Label>
          <div className="flex items-end gap-[10px]">
            <div className="font-display text-[54px] font-extrabold leading-[0.9] text-text">{pct}%</div>
            <div className="pb-1.5">
              <div className="text-[14px] font-semibold text-text">{t.events.turnoutWord}</div>
              <div className="text-[12.5px] text-dim">
                {fmt(t.events.peopleOf, { arrived: r.arrived, listed: r.listed })}
              </div>
            </div>
          </div>
          <div className="mt-[14px] h-[8px] overflow-hidden rounded-[5px] bg-white/[0.12]">
            <div className="h-full rounded-[5px] bg-acc" style={{ width: pct + '%' }} />
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-[10px]">
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[30px] font-extrabold leading-none text-acc">{r.arrived}</div>
            <div className="mt-1 text-[12.5px] text-dim">{t.events.checkedIn}</div>
          </div>
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[30px] font-extrabold leading-none text-text">{r.noShow}</div>
            <div className="mt-1 text-[12.5px] text-faint">{t.events.noShows}</div>
          </div>
        </div>

        <Label className="mb-[10px]">{fmt(t.events.checkedInLabel, { n: r.checkedIn.length })}</Label>
        {r.checkedIn.length === 0 ? (
          <div className="mb-4">
            <Empty text={t.events.noOneCheckedIn} />
          </div>
        ) : (
          <div className="mb-4 rounded-[18px] border border-line bg-elev px-[14px] py-0.5">
            {inList.map((g, i) => (
              <div key={`${g.name}-${i}`} className={cn('flex items-center gap-[12px] py-[11px]', i < inList.length - 1 && 'border-b border-line2')}>
                <Avatar name={g.name} size={36} accent={g.role === 'VIP'} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[14.5px] font-bold text-text">
                    {g.name}
                    {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
                  </div>
                  <div className="mt-1">
                    <TierPill name={g.tierName} color={g.tierColor} fallback={g.role} />
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 font-display text-[13px] font-bold text-acc">
                  <Icon name="check2" size={14} stroke="#B5A6FF" sw={2.4} />
                  {g.at ?? '—'}
                </span>
              </div>
            ))}
            {!showAllIn && r.checkedIn.length > RECAP_CAP && (
              <button
                type="button"
                onClick={() => setShowAllIn(true)}
                className="w-full border-t border-line2 py-3 font-body text-[13.5px] font-bold text-dim transition-[filter] hover:brightness-[1.2]"
              >
                {fmt(t.events.showAllCheckedIn, { n: r.checkedIn.length })}
              </button>
            )}
          </div>
        )}

        </div>
        <div className="mt-4 lg:mt-0">
        <Label className="mb-[10px]">{fmt(t.events.noShowsLabel, { n: r.noShows.length })}</Label>
        {r.noShows.length === 0 ? (
          <div className="mb-[18px]">
            <Empty text={t.events.everyoneShowed} />
          </div>
        ) : (
          <div className="mb-[18px] rounded-[18px] border border-line bg-elev px-[14px] py-0.5">
            {noList.map((g, i) => (
              <div key={`${g.name}-${i}`} className={cn('flex items-center gap-[12px] py-[11px] opacity-[0.72]', i < noList.length - 1 && 'border-b border-line2')}>
                <Avatar name={g.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[14.5px] font-bold text-dim">
                    {g.name}
                    {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
                  </div>
                  {g.by && <div className="mt-[3px] text-[12px] text-faint">{fmt(t.events.addedBy, { by: g.by })}</div>}
                </div>
                <span className="text-[12px] font-bold text-faint">{t.events.noShowTag}</span>
              </div>
            ))}
            {!showAllNo && r.noShows.length > RECAP_CAP && (
              <button
                type="button"
                onClick={() => setShowAllNo(true)}
                className="w-full border-t border-line2 py-3 font-body text-[13.5px] font-bold text-dim transition-[filter] hover:brightness-[1.2]"
              >
                {fmt(t.events.showAllNoShows, { n: r.noShows.length })}
              </button>
            )}
          </div>
        )}

        <Label className="mb-[10px]">{t.events.byTier}</Label>
        <div className="mb-[14px] rounded-[18px] border border-line bg-elev p-4">
          {r.perTier.length === 0 ? (
            <div className="py-[14px] text-center text-[13px] text-faint">{t.events.noTierData}</div>
          ) : (
            r.perTier.map((row, i) => (
              <div key={row.tier} className={i < r.perTier.length - 1 ? 'mb-[13px]' : ''}>
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
        <div className="mb-4 grid grid-cols-2 gap-[10px]">
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[24px] font-extrabold text-text">{r.refused}</div>
            <div className="mt-[3px] text-[12px] text-faint">{t.events.refused}</div>
          </div>
          <div className="rounded-[18px] border border-line bg-elev px-4 py-[14px]">
            <div className="font-display text-[24px] font-extrabold text-text">{r.peak}</div>
            <div className="mt-[3px] text-[12px] text-faint">{t.events.peak}</div>
          </div>
        </div>
        <div className="flex gap-[10px]">
          <Btn kind="dark" full icon="users" onClick={() => nav.push('lijst', { id: ev.id })}>
            {t.events.recapGuestList}
          </Btn>
          <Btn kind="quiet" full icon="dl">
            {t.events.exportLabel}
          </Btn>
        </div>
        </div>
        </div>
        {id && <EventActivitySection eventId={id} />}
      </Scroll>
    </div>
  );
}

// ── EVENT ACTIVITY SECTION (admin/finance only, 86ey21vnd; M6 86ey7dzmp) ─────────
// The per-event stats live here (event-home) via the shared EventStatsPanel — the
// same component Analytics renders after picking an event, so the two surfaces
// never drift apart (K-10-les). The audit log itself no longer renders inline
// (EventView was "too busy" per the 8/7 UX/IA decision) — "View activity" jumps to
// the dedicated Audit screen, pre-filtered to this event.

export function EventActivitySection({
  eventId,
  isLive,
}: {
  eventId: string;
  isLive?: boolean;
}): JSX.Element | null {
  const nav = useNav();
  const { roles } = usePoIdentity();
  const canAudit = venueCapabilities(roles).viewAudit;

  if (!canAudit) return null;

  return (
    <div className="mt-6 border-t border-line pt-5">
      <Label className="mb-4">{t.events.activityHeading}</Label>
      <EventStatsPanel eventId={eventId} isLive={isLive} />
      <button
        type="button"
        onClick={() => nav.push('audit', { id: eventId })}
        className={cn(
          'mt-5 flex w-full items-center justify-center gap-[8px] rounded-[14px] border border-line bg-elev py-[13px] font-display text-[13.5px] font-bold text-acc',
          press
        )}
      >
        {t.events.viewActivity}
        <Icon name="chev" size={16} />
      </button>
    </div>
  );
}
