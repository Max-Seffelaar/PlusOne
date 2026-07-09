'use client';

/** Events tab + event detail, event CRUD, tier/alias beheer, past-event recap. */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import type { PoEvent } from '@/lib/po/types';
import {
  usePoCrew,
  usePoEvent,
  usePoEventDetail,
  usePoEventForEdit,
  usePoEvents,
  useBillingBlocked,
  usePoTiers,
  usePoRequestLinks,
} from '@/features/po/hooks';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { canWorkDoor } from '@/features/auth/roles';
import { formatClock } from '@/features/stats/format';
import { useNav } from '../context';
import { Icon } from '../icon';
import { Avatar, Btn, Empty, IconBtn, Label, Note, Scroll, Top, cardPress, press } from '../kit';
import { EventActivitySection } from './events/past';
import { col, ScreenState } from './events/shared';

export { EventEdit } from './events/edit';
export { Tiers } from './events/tiers';
export { Crew } from './events/crew';
export { PastEvent } from './events/past';

// ── helpers ───────────────────────────────────────────────────────────────────
function Stat({ v, l, acc, big }: { v: number; l: string; acc?: boolean; big?: boolean }): JSX.Element {
  return (
    <div className="rounded-[18px] border border-line bg-elev p-4">
      <div className={cn('font-display font-extrabold leading-none', big ? 'text-[38px]' : 'text-[28px]', acc ? 'text-acc' : 'text-text')}>{v}</div>
      <div className="mt-1 text-[13px] text-dim">{l}</div>
    </div>
  );
}

// ── EVENTS (tab) ──────────────────────────────────────────────────────────────
export function Events(): JSX.Element {
  const nav = useNav();
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const { data, isLoading, isError } = usePoEvents();
  // Creating events is admin-only (T7 regression check on PR #100): hide the
  // CTA for other roles instead of sending them into a read-only editor.
  const isAdmin = usePoIdentity().roles.includes('admin');
  // Soft-block (#32 refinement): hide the growth CTA; the note explains why.
  const billingLock = useBillingBlocked();
  const evs = (data ?? []).filter((e) => e.when === when);
  const months = [...new Set(evs.map((e) => e.month))];
  return (
    <div className={col}>
      <Top big title={t.events.title} onBack={nav.canGoBack ? nav.back : undefined} right={<IconBtn name="search" />} />
      <div className="flex flex-none items-center gap-2 px-5 pb-[14px]">
        {([['upcoming', t.events.tabUpcoming], ['past', t.events.tabPast]] as const).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setWhen(k)}
            className={cn(
              'cursor-pointer rounded-full border px-4 py-2 font-display text-[13.5px] font-bold transition-[filter] hover:brightness-[1.07]',
              when === k ? 'border-transparent bg-text text-bg' : 'border-line bg-transparent text-dim',
            )}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="flex flex-none gap-2 px-5 pb-[14px]">
        <Btn sm kind="primary" icon="plus" onClick={() => nav.push('quickadd')}>
          {t.events.addGuest}
        </Btn>
        {isAdmin && !billingLock.blocked && (
          <Btn sm kind="ghost" icon="cal" onClick={() => nav.push('eventedit', { isNew: true })}>
            {t.events.newEvent}
          </Btn>
        )}
      </div>
      {isAdmin && billingLock.blocked && (
        <div className="flex-none px-5">
          <Note icon="warn">
            {billingLock.reason === 'canceled'
              ? t.settings.billing.blockedCanceled
              : t.settings.billing.blockedTrial}{' '}
            <button
              type="button"
              className="cursor-pointer font-bold text-acc underline underline-offset-2"
              onClick={() => nav.push('billing')}
            >
              {t.settings.billing.blockedCta}
            </button>
          </Note>
        </div>
      )}
      <Scroll bottom={100}>
        {isLoading ? (
          <Empty text={t.events.loadingEvents} />
        ) : isError ? (
          <Empty text={t.events.loadEventsError} />
        ) : evs.length === 0 ? (
          <Empty text={when === 'upcoming' ? t.events.emptyUpcoming : t.events.emptyPast} />
        ) : (
          months.map((m) => (
            <div key={m} className="mb-2">
              <Label className="mx-0.5 mb-[10px] mt-3">{m}</Label>
              <div className="flex flex-col gap-[10px] lg:grid lg:grid-cols-2 xl:grid-cols-3">
                {evs
                  .filter((e) => e.month === m)
                  .map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => nav.push(e.when === 'past' ? 'pastevent' : 'event', { id: e.id })}
                      className={cn('flex items-center gap-[14px] rounded-[18px] border border-line bg-elev p-[14px] text-left', cardPress)}
                    >
                      <div className="w-[52px] shrink-0 text-center">
                        <div className={cn('font-display text-[24px] font-extrabold leading-none', e.accent ? 'text-acc' : 'text-text')}>{e.date}</div>
                        <div className="mt-0.5 text-[11px] font-bold tracking-[0.05em] text-faint">{e.mon}</div>
                      </div>
                      <div className="w-px self-stretch bg-line2" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[17px] font-bold text-text">{e.name}</div>
                          {e.cancelled ? (
                            <span className="shrink-0 rounded-full bg-[#E89AC0]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#E89AC0]">
                              {t.events.cancelledBadge}
                            </span>
                          ) : e.phase === 'live' ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-acc-dim px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-acc">
                              <span className="h-1.5 w-1.5 rounded-full bg-acc" />
                              {t.events.liveBadge}
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-[3px] flex items-center gap-1.5 text-[13px] text-faint">
                          <Icon name="clock" size={13} stroke="rgba(255,255,255,0.40)" />
                          {fmt(t.events.cardDoors, { time: e.time, venue: e.venue })}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-display text-[16px] font-bold text-text">{e.guests}</div>
                        <div className="text-[11px] text-faint">{when === 'past' ? (e.guests > 0 ? Math.round((e.inside / e.guests) * 100) : 0) + t.events.cardTurnoutSuffix : t.events.cardGuests}</div>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          ))
        )}
      </Scroll>
    </div>
  );
}

// ── EVENT detail (pushed) ───────────────────────────────────────────────────────
export function EventView({ id }: { id?: string }): JSX.Element {
  const nav = useNav();
  const { event, isLoading, isError, notFound } = usePoEvent(id ?? '');
  const { data: detail } = usePoEventDetail(id ?? '');
  const { roles } = usePoIdentity();
  const isAdmin = roles.includes('admin');
  // Door-only affordances: a non-door role (staff) can't work the door or read
  // check_ins (#17), so hide the Check-in button (its tab is gated too) and the
  // "Laatst binnen" list unless there's data they're allowed to see.
  const showDoor = canWorkDoor(roles);
  // External crew count for the admin-only crew row below; only admins can manage
  // it, so a non-admin passes an empty id and the hook stays disabled (no fetch).
  const crewQ = usePoCrew(isAdmin ? id ?? '' : '');
  // Request-links count for the admin-only links row (F1) — same disable pattern.
  const linksQ = usePoRequestLinks(isAdmin ? id ?? '' : '');
  // Setup nudge (T2, 1/7): a fresh event has no tiers, so lead the people who can
  // fix that (admin/organizer) to the setup instead of a wall of zeroed stats.
  const tiersQ = usePoTiers(id ?? '');
  const { canManage } = usePoEventForEdit(id ?? '');

  if (isLoading) return <ScreenState onBack={nav.back} title={t.events.detailTitle} text={t.events.loading} />;
  if (isError || notFound || !event) {
    return <ScreenState onBack={nav.back} title={t.events.detailTitle} text={t.events.eventUnavailable} />;
  }

  const ev = event;
  const onweg = Math.max(0, ev.guests - ev.inside);
  const pct = ev.guests > 0 ? ev.inside / ev.guests : 0;
  const recent = detail?.recent ?? [];
  const openRequests = detail?.openRequests ?? 0;
  const needsSetup = canManage && !ev.cancelled && tiersQ.data?.length === 0;
  // Desktop (S3.3): the headline numbers/actions go left, the "needs attention"
  // + "laatst binnen" feed go right. When there's no secondary content the left
  // column reads as a normal centered column instead of a wide thin strip.
  const hasSecondary = openRequests > 0 || showDoor || recent.length > 0;

  return (
    <div className={col}>
      {/* Feedback Joeri: the "dots" icon was unreadable — use a clear settings/edit cog. */}
      <Top onBack={nav.back} title={ev.name} sub={`${ev.venue} · ${ev.date} ${ev.mon}`} right={<IconBtn name="cog" onClick={() => nav.push('eventedit', { id: ev.id })} />} />
      <Scroll bottom={28}>
        {needsSetup && (
          <div className="mb-3 rounded-[18px] border bg-elev p-4" style={{ borderColor: 'rgba(181,166,255,0.4)' }}>
            <div className="flex gap-[11px]">
              <span className="mt-px shrink-0 text-acc">
                <Icon name="spark" size={19} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-[15.5px] font-bold text-text">{t.events.setup.title}</div>
                <p className="mt-1 text-[12.5px] leading-[1.45] text-faint">{t.events.setup.noTiers}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-[10px]">
              <Btn kind="primary" sm icon="ticket" onClick={() => nav.push('tiers', { id: ev.id })}>
                {t.events.setup.addTiers}
              </Btn>
              <Btn kind="ghost" sm icon="cog" onClick={() => nav.push('eventedit', { id: ev.id })}>
                {t.events.setup.settings}
              </Btn>
            </div>
          </div>
        )}
        <div className={cn(hasSecondary && 'lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start')}>
          <div className={cn(!hasSecondary && 'lg:mx-auto lg:max-w-[680px]')}>
            <div className="mb-3 grid grid-cols-2 gap-[10px]">
              <Stat big v={onweg} l={t.events.statOnTheWay} />
              <Stat big v={ev.inside} l={t.events.statInside} acc />
            </div>
            <div className="mb-3 rounded-[18px] border border-line bg-elev p-4">
              <div className="mb-[9px] flex justify-between">
                <Label>{t.events.turnout}</Label>
                <span className="font-display font-bold text-acc">{Math.round(pct * 100)}%</span>
              </div>
              <div className="h-[10px] overflow-hidden rounded-[6px] bg-elev2">
                <div className="h-full rounded-[6px] bg-acc" style={{ width: pct * 100 + '%' }} />
              </div>
              <div className="mt-[9px] text-[12.5px] text-faint">{fmt(t.events.peopleOnList, { n: ev.guests })}</div>
            </div>
            <div className="mb-4 flex gap-[10px] lg:mb-0">
              {showDoor && (
                <Btn kind="primary" full icon="user" onClick={() => nav.openDoor(ev.id)}>
                  {t.events.checkIn}
                </Btn>
              )}
              <Btn kind="dark" full icon="users" onClick={() => nav.push('lijst', { id: ev.id })}>
                {t.events.guestList}
              </Btn>
            </div>
            {/* External crew — admin-only quick entry straight from the event. */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => nav.push('crew', { id: ev.id })}
                className={cn('mt-3 flex w-full items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[13px] text-left lg:mt-4', cardPress)}
              >
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2 text-acc">
                  <Icon name="users" size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-body text-[15px] font-semibold text-text">{t.events.crew.rowTitle}</span>
                  <span className="mt-px block text-[12.5px] text-faint">
                    {(crewQ.data?.length ?? 0) === 0
                      ? t.events.crew.rowEmpty
                      : fmt(crewQ.data?.length === 1 ? t.events.crew.rowCountOne : t.events.crew.rowCountMany, {
                          n: crewQ.data?.length ?? 0,
                        })}
                  </span>
                </span>
                <Icon name="chev" size={18} className="text-ghost" />
              </button>
            )}
            {/* Request links (F1) — admin-only quick entry, mirrors the crew row. */}
            {isAdmin && (
              <button
                type="button"
                onClick={() => nav.push('links', { id: ev.id })}
                className={cn('mt-3 flex w-full items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[13px] text-left', cardPress)}
              >
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] border border-line bg-elev2 text-acc">
                  <Icon name="link" size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-body text-[15px] font-semibold text-text">{t.events.linksRowTitle}</span>
                  <span className="mt-px block text-[12.5px] text-faint">
                    {(() => {
                      const n = (linksQ.data ?? []).filter((l) => l.active).length;
                      return fmt(n === 1 ? t.events.linksRowSubOne : t.events.linksRowSubMany, { n });
                    })()}
                  </span>
                </span>
                <Icon name="chev" size={18} className="text-ghost" />
              </button>
            )}
          </div>
          {hasSecondary && (
            <div className="mt-4 lg:mt-0">
              {openRequests > 0 && (
                <>
                  <Label className="mb-[10px]">{t.events.needsAttention}</Label>
                  <div className="mb-[18px] flex flex-col gap-[9px]">
                    <button
                      type="button"
                      onClick={() => nav.push('aanvragen', { id: ev.id })}
                      className={cn('flex w-full gap-[12px] rounded-[14px] border bg-elev p-[13px] text-left', cardPress)}
                      style={{ borderColor: 'rgba(181,166,255,0.4)' }}
                    >
                      <span className="mt-px text-acc-soft">
                        <Icon name="bell" size={19} />
                      </span>
                      <div className="flex-1">
                        <div className="font-body text-[14px] font-bold text-text">
                          {openRequests === 1
                            ? fmt(t.events.openRequest, { n: openRequests })
                            : fmt(t.events.openRequests, { n: openRequests })}
                        </div>
                        <div className="mt-0.5 text-[12.5px] leading-[1.4] text-faint">{t.events.requestsSub}</div>
                      </div>
                      <span className="self-center text-acc">
                        <Icon name="chev" size={20} />
                      </span>
                    </button>
                  </div>
                </>
              )}
              {(showDoor || recent.length > 0) && (
                <>
                  <Label className="mb-[10px]">{t.events.justIn}</Label>
                  {recent.length === 0 ? (
                    <Empty text={t.events.noOneInside} />
                  ) : (
                    <div className="flex flex-col">
                      {recent.map((g) => (
                        <div key={g.guestId} className="flex items-center gap-[12px] border-b border-line2 py-[10px]">
                          <Avatar name={g.name} size={38} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14.5px] font-semibold text-text">
                              {g.name}
                              {g.plus > 0 && <span className="text-faint"> +{g.plus}</span>}
                            </div>
                            <div className="mt-0.5 truncate text-[12px] text-faint">{fmt(t.events.by, { by: g.by })}</div>
                          </div>
                          <span className="font-display text-[13px] font-bold text-acc">{formatClock(g.at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {id && <EventActivitySection eventId={id} isLive />}
      </Scroll>
    </div>
  );
}

// ── EVENTS & TIERS hub (pushed) ──────────────────────────────────────────────────
export function EventBeheer(): JSX.Element {
  const nav = useNav();
  const { data, isLoading, isError } = usePoEvents();
  // Same gate as the Events tab: create-event is admin-only + billing-blocked.
  const isAdmin = usePoIdentity().roles.includes('admin');
  const billingLock = useBillingBlocked();
  const upcoming = (data ?? []).filter((e) => e.when === 'upcoming');
  const past = (data ?? []).filter((e) => e.when === 'past');
  const evRow = (e: PoEvent, dim: boolean): JSX.Element => (
    <button
      key={e.id}
      type="button"
      onClick={() => nav.push(dim ? 'pastevent' : 'eventedit', { id: e.id })}
      className={cn('flex w-full items-center gap-[13px] rounded-[16px] border border-line bg-elev p-[13px] text-left', cardPress, dim && 'opacity-[0.72]')}
    >
      <span className="w-[44px] shrink-0 text-center">
        <span className={cn('block font-display text-[20px] font-extrabold leading-none', e.accent ? 'text-acc' : 'text-text')}>{e.date}</span>
        <span className="mt-0.5 block text-[9.5px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
      </span>
      <span className="w-px self-stretch bg-line2" />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[15.5px] font-bold text-text">{e.name}</span>
        <span className="mt-px block text-[12.5px] text-faint">
          {fmt(t.events.hubCardSub, { venue: e.venue, n: e.guests })}
        </span>
      </span>
      <Icon name="chev" size={18} className="text-ghost" />
    </button>
  );
  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.events.hubTitle} sub={t.events.hubSub} />
      <Scroll bottom={24}>
        {isAdmin && !billingLock.blocked && (
          <button type="button" onClick={() => nav.push('eventedit', { isNew: true })} className={cn('mb-5 flex w-full items-center gap-[13px] rounded-[16px] bg-acc p-4 text-left', press)}>
            <span className="flex h-[40px] w-[40px] items-center justify-center rounded-[12px] bg-on-acc/[0.14] text-on-acc">
              <Icon name="plus" size={22} sw={2.4} />
            </span>
            <span className="flex-1">
              <span className="block font-display text-[16px] font-extrabold text-on-acc">{t.events.hubNewEvent}</span>
              <span className="mt-px block text-[12.5px] text-on-acc/70">{t.events.hubNewEventSub}</span>
            </span>
            <span className="text-on-acc">
              <Icon name="arrowR" size={20} />
            </span>
          </button>
        )}
        {isLoading ? (
          <Empty text={t.events.loadingEvents} />
        ) : isError ? (
          <Empty text={t.events.loadEventsError} />
        ) : (
          <>
            <Label className="mb-[10px]">{fmt(t.events.upcomingCount, { n: upcoming.length })}</Label>
            {upcoming.length === 0 ? (
              <div className="mb-5">
                <Empty text={t.events.emptyUpcoming} />
              </div>
            ) : (
              <div className="mb-5 flex flex-col gap-[9px] lg:grid lg:grid-cols-2 lg:gap-[10px]">{upcoming.map((e) => evRow(e, false))}</div>
            )}
            <Label className="mb-[10px]">{t.events.past}</Label>
            {past.length === 0 ? (
              <Empty text={t.events.emptyPast} />
            ) : (
              <div className="flex flex-col gap-[9px] lg:grid lg:grid-cols-2 lg:gap-[10px]">{past.map((e) => evRow(e, true))}</div>
            )}
          </>
        )}
      </Scroll>
    </div>
  );
}
