'use client';

/**
 * S13 · Desktop Event-dag cockpit — the live "command" screen for the night that
 * is happening. Recreated from the Claude Design handoff (the `EventDay` view) and
 * wired to live Supabase data via the shared po layer: reads through React Query
 * (browser client), check-in/out through the door's check_ins gateway (no offline
 * outbox — desktop is online), lock/approvals through the existing server actions.
 * RLS is the boundary; affordances hide for roles without the right (see below).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Icon, type IconName } from '@/components/po/icon';
import { Avatar, Label } from '@/components/po/kit';
import { DBtn, DCard } from '@/components/po/desktop/kit';
import { canWorkDoor } from '@/features/auth/roles';
import { useNav } from '@/components/po/context';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import type { PoDoorEvent } from '@/features/po/door-event';
import type { Guest, Tier } from '@/lib/po/types';
import {
  usePoCheckinArrivals,
  usePoDoorCandidates,
  usePoEventForEdit,
  usePoEventRealtime,
  usePoEventStats,
  usePoGuestRequests,
  usePoGuests,
  usePoQuotaRequests,
  usePoTiers,
} from '@/features/po/hooks';
import { DoorEventPicker } from '@/components/po/screens/door';
import {
  usePoApproveRequest,
  usePoCheckIn,
  usePoCheckOut,
  usePoDecideQuota,
  usePoDenyRequest,
  usePoSetListLock,
  usePoTopUpCheckIn,
} from '@/features/po/mutations';
import {
  amsterdamHM,
  amsterdamHMS,
  cockpitCounts,
  cockpitTiles,
  currentBucketIndex,
  feedIsAccent,
  filterCockpit,
  insideHeads,
  liveFeedLabel,
  matchFirstWaiting,
  partyState,
  perTierLive,
  type FeedEntry,
  type StatusFilter,
} from './cockpit';

const press = 'transition-[filter,transform,background,border-color,color] hover:brightness-[1.08] active:scale-[0.985]';
const DENY_REASON = t.cockpit.denyReason;
const EMPTY_ARRIVALS: ReadonlyMap<string, { arrived: number; at: string }> = new Map();
// Stable fallbacks so the memoized computations don't recompute every render
// when the query has no data yet (keeps the virtualized list cheap).
const EMPTY_GUESTS: Guest[] = [];
const EMPTY_TIERS: Tier[] = [];

// ── Entry gate: pick the event (no auto-guess with >1 live), then mount cockpit ──
// The chosen event is CONTROLLED by the /app shell (doorEventId), so the desktop
// cockpit and the mobile door tab share one choice — "Check-in" from an event card
// (nav.openDoor) lands the cockpit on that event too (T9 fold, S1.3).
export function EventDayCockpitGate({
  chosenId,
  onChoose,
}: {
  chosenId: string | null;
  onChoose: (id: string | null) => void;
}): JSX.Element {
  const { data: candidates = [], isLoading } = usePoDoorCandidates();
  // Selection-first (S1.3): a deliberate pick wins; with exactly one event use it;
  // with several, the user chooses which event-dag to drive — no auto-guess.
  const resolvedId = chosenId ?? (candidates.length === 1 ? candidates[0].id : null);
  const event = candidates.find((e) => e.id === resolvedId) ?? null;

  if (isLoading) {
    return (
      <div className="flex flex-col gap-[18px]">
        <div className="h-[176px] animate-pulse rounded-[20px] border border-line bg-elev" />
        <div className="grid grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[112px] animate-pulse rounded-[20px] border border-line bg-elev" />
          ))}
        </div>
      </div>
    );
  }

  if (event) {
    return (
      <EventDayCockpit
        event={event}
        onChangeEvent={candidates.length > 1 ? () => onChoose(null) : undefined}
      />
    );
  }

  if (candidates.length > 1) {
    // No DCard wrapper: the picker renders the shared Home event cards (their own
    // card chrome) — nesting them inside another card doubles the borders.
    return (
      <DoorEventPicker
        events={candidates}
        onPick={onChoose}
        title={t.cockpit.pickEventTitle}
        sub={t.cockpit.pickEventSub}
      />
    );
  }

  return (
    <DCard className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-line bg-elev2 text-faint">
        <Icon name="door" size={22} />
      </span>
      <div className="font-display text-[18px] font-bold text-text">{t.cockpit.noLiveEventTitle}</div>
      <div className="max-w-sm text-[13.5px] text-faint">
        {t.cockpit.noLiveEventSub}
      </div>
    </DCard>
  );
}

// ── The cockpit ───────────────────────────────────────────────────────────────
function EventDayCockpit({ event, onChangeEvent }: { event: PoDoorEvent; onChangeEvent?: () => void }): JSX.Element {
  const eventId = event.id;
  const nav = useNav(); // in-shell since the T9 fold — pushes QuickAdd over the Door tab
  const { roles } = usePoIdentity();

  const edit = usePoEventForEdit(eventId);
  const editRow = edit.data;
  const canManage = edit.canManage; // admin (venue) or organizer (this event)
  const canCheckIn = canWorkDoor(roles) || canManage; // admin/doorhost + organizer; RLS still decides
  const canSeeStats = canManage || roles.includes('finance');

  const guests = usePoGuests(eventId).data ?? EMPTY_GUESTS;
  const tiers = usePoTiers(eventId).data ?? EMPTY_TIERS;
  const stats = usePoEventStats(eventId).data;
  const arrivals = usePoCheckinArrivals(eventId).data ?? EMPTY_ARRIVALS;
  const { realtimeConnected } = usePoEventRealtime(eventId);
  const guestRequests = usePoGuestRequests().data ?? [];
  const quotaRequests = usePoQuotaRequests().data ?? [];

  const checkIn = usePoCheckIn(eventId);
  const checkOut = usePoCheckOut(eventId);
  const topUp = usePoTopUpCheckIn(eventId);
  const setLock = usePoSetListLock(eventId);
  const approve = usePoApproveRequest();
  const deny = usePoDenyRequest();
  const decideQuota = usePoDecideQuota();

  const [q, setQ] = useState('');
  const [statF, setStatF] = useState<StatusFilter>('all');
  const [tierF, setTierF] = useState('all');
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; tone: 'in' | 'out' } | null>(null);
  // Quantified in-/uitcheck modal (S1.2). `value` is the stepper position in koppen:
  // checkin = arriving now, topup = how many more, checkout = how many leave.
  const [modal, setModal] = useState<{ kind: 'checkin' | 'topup' | 'checkout'; guest: Guest; value: number } | null>(null);

  // Debounce only the value that drives the expensive filter; the input + the
  // Enter-to-checkin handler keep the live `q` so typing stays instant (#1b).
  const dq = useDebouncedValue(q, 140);
  const tiles = useMemo(() => cockpitTiles(guests, arrivals), [guests, arrivals]);
  const counts = useMemo(() => cockpitCounts(guests), [guests]);
  const tierRows = useMemo(() => perTierLive(guests, tiers, arrivals), [guests, tiers, arrivals]);
  const filtered = useMemo(() => filterCockpit(guests, statF, tierF, dq), [guests, statF, tierF, dq]);
  // Stable identities so the memo'd CockpitGuestList skips renders while typing.
  const tierDisplay = useMemo(
    () => new Map(tiers.map((t) => [t.role, { color: t.color, short: t.short }])),
    [tiers]
  );
  const defaultTierId = useMemo(
    () => tiers.find((t) => t.isDefault)?.id ?? tiers[0]?.id ?? null,
    [tiers]
  );
  const listLocked = editRow?.listLocked ?? false;
  // Effective "uitchecken toestaan" for this event (#3 / S1.1). When false the ✗
  // affordance is disabled here; the RESTRICTIVE check_ins policy rejects it too.
  const allowUncheck = editRow?.allowUncheck ?? true;

  const evGuestReqs = guestRequests.filter((r) => r.eventId === eventId && r.status === 'pending');
  const evQuotaReqs = quotaRequests.filter((r) => r.eventId === eventId);
  const openReqs = evGuestReqs.length + evQuotaReqs.length;

  const notify = useCallback((msg: string, tone: 'in' | 'out' = 'out'): void => {
    const entry = { msg, tone };
    setToast(entry);
    window.setTimeout(() => setToast((v) => (v === entry ? null : v)), 3200);
  }, []);
  const pushFeed = useCallback((e: FeedEntry): void => {
    setFeed((f) => [e, ...f].slice(0, 6));
  }, []);
  const flash = useCallback((id: string): void => {
    setFlashId(id);
    window.setTimeout(() => setFlashId((v) => (v === id ? null : v)), 900);
  }, []);

  const checkInMutate = checkIn.mutate; // stable across renders (React Query guarantee)
  const doCheckIn = useCallback((g: Guest, arrived: number): void => {
    if (!canCheckIn) return;
    checkInMutate({ guestId: g.id, plusOnes: arrived }, { onError: (e) => notify(e.message) });
    pushFeed({ kind: 'in', t: amsterdamHM(new Date()), name: g.name, plus: arrived });
    flash(g.id);
    notify(fmt(t.cockpit.toastCheckedIn, { name: g.name, plus: arrived > 0 ? ` +${arrived}` : '', inside: 1 + arrived }), 'in');
  }, [canCheckIn, checkInMutate, notify, pushFeed, flash]);
  // ✓ click: a +0 guest checks in at once; a +N guest opens the quantified modal to
  // pick how many of the party arrive now, or to top up an already-in party (S1.2).
  const onCheckInClick = useCallback((g: Guest): void => {
    if (!canCheckIn) return;
    const ps = partyState(g, arrivals);
    if (g.status !== 'in') {
      if (g.plus === 0) {
        doCheckIn(g, 0);
        return;
      }
      setModal({ kind: 'checkin', guest: g, value: ps.totalHeads }); // default: whole party
      return;
    }
    if (ps.remaining <= 0) {
      notify(fmt(t.cockpit.toastFullyInside, { name: g.name }), 'in');
      return;
    }
    setModal({ kind: 'topup', guest: g, value: ps.remaining }); // default: the rest
  }, [canCheckIn, arrivals, doCheckIn, notify]);
  // ✗ click: open the quantified check-out modal (symmetric). Disabled when the
  // event does not allow uitchecken (#3 / S1.1) — the button is locked, RLS too.
  const onVoidClick = useCallback((g: Guest): void => {
    if (!canCheckIn || !allowUncheck) return;
    const inside = insideHeads(g, arrivals);
    if (inside <= 0) return; // already onderweg
    setModal({ kind: 'checkout', guest: g, value: inside }); // default: the whole party
  }, [canCheckIn, allowUncheck, arrivals]);
  function confirmModal(): void {
    if (!modal) return;
    const { kind, guest, value } = modal;
    if (kind === 'checkin') {
      const arrived = Math.max(0, value - 1);
      checkIn.mutate({ guestId: guest.id, plusOnes: arrived }, { onError: (e) => notify(e.message) });
      pushFeed({ kind: 'in', t: amsterdamHM(new Date()), name: guest.name, plus: arrived });
      notify(fmt(t.cockpit.toastCheckedIn, { name: guest.name, plus: arrived > 0 ? ` +${arrived}` : '', inside: value }), 'in');
    } else if (kind === 'topup') {
      const inside = insideHeads(guest, arrivals);
      const newArrived = Math.min(guest.plus, inside - 1 + value);
      topUp.mutate({ guestId: guest.id, plusOnes: newArrived }, { onError: (e) => notify(e.message) });
      pushFeed({ kind: 'in', t: amsterdamHM(new Date()), name: guest.name, plus: value });
      notify(fmt(t.cockpit.toastTopup, { name: guest.name, inside: newArrived + 1 }), 'in');
    } else {
      const inside = insideHeads(guest, arrivals);
      const leaving = Math.min(inside, Math.max(1, value));
      const remainingHeads = inside - leaving;
      checkOut.mutate({ guestId: guest.id, remainingHeads }, { onError: (e) => notify(e.message) });
      pushFeed({ kind: 'out', t: amsterdamHM(new Date()), name: guest.name, plus: Math.max(0, leaving - 1) });
      notify(
        remainingHeads === 0
          ? fmt(t.cockpit.toastCheckedOut, { name: guest.name })
          : fmt(t.cockpit.toastPartialCheckout, { name: guest.name, leaving, remaining: remainingHeads }),
        'out'
      );
    }
    flash(guest.id);
    setModal(null);
  }
  function onSearchKey(e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key !== 'Enter' || !canCheckIn) return;
    const hit = matchFirstWaiting(guests, q);
    if (hit) {
      doCheckIn(hit, hit.plus);
      setQ('');
    }
  }
  function toggleLock(): void {
    if (!canManage || !editRow) return;
    setLock.mutate({ eventId, locked: !listLocked }, { onError: (e) => notify(e.message) });
  }
  function approveLanding(r: { id: string; name: string; plus: number }): void {
    if (!defaultTierId) return;
    approve.mutate(
      { requestId: r.id, tierId: defaultTierId, eventId },
      { onError: (e) => notify(e.message) }
    );
    pushFeed({ kind: 'msg', t: amsterdamHM(new Date()), msg: fmt(t.cockpit.feedApproved, { name: r.name, plus: r.plus ? ` +${r.plus}` : '' }), accent: true });
  }
  function denyLanding(r: { id: string; name: string }): void {
    deny.mutate({ requestId: r.id, reason: DENY_REASON, eventId }, { onError: (e) => notify(e.message) });
    pushFeed({ kind: 'msg', t: amsterdamHM(new Date()), msg: fmt(t.cockpit.feedDeclined, { name: r.name }), accent: false });
  }
  function approveQuota(r: { id: string; who: string; extra: number }): void {
    decideQuota.mutate(
      { requestId: r.id, decision: 'approved', eventId },
      { onError: (e) => notify(e.message) }
    );
    pushFeed({ kind: 'msg', t: amsterdamHM(new Date()), msg: fmt(t.cockpit.feedQuotaGranted, { who: r.who, n: r.extra }), accent: true });
  }
  function denyQuota(r: { id: string; who: string }): void {
    decideQuota.mutate(
      { requestId: r.id, decision: 'denied', reason: DENY_REASON, eventId },
      { onError: (e) => notify(e.message) }
    );
    pushFeed({ kind: 'msg', t: amsterdamHM(new Date()), msg: fmt(t.cockpit.feedQuotaDenied, { who: r.who }), accent: false });
  }

  const doorTime = editRow?.startsAt ? amsterdamHM(new Date(editRow.startsAt)) : null;

  return (
    <div className="flex flex-col gap-[18px]">
      {/* page header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-text">{t.cockpit.pageTitle}</h1>
          <div className="truncate text-[13px] text-faint">{fmt(t.cockpit.pageSub, { name: event.name })}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onChangeEvent && (
            <DBtn kind="ghost" icon="cal" onClick={onChangeEvent}>
              {t.cockpit.switchEvent}
            </DBtn>
          )}
          {canCheckIn && (
            <DBtn icon="plus" onClick={() => nav.push('quickadd', { id: eventId })}>
              {t.events.addGuest}
            </DBtn>
          )}
        </div>
      </div>

      {/* LIVE strip */}
      <div
        className="rounded-[20px] border border-line p-[22px]"
        style={{ background: 'radial-gradient(120% 160% at 0% 0%, rgba(181,166,255,0.13), #161618 58%)' }}
      >
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-[7px] rounded-full bg-acc-dim px-3 py-1.5 font-body text-[12px] font-extrabold tracking-[0.04em] text-acc">
            <span className={cn('h-[7px] w-[7px] rounded-full bg-acc', realtimeConnected && 'animate-pulse')} />
            {t.cockpit.liveBadge}
          </span>
          <div className="min-w-0">
            <div className="truncate font-display text-[23px] font-extrabold tracking-[-0.02em] text-text">{event.name}</div>
            <div className="text-[13px] text-faint">
              {event.venueName}
              {doorTime ? ` · ${fmt(t.cockpit.doorTime, { time: doorTime })}` : ''}
            </div>
          </div>
          <div className="flex-1" />
          <LiveClock />
          <button
            type="button"
            onClick={toggleLock}
            disabled={!canManage || setLock.isPending}
            title={canManage ? t.cockpit.lockTitleManage : t.cockpit.lockTitleNoRights}
            className={cn(
              'inline-flex items-center gap-2 whitespace-nowrap rounded-[12px] border px-[15px] py-[11px] font-display text-[14px] font-bold',
              canManage && press,
              !canManage && 'cursor-default',
              listLocked ? 'border-transparent bg-acc-dim text-acc' : 'border-line text-dim'
            )}
          >
            <Icon name={listLocked ? 'lock' : 'history'} size={16} sw={2.1} />
            {listLocked ? t.cockpit.listLocked : t.cockpit.listOpen}
          </button>
        </div>

        <div className="mb-[9px] mt-5 flex items-baseline justify-between">
          <Label>{t.cockpit.turnoutNow}</Label>
          <span className="font-display text-[15px] font-bold">
            <span className="text-acc">{tiles.binnenH}</span>{' '}
            <span className="text-faint">
              / {fmt(t.cockpit.turnoutTail, { total: tiles.aangemeldH, pct: Math.round(tiles.pct * 100) })}
            </span>
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-[7px] bg-elev2">
          <div
            className="h-full rounded-[7px] bg-acc transition-[width] duration-500 ease-out"
            style={{ width: `${tiles.pct * 100}%` }}
          />
        </div>
        <div className="mt-3 flex items-center gap-[7px] text-[12.5px] text-faint">
          <Icon name="shield" size={13} className="text-faint" />
          {listLocked ? t.cockpit.lockedHint : t.cockpit.openHint}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-4 gap-4">
        <Tile v={tiles.binnenH} l={t.cockpit.tileInside} s={fmt(t.cockpit.tileInsideSub, { total: tiles.aangemeldH })} accent />
        <Tile v={tiles.onderwegH} l={t.cockpit.tileOnTheWay} s={t.cockpit.tileOnTheWaySub} />
        <Tile v={`${Math.round(tiles.pct * 100)}%`} l={t.cockpit.tilePresence} s={t.cockpit.tilePresenceSub} />
        <Tile
          v={canSeeStats ? stats?.peak ?? '—' : '—'}
          l={t.cockpit.tilePeak}
          s={canSeeStats && stats?.peak ? fmt(t.cockpit.tilePeakSub, { n: stats.peakCount }) : t.cockpit.tilePeakNone}
        />
      </div>

      {/* main grid */}
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] items-start gap-4">
        {/* cockpit list */}
        <DCard className="overflow-hidden p-0">
          <div className="flex flex-col gap-[13px] border-b border-line2 p-[18px]">
            <div className="flex flex-wrap items-center gap-[10px]">
              <div className="inline-flex min-w-[240px] flex-1 items-center gap-[9px] rounded-[12px] border border-line bg-bg px-[14px] py-[11px]">
                <Icon name="search" size={17} className="text-faint" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder={canCheckIn ? t.cockpit.searchCheckIn : t.cockpit.searchPlaceholder}
                  className="min-w-0 flex-1 border-none bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
                />
                {q && (
                  <button type="button" onClick={() => setQ('')} className="flex text-faint" aria-label={t.cockpit.clearAria}>
                    <Icon name="close" size={15} />
                  </button>
                )}
              </div>
              <div className="inline-flex gap-[3px] rounded-[12px] border border-line bg-bg p-[3px]">
                {(
                  [
                    ['all', t.cockpit.filterAll, counts.all],
                    ['wait', t.cockpit.filterOnTheWay, counts.wait],
                    ['in', t.cockpit.filterInside, counts.in],
                  ] as const
                ).map(([k, l, n]) => {
                  const on = statF === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setStatF(k)}
                      className={cn(
                        'inline-flex items-center gap-[7px] rounded-[9px] px-[13px] py-2 font-display text-[13.5px] font-bold',
                        press,
                        on ? 'bg-elev2 text-text' : 'text-faint'
                      )}
                    >
                      {l}
                      <span className={cn('tabular-nums text-[11.5px]', on ? 'text-dim' : 'text-ghost')}>{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap gap-[7px]">
              <TierChip on={tierF === 'all'} onClick={() => setTierF('all')}>
                {t.cockpit.allTiers}
              </TierChip>
              {tierRows.map((t) => (
                <TierChip key={t.role} on={tierF === t.role} onClick={() => setTierF(t.role)}>
                  <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
                  {t.tier}
                </TierChip>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_120px_150px_96px] border-b border-line2 bg-bg px-[18px] py-[11px]">
            {[t.cockpit.colGuest, t.cockpit.colTier, t.cockpit.colStatus, t.cockpit.colInOut].map((h, i) => (
              <Label key={h} className={i === 3 ? 'text-right' : undefined}>
                {h}
              </Label>
            ))}
          </div>

          <CockpitGuestList
            rows={filtered}
            totalGuests={guests.length}
            arrivals={arrivals}
            tierDisplay={tierDisplay}
            flashId={flashId}
            canCheckIn={canCheckIn}
            allowUncheck={allowUncheck}
            onCheckInClick={onCheckInClick}
            onVoid={onVoidClick}
          />

          <div className="flex min-h-[44px] items-center gap-[10px] border-t border-line px-[18px] py-[11px]">
            {feed.length > 0 ? (
              <>
                <span
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ background: feedIsAccent(feed[0]) ? '#B5A6FF' : 'rgba(255,255,255,0.26)' }}
                />
                <span className="text-[13px] text-dim">
                  <span className="font-display font-bold text-text">{feed[0].t}</span> — {liveFeedLabel(feed[0])}
                </span>
              </>
            ) : (
              <span className="text-[12.5px] text-faint">
                {fmt(t.cockpit.feedShown, { n: filtered.length })}
              </span>
            )}
          </div>
        </DCard>

        {/* right column */}
        <div className="flex flex-col gap-4">
          {canManage && (
            <DCard className="p-[22px]">
              <div className="mb-1 flex items-center justify-between">
                <div className="font-display text-[17px] font-bold text-text">{t.cockpit.approvalsTitle}</div>
                {openReqs > 0 && (
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-acc px-[7px] font-display text-[13px] font-extrabold text-on-acc">
                    {openReqs}
                  </span>
                )}
              </div>
              <div className="mb-4 text-[12.5px] text-faint">{t.cockpit.approvalsSub}</div>
              {openReqs === 0 ? (
                <div className="flex flex-col items-center gap-[10px] py-2 text-center text-[13.5px] text-faint">
                  <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line bg-elev2 text-acc">
                    <Icon name="check" size={19} sw={2.3} />
                  </span>
                  {t.cockpit.approvalsEmpty}
                </div>
              ) : (
                <div className="flex flex-col gap-[18px]">
                  {evQuotaReqs.length > 0 && (
                    <div>
                      <Label className="mb-[11px]">{t.cockpit.approvalsQuotaLabel}</Label>
                      <div className="flex flex-col gap-[13px]">
                        {evQuotaReqs.map((r) => (
                          <div key={r.id} className="flex items-center gap-[11px]">
                            <Avatar name={r.who} size={34} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13.5px] font-semibold text-text">{r.who}</div>
                              <div className="truncate text-[11.5px] text-faint">
                                {fmt(t.cockpit.quotaPlus, { n: r.extra })}
                                {r.reason ? ` · ${r.reason}` : ''}
                              </div>
                            </div>
                            <div className="flex shrink-0 gap-[6px]">
                              <MiniBtn icon="check" accent title={t.cockpit.approveQuotaTitle} onClick={() => approveQuota(r)} />
                              <MiniBtn icon="close" title={t.cockpit.denyTitle} onClick={() => denyQuota(r)} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {evGuestReqs.length > 0 && (
                    <div>
                      <Label className="mb-[11px]">{t.cockpit.approvalsLandingLabel}</Label>
                      <div className="flex flex-col gap-[13px]">
                        {evGuestReqs.map((r) => (
                          <div key={r.id} className="flex items-center gap-[11px]">
                            <Avatar name={r.name} size={34} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13.5px] font-semibold text-text">
                                {r.name}
                                {r.plus > 0 && <span className="font-extrabold text-acc"> +{r.plus}</span>}
                              </div>
                              <div className={cn('truncate text-[11.5px]', r.flag ? 'text-acc' : 'text-faint')}>
                                {r.flag ?? r.motivation ?? (r.phoneLast4 ? fmt(t.cockpit.phoneLast4, { last4: r.phoneLast4 }) : t.cockpit.requestFallback)}
                              </div>
                            </div>
                            <div className="flex shrink-0 gap-[6px]">
                              <MiniBtn
                                icon="check"
                                accent
                                title={defaultTierId ? t.cockpit.approveTitle : t.cockpit.approveNoTier}
                                disabled={!defaultTierId}
                                onClick={() => approveLanding(r)}
                              />
                              <MiniBtn icon="close" title={t.cockpit.denyTitle} onClick={() => denyLanding(r)} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </DCard>
          )}

          {/* aanwezig per tier */}
          <DCard className="p-[22px]">
            <div className="mb-1 font-display text-[17px] font-bold text-text">{t.cockpit.perTierTitle}</div>
            <div className="mb-[18px] text-[12.5px] text-faint">{t.cockpit.perTierSub}</div>
            <PerTierBars rows={tierRows} />
          </DCard>

          {/* instroom per kwartier */}
          {canSeeStats && <KwartierCard perKwartier={stats?.perKwartier ?? []} />}
        </div>
      </div>

      {modal &&
        (() => {
          const g = modal.guest;
          const ps = partyState(g, arrivals);
          const isOut = modal.kind === 'checkout';
          const max = modal.kind === 'checkin' ? ps.totalHeads : modal.kind === 'topup' ? ps.remaining : ps.insideHeads;
          const v = Math.min(max, Math.max(1, modal.value));
          const afterInside =
            modal.kind === 'checkin' ? v : modal.kind === 'topup' ? ps.insideHeads + v : ps.insideHeads - v;
          const setV = (nv: number): void =>
            setModal((s) => (s ? { ...s, value: Math.min(max, Math.max(1, nv)) } : s));
          const heading =
            modal.kind === 'checkin'
              ? t.cockpit.modalHowManyIn
              : modal.kind === 'topup'
                ? fmt(t.cockpit.modalTopupHeading, { inside: ps.insideHeads, total: ps.totalHeads, n: ps.remaining })
                : fmt(t.cockpit.modalCheckoutHeading, { inside: ps.insideHeads, unit: ps.insideHeads === 1 ? t.cockpit.personSingular : t.cockpit.personPlural });
          const stepLabel = modal.kind === 'checkin' ? t.cockpit.stepInside : modal.kind === 'topup' ? t.cockpit.stepMore : t.cockpit.stepCheckOut;
          const confirmLine =
            modal.kind === 'checkin'
              ? fmt(t.cockpit.modalCheckinLine, { v, total: ps.totalHeads, unit: ps.totalHeads === 1 ? t.cockpit.personSingular : t.cockpit.personPlural })
              : modal.kind === 'topup'
                ? fmt(t.cockpit.modalTopupLine, { after: afterInside, total: ps.totalHeads })
                : fmt(t.cockpit.modalCheckoutLine, {
                    v,
                    inside: ps.insideHeads,
                    unit: ps.insideHeads === 1 ? t.cockpit.personSingular : t.cockpit.personPlural,
                    tail: afterInside > 0 ? fmt(t.cockpit.modalCheckoutLineTail, { after: afterInside }) : '',
                  });
          const confirmBtn =
            modal.kind === 'checkin' ? t.cockpit.modalConfirmCheckin : modal.kind === 'topup' ? fmt(t.cockpit.modalConfirmTopup, { n: v }) : t.cockpit.modalConfirmCheckout;
          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModal(null)}>
              <div className="w-[340px] rounded-[18px] border border-line bg-elev p-5" onClick={(e) => e.stopPropagation()}>
                <div className="font-display text-[17px] font-bold text-text">
                  {g.name}
                  {g.plus > 0 && <span className="text-acc"> +{g.plus}</span>}
                </div>
                <div className="mt-0.5 text-[12.5px] text-faint">{heading}</div>
                <div className={cn('mt-4 flex items-center justify-between gap-3 rounded-[14px] p-2.5', isOut ? 'bg-elev2' : 'bg-acc-dim')}>
                  <button
                    type="button"
                    onClick={() => setV(v - 1)}
                    disabled={v <= 1}
                    className={cn('flex h-11 w-11 items-center justify-center rounded-[12px] border border-line bg-elev2 text-text disabled:opacity-40', v > 1 && press)}
                    aria-label={t.cockpit.modalMinusAria}
                  >
                    <Icon name="minus" size={20} sw={2.4} />
                  </button>
                  <div className="text-center">
                    <div className="font-display text-[26px] font-bold leading-none text-text">
                      {v}
                      <span className="text-faint">/{max}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-dim">{stepLabel}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setV(v + 1)}
                    disabled={v >= max}
                    className={cn('flex h-11 w-11 items-center justify-center rounded-[12px] border border-line bg-elev2 disabled:opacity-40', v < max && press)}
                    aria-label={t.cockpit.modalPlusAria}
                  >
                    <Icon name="plus" size={20} sw={2.4} stroke="#B5A6FF" />
                  </button>
                </div>
                <div className="mt-3 text-center text-[12.5px] text-faint">{confirmLine}</div>
                <div className="mt-4 flex gap-2">
                  <DBtn kind="ghost" className="flex-1 justify-center" onClick={() => setModal(null)}>
                    {t.cockpit.modalCancel}
                  </DBtn>
                  <DBtn kind={isOut ? 'dark' : undefined} className="flex-1 justify-center" onClick={confirmModal}>
                    {confirmBtn}
                  </DBtn>
                </div>
              </div>
            </div>
          );
        })()}
      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div
            className={cn(
              'flex items-center gap-2.5 rounded-[14px] border px-[18px] py-[13px] font-body text-[14px] font-bold shadow-lg',
              toast.tone === 'in' ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev2 text-text'
            )}
          >
            <Icon name={toast.tone === 'in' ? 'check' : 'history'} size={17} sw={2.4} stroke={toast.tone === 'in' ? '#16132B' : undefined} />
            {toast.msg}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────────

// Rows are ~73px (avatar 38 + py-3 + two text lines); estimate close to that so
// the virtualizer reserves the right space before measuring.
const COCKPIT_ROW_EST = 73;

/**
 * Virtualized cockpit guest list (STAP 3.5b · #1a). Windows the rows inside the
 * 560px scroll area so ~1500 guests don't all mount; dynamic measurement keeps
 * partial/2-line rows aligned. Rendering only — check-in/out, flash highlight and
 * the empty state are unchanged. Memo'd: parent state churn (search keystrokes,
 * toasts) must not re-render the 1500-row window — all props have stable identities.
 */
const CockpitGuestList = memo(function CockpitGuestList({
  rows,
  totalGuests,
  arrivals,
  tierDisplay,
  flashId,
  canCheckIn,
  allowUncheck,
  onCheckInClick,
  onVoid,
}: {
  rows: Guest[];
  totalGuests: number;
  arrivals: ReadonlyMap<string, { arrived: number; at: string }>;
  tierDisplay: Map<string, { color: string; short: string }>;
  flashId: string | null;
  canCheckIn: boolean;
  allowUncheck: boolean;
  onCheckInClick: (g: Guest) => void;
  onVoid: (g: Guest) => void;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COCKPIT_ROW_EST,
    overscan: 10,
    getItemKey: (i) => rows[i]?.id ?? i,
  });

  return (
    <div ref={scrollRef} className="max-h-[560px] overflow-y-auto">
      {rows.length === 0 ? (
        <div className="px-4 py-11 text-center text-[14px] text-faint">
          {totalGuests === 0 ? t.cockpit.emptyNoGuests : t.cockpit.emptyNoFilter}
        </div>
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const g = rows[vi.index];
            if (!g) return null;
            const isIn = g.status === 'in';
            const td = tierDisplay.get(g.role);
            const arr = arrivals.get(g.id);
            const arrivedCount = arr ? arr.arrived : g.plus;
            const partial = isIn && arrivedCount < g.plus;
            const atLabel = arr?.at ? amsterdamHM(new Date(arr.at)) : g.at;
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
              >
                <div
                  className={cn(
                    'grid grid-cols-[1fr_120px_150px_96px] items-center border-b border-line2 px-[18px] py-3 transition-colors duration-500',
                    flashId === g.id && 'bg-acc-dim'
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={g.name} size={38} accent={isIn} />
                    <div className="min-w-0">
                      <div className="truncate font-display text-[15px] font-bold text-text">
                        {g.name}
                        {g.plus > 0 && <span className="font-extrabold text-acc"> +{g.plus}</span>}
                      </div>
                      <div className="truncate text-[11.5px] text-faint">
                        {g.note || (g.by ? fmt(t.cockpit.addedBy, { name: g.by }) : '—')}
                      </div>
                    </div>
                  </div>
                  <div>
                    <span className="inline-flex items-center gap-[7px] font-body text-[12.5px] font-bold text-dim">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: td?.color ?? 'rgba(255,255,255,0.26)' }}
                      />
                      {td?.short ?? g.role}
                    </span>
                  </div>
                  <div>
                    {isIn ? (
                      <div>
                        <span className="inline-flex items-center gap-1.5 font-body text-[12.5px] font-bold text-acc">
                          <Icon name="check" size={13} sw={2.6} />
                          {partial ? fmt(t.cockpit.rowInsidePartial, { arrived: arrivedCount + 1, total: g.plus + 1 }) : t.cockpit.rowInside}
                          {atLabel ? ` · ${atLabel}` : ''}
                        </span>
                        {g.inBy && <div className="text-[11px] text-faint">{fmt(t.cockpit.rowInsideBy, { name: g.inBy })}</div>}
                      </div>
                    ) : (
                      <span className="inline-flex items-center gap-[7px] text-[12.5px] text-faint">
                        <span className="h-2 w-2 rounded-full border-[1.5px] border-ghost" />
                        {t.cockpit.rowOnTheWay}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-end gap-[7px]">
                    {canCheckIn ? (
                      <>
                        <ChkBtn kind="in" active={isIn} onClick={() => onCheckInClick(g)} />
                        <ChkBtn
                          kind="out"
                          active={!isIn}
                          disabled={isIn && !allowUncheck}
                          onClick={() => onVoid(g)}
                        />
                      </>
                    ) : (
                      <span className="text-[11px] text-ghost">—</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

function LiveClock(): JSX.Element {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="text-right">
      <div className="font-display text-[30px] font-extrabold tabular-nums tracking-[-0.01em] text-text">
        {amsterdamHMS(now)}
      </div>
      <div className="text-[11.5px] text-faint">{t.cockpit.localTime}</div>
    </div>
  );
}

function Tile({ v, l, s, accent }: { v: string | number; l: string; s: string; accent?: boolean }): JSX.Element {
  return (
    <DCard className="p-[18px]">
      <div
        className={cn(
          'font-display text-[34px] font-extrabold leading-none tabular-nums tracking-[-0.02em]',
          accent ? 'text-acc' : 'text-text'
        )}
      >
        {v}
      </div>
      <div className="mt-3 text-[14px] font-semibold text-text">{l}</div>
      <div className="mt-0.5 text-[12.5px] text-faint">{s}</div>
    </DCard>
  );
}

function TierChip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-[7px] whitespace-nowrap rounded-full border px-[13px] py-[7px] font-display text-[12.5px] font-bold',
        press,
        on ? 'border-transparent bg-text text-bg' : 'border-line text-dim'
      )}
    >
      {children}
    </button>
  );
}

function ChkBtn({
  kind,
  active,
  disabled,
  onClick,
}: {
  kind: 'in' | 'out';
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  const isIn = kind === 'in';
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-pressed={active}
      title={isIn ? t.cockpit.checkInTitle : disabled ? t.cockpit.checkOutDisabledTitle : t.cockpit.checkOutTitle}
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border',
        !disabled && press,
        disabled
          ? 'cursor-not-allowed border-line bg-transparent text-ghost opacity-50'
          : active
            ? isIn
              ? 'border-transparent bg-acc text-on-acc'
              : 'border-line bg-elev2 text-text'
            : 'border-line bg-transparent text-ghost'
      )}
    >
      <Icon name={disabled ? 'lock' : isIn ? 'check' : 'close'} size={isIn ? 19 : 16} sw={2.4} />
    </button>
  );
}

function MiniBtn({
  icon,
  accent,
  title,
  disabled,
  onClick,
}: {
  icon: IconName;
  accent?: boolean;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border disabled:opacity-40',
        press,
        accent ? 'border-transparent bg-acc' : 'border-line bg-transparent'
      )}
    >
      <Icon
        name={icon}
        size={accent ? 15 : 14}
        sw={accent ? 2.4 : 1.9}
        stroke={accent ? '#16132B' : 'rgba(255,255,255,0.40)'}
      />
    </button>
  );
}

function PerTierBars({ rows }: { rows: ReturnType<typeof perTierLive> }): JSX.Element {
  if (rows.length === 0) {
    return <div className="text-[13px] text-faint">{t.cockpit.perTierEmpty}</div>;
  }
  const maxH = Math.max(1, ...rows.map((t) => t.aangemeld));
  return (
    <div className="flex flex-col gap-[15px]">
      {rows.map((t) => (
        <div key={t.role}>
          <div className="mb-[7px] flex justify-between">
            <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold text-text">
              <span className="h-2 w-2 rounded-full" style={{ background: t.color }} />
              {t.tier}
            </span>
            <span className="font-display text-[12.5px] tabular-nums text-faint">
              <b className="text-text">{t.binnen}</b> / {t.aangemeld}
            </span>
          </div>
          <div className="relative h-[10px] overflow-hidden rounded-[6px] bg-elev2">
            <div
              className="absolute inset-0 rounded-[6px]"
              style={{ width: `${(t.aangemeld / maxH) * 100}%`, background: 'rgba(255,255,255,0.07)' }}
            />
            <div
              className="absolute inset-0 rounded-[6px] transition-[width] duration-500 ease-out"
              style={{ width: `${(t.binnen / maxH) * 100}%`, background: t.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function KwartierCard({ perKwartier }: { perKwartier: { t: string; n: number }[] }): JSX.Element {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const maxK = Math.max(1, ...perKwartier.map((b) => b.n));
  const curIdx = currentBucketIndex(perKwartier, now);

  return (
    <DCard className="p-[22px]">
      <div className="mb-[18px] flex items-start justify-between">
        <div>
          <div className="font-display text-[17px] font-bold text-text">{t.cockpit.arrivalsTitle}</div>
          <div className="mt-0.5 text-[12.5px] text-faint">{t.cockpit.arrivalsSub}</div>
        </div>
        {curIdx >= 0 && perKwartier[curIdx] && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-acc-dim px-[10px] py-1.5 font-body text-[11.5px] font-bold text-acc">
            <span className="h-1.5 w-1.5 rounded-full bg-acc animate-pulse" />
            {fmt(t.cockpit.arrivalsNow, { time: perKwartier[curIdx].t })}
          </span>
        )}
      </div>
      {perKwartier.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-faint">{t.cockpit.arrivalsEmpty}</div>
      ) : (
        <div className="flex h-[150px] items-end gap-[5px]">
          {perKwartier.map((b, i) => {
            const isPeak = b.n === maxK && b.n > 0;
            const isNow = i === curIdx;
            return (
              <div key={b.t} className="flex flex-1 flex-col items-center gap-1.5">
                <div className={cn('font-display text-[10px] font-bold tabular-nums', isNow ? 'text-acc' : 'text-faint')}>
                  {b.n}
                </div>
                <div
                  className={cn(
                    'w-full rounded-[5px] border',
                    isPeak ? 'border-transparent bg-acc' : 'bg-elev2',
                    isNow && !isPeak ? 'border-acc' : !isPeak && 'border-line'
                  )}
                  style={{ height: Math.max(2, (b.n / maxK) * 104) }}
                />
                <div
                  className={cn('font-display text-[9px]', isNow ? 'text-acc' : 'text-ghost')}
                  style={{ transform: 'rotate(-45deg)', transformOrigin: 'center', whiteSpace: 'nowrap', marginTop: 4 }}
                >
                  {b.t}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </DCard>
  );
}
