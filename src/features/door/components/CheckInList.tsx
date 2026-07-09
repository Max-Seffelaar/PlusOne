'use client';

/**
 * Door check-in list (spec §4 + decision #39): search-first, big tap targets,
 * Beide/Onderweg/Ingecheckt toggle, live onderweg/binnen counters. Checked-in
 * guests stay visible but dim and, under "Beide", sink below an "AL BINNEN · N"
 * divider. Recreated from the prototype `Deur` screen using the shared kit.
 *
 * Layout (feedback Max): each guest is ONE dense line whose whole pill is filled
 * with the tier colour (not a subtle stripe), so the door host scans many more
 * names per screen. The screen is a SINGLE scroll container — the big title, the
 * compact headcount, the Beide/Onderweg/Ingecheckt segment and the tier filters
 * all scroll away with the list; ONLY the search field stays pinned (`sticky` —
 * feedback Joeri 1/7: search must survive any scroll depth, the filters may go).
 * `SyncBar` (live status) is pinned above this by the parent. The filter state
 * itself lives in DoorProvider so the guest-detail push/pop doesn't reset it.
 *
 * Perf (STAP 3.5b · #1a/#1b): at ~1500 guests the list is virtualized with
 * `@tanstack/react-virtual` — the four sections are flattened into ONE tagged
 * item array (`flattenCheckInItems`) and only the visible window of rows mounts.
 * Because non-virtual content (title, search, sticky header, label) now sits
 * ABOVE the rows in the SAME scroll container, the virtualizer's `scrollMargin`
 * is kept equal to the rows-wrapper `offsetTop` and each row is positioned with
 * `translateY(vi.start - scrollMargin)`. Search is debounced (the input stays
 * instant; the expensive flatten runs on the settled term).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Icon } from '@/components/po/icon';
import { Avatar, Label, StatusDot, Top, Seg, cardPress } from '@/components/po/kit';
import { useDoor } from '../DoorProvider';
import type { DoorGuest } from '../model';
import { flattenCheckInItems, partsLeft, type CheckInItem, type Filter } from './checkin-items';
import { tierInk as onTier, tintTier } from '@/lib/po/tier-colors';

// Distinct estimates per item type so the virtualizer reserves close-to-real
// space before measurement (header ≈ a thin divider, guest ≈ a one-line card +
// its 8px bottom gap, which lives inside the measured element).
const HEADER_EST = 34;
const GUEST_EST = 62;

const ACCENT = '#B5A6FF';

/** Optional per-tier filter chips (feedback Joeri): tap a tier to narrow the list
 *  to it; multiple chips OR together; none selected = all. Hidden when an event
 *  has a single tier (nothing to filter). Coloured by the tier's own colour. */
function TierFilterBar({
  tiers,
  selected,
  onToggle,
}: {
  tiers: { id: string; name: string; color: string | null }[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}): JSX.Element | null {
  if (tiers.length <= 1) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pb-[14px]">
      {tiers.map((tier) => {
        const on = selected.has(tier.id);
        const color = tier.color ?? '#8E8E93';
        return (
          <button
            key={tier.id}
            type="button"
            onClick={() => onToggle(tier.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-[7px] font-display text-[12px] font-bold transition-[filter] hover:brightness-[1.07]',
              on ? 'border-transparent text-bg' : 'border-line bg-transparent text-dim',
            )}
            style={on ? { background: color } : undefined}
          >
            {/* Real tier name (not the tierRole taxonomy): two "vip"-ish tiers
                must stay two distinguishable chips (feedback 1/7). */}
            <span className="h-2 w-2 rounded-full" style={{ background: on ? 'rgba(11,11,13,0.55)' : color }} />
            {tier.name}
          </button>
        );
      })}
    </div>
  );
}

export function CheckInList({ onOpenGuest, onAdd }: { onOpenGuest: (id: string) => void; onAdd: () => void }): JSX.Element {
  const { view, outboxByGuest, undoRefusal, listFilters, setListFilters } = useDoor();
  // Filters live in the provider: checking someone in pushes a guest detail and
  // the pop remounts this list — provider state keeps "On the way" selected.
  const { q, f, tierIds: tierFilter } = listFilters;
  const setQ = (next: string): void => setListFilters({ q: next });
  const setF = (next: Filter): void => setListFilters({ f: next });
  // Input stays instant; the heavy flatten runs on the settled term (#1b).
  const dq = useDebouncedValue(q, 140);

  const scrollRef = useRef<HTMLDivElement>(null); // the ONE scroll container
  const listRef = useRef<HTMLDivElement>(null); // wrapper around the virtual rows
  const searchRef = useRef<HTMLInputElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Hooks must run before the early return, so derive against a stable fallback.
  const guests = view?.guests;
  const refused = view?.refused;
  const flat = useMemo(
    () => flattenCheckInItems(guests ?? [], refused ?? [], f, dq, tierFilter),
    [guests, refused, f, dq, tierFilter],
  );
  const { items, matchedCount } = flat;
  const hasItems = items.length > 0;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (items[i]?.type === 'header' ? HEADER_EST : GUEST_EST),
    overscan: 8,
    scrollMargin,
    // Stable keys so a check-in flip / reorder re-uses measurements correctly.
    getItemKey: (i) => items[i]?.key ?? i,
  });

  // Keep the virtualizer's scrollMargin equal to the rows-wrapper offset, since
  // the title + search + sticky header now share the scroll container above the
  // list. useLayoutEffect so the corrected offset lands before the first paint.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const measure = (): void => {
      if (listRef.current) setScrollMargin(listRef.current.offsetTop);
    };
    measure();
    if (!scroller) return;
    const ro = new ResizeObserver(measure); // width reflow / chip-bar wrap
    ro.observe(scroller);
    // The display font swaps the 34px title's height after first paint → re-read.
    if (typeof document !== 'undefined' && document.fonts?.ready) void document.fonts.ready.then(measure);
    return () => ro.disconnect();
    // Re-measure when the header content height (and thus the list offset) can
    // change, or when the rows wrapper mounts/unmounts (empty ↔ list).
  }, [view?.event?.name, view?.event?.venueName, view?.tiers, hasItems]);

  // Search-first: focus the field on open without yanking the scroll position.
  useEffect(() => {
    searchRef.current?.focus({ preventScroll: true });
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, []);

  const toggleTier = (id: string): void => {
    const next = new Set(tierFilter);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setListFilters({ tierIds: next });
  };

  if (!view) return <ListSkeleton />;

  const renderRow = (item: CheckInItem): JSX.Element => {
    if (item.type === 'header') return divider(item.label);
    if (item.type === 'refused') return refusedRow(item.g, undoRefusal);
    return guestRow(item.g, outboxByGuest, onOpenGuest);
  };

  return (
    <div
      ref={scrollRef}
      className="po-scroll relative h-full overflow-y-auto"
      style={{ padding: '0 20px 100px' }}
    >
      {/* (a) SCROLL-AWAY: big title */}
      <div className="-mx-5">
        <Top
          big
          title={t.door.checkinTitle}
          sub={`${view.event.name}${view.event.venueName ? ` · ${view.event.venueName}` : ''}`}
        />
      </div>

      {/* (b) STICKY: the search field — the ONE element that stays pinned at any
          scroll depth (feedback Joeri 1/7). The opaque bg bleeds full-width
          (-mx-5) so rows don't peek through the side gutters while scrolling. */}
      <div className="sticky top-0 z-20 -mx-5 bg-bg px-5 pb-3 pt-1">
        <div className="flex items-center gap-[11px] rounded-field border border-line bg-elev px-[15px] py-[13px]">
          <span className="text-faint">
            <Icon name="search" size={19} />
          </span>
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.door.searchPlaceholder}
            className="min-w-0 flex-1 border-none bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint"
          />
          <button
            type="button"
            onClick={onAdd}
            aria-label={t.door.addOnSpotAria}
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-text text-bg transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.94]"
          >
            <Icon name="plus" size={18} sw={2.4} />
          </button>
        </div>
      </div>

      {/* (c) SCROLL-AWAY: compact headcount + segment + tier filters — they
          scroll off with the list and come back at the top. */}
      <div>
        {/* Both units side by side (S1.3): the big number is gasten (rows — the
            door's per-name unit), the sub is koppen (incl. +1's, #5) so it
            reconciles with EventView/cockpit. */}
        <div className="mb-[12px] flex items-stretch overflow-hidden rounded-[12px] border border-line bg-elev">
          <div className="flex min-w-0 flex-1 items-baseline gap-2 px-[14px] py-[10px]">
            <span className="font-display text-[20px] font-extrabold leading-none text-text">{view.waitingCount}</span>
            <span className="truncate text-[12px] text-faint">{t.door.statOnTheWay}</span>
            <span className="ml-auto shrink-0 self-center text-[11px] text-ghost">{view.waitingHeadcount} {t.door.headcountSub}</span>
          </div>
          <div className="my-[8px] w-px shrink-0 bg-line2" />
          <div className="flex min-w-0 flex-1 items-baseline gap-2 bg-acc-dim px-[14px] py-[10px]">
            <span className="font-display text-[20px] font-extrabold leading-none text-acc">{view.insideCount}</span>
            <span className="truncate text-[12px] text-dim">{t.door.statInside}</span>
            <span className="ml-auto shrink-0 self-center text-[11px] text-faint">{view.insideHeadcount} {t.door.headcountSub}</span>
          </div>
        </div>
        <Seg
          value={f}
          onChange={setF}
          items={[
            ['both', t.door.filterAll],
            ['wait', t.door.filterOnTheWay],
            ['in', t.door.filterInside],
          ]}
          className="pb-[14px]"
        />
        <TierFilterBar tiers={view.tiers} selected={tierFilter} onToggle={toggleTier} />
      </div>

      {/* (d) LABEL */}
      <Label className="mb-[10px] mt-2">
        {q
          ? fmt(t.door.resultFound, { n: matchedCount })
          : f === 'in'
            ? fmt(t.door.countCheckedIn, { n: view.insideCount })
            : f === 'wait'
              ? fmt(t.door.countStillAtDoor, { n: view.waitingCount })
              : t.door.nextAtDoor}
      </Label>

      {/* (e) VIRTUAL ROWS */}
      {items.length === 0 ? (
        <div className="py-[30px] text-center text-[14px] text-faint">
          {q ? t.door.emptySearch : f === 'in' ? t.door.emptyNoneInside : t.door.emptyEveryoneIn}
        </div>
      ) : (
        <div ref={listRef} style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const item = items[vi.index];
            if (!item) return null;
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start - scrollMargin}px)`,
                }}
              >
                {/* gap between cards baked into the measured element (was flex gap). */}
                <div className={item.type === 'header' ? '' : 'pb-[8px]'}>{renderRow(item)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function divider(label: string): JSX.Element {
  return (
    <div className="mx-0.5 mb-[9px] mt-2 flex items-center gap-[10px]">
      <div className="h-px flex-1 bg-line2" />
      <span className="font-body text-[11px] font-bold tracking-[0.06em] text-ghost">{label}</span>
      <div className="h-px flex-1 bg-line2" />
    </div>
  );
}

function guestRow(
  g: DoorGuest,
  outboxByGuest: ReturnType<typeof useDoor>['outboxByGuest'],
  onOpenGuest: (id: string) => void,
): JSX.Element {
  const isDuplicate = (outboxByGuest.get(g.id) ?? []).some((e) => e.status === 'duplicate');
  const remaining = partsLeft(g);
  const partly = g.inside && remaining > 0; // deels binnen — groep nog niet compleet
  const fully = g.inside && remaining === 0; // helemaal binnen → gedimd
  // Muted (checked-in) row sits on a low-alpha tint over near-black → white ink.
  const ink = fully ? '#FFFFFF' : onTier(g.tierColor);
  return (
    <button
      type="button"
      onClick={() => onOpenGuest(g.id)}
      className={cn(
        'flex w-full items-center gap-[11px] rounded-[14px] p-[10px] text-left',
        cardPress,
        fully ? 'border border-line2 opacity-[0.6]' : 'border border-transparent',
      )}
      // Whole-pill tier fill (feedback Max): waiting/partly = solid tier colour
      // with contrast-picked ink; partly adds an accent ring; fully-in = a
      // low-alpha tint so "checked-in = muted" survives.
      style={
        fully
          ? { background: tintTier(g.tierColor, 0.14) }
          : { background: g.tierColor, ...(partly ? { boxShadow: `inset 0 0 0 2px ${ACCENT}` } : {}) }
      }
    >
      <Avatar name={g.name} size={32} />
      {/* Everything on ONE line (feedback Max): name, tier, and "by {staff}".
          Name keeps priority; the attribution shrinks/truncates first. */}
      <div className="flex min-w-0 flex-1 items-baseline gap-1.5" style={{ color: ink }}>
        <span className="min-w-0 shrink truncate font-display text-[15px] font-bold">
          {g.name}
          {g.plus > 0 && <span className="font-semibold opacity-70"> +{g.plus}</span>}
        </span>
        {/* Real tier name; bounded + truncated so a long custom tier ("VIP + fles
            op tafel") can't push the guest's name off the one-line pill. */}
        <span className="max-w-[45%] shrink-0 truncate text-[10.5px] font-bold uppercase tracking-[0.03em] opacity-90">{g.tierName}</span>
        {partly ? (
          <span className="min-w-0 truncate text-[11px] font-semibold opacity-90" style={{ flexShrink: 3 }}>
            {fmt(t.door.partlyInside, { arrived: 1 + (g.arrived ?? 0), total: 1 + g.plus, n: remaining })}
          </span>
        ) : (
          <span className="min-w-0 truncate text-[11px] opacity-70" style={{ flexShrink: 3 }}>
            · {t.door.logBy} {g.addedByName}
            {g.last4 && ` · ••${g.last4}`}
          </span>
        )}
        {isDuplicate && (
          <span
            className="shrink-0 rounded-[5px] px-[5px] py-px text-[9.5px] font-bold opacity-70"
            style={{ border: `1px solid ${ink}` }}
          >
            {t.door.duplicate}
          </span>
        )}
      </div>
      {partly ? (
        <span className="shrink-0 rounded-[8px] bg-bg px-[9px] py-[5px] font-display text-[12px] font-bold text-text">
          {fmt(t.door.partlyBadge, { n: remaining })}
        </span>
      ) : fully ? (
        <StatusDot status="in" label={false} />
      ) : (
        <span className="shrink-0" style={{ color: ink }}>
          <Icon name="chev" size={22} />
        </span>
      )}
    </button>
  );
}

function refusedRow(g: DoorGuest, undoRefusal: (id: string) => void): JSX.Element {
  return (
    <div className="flex items-center gap-[11px] rounded-[14px] border border-line2 bg-transparent p-[10px]">
      <Avatar name={g.name} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[15.5px] font-bold text-dim">
          {g.name}
          {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
        </div>
        <div className="mt-[1px] truncate font-body text-[11px] text-faint">
          {g.refusedReason ? fmt(t.door.refusedWithReason, { reason: g.refusedReason }) : t.door.refused}
        </div>
      </div>
      <button
        type="button"
        onClick={() => undoRefusal(g.id)}
        className="shrink-0 rounded-[10px] border border-acc-soft bg-acc-dim px-[12px] py-[7px] font-display text-[12px] font-bold text-acc transition-[filter,transform] hover:brightness-[1.12] active:scale-[0.97]"
      >
        {t.door.undo}
      </button>
    </div>
  );
}

/**
 * Loading skeleton — mirrors the new header (title + search + the compact
 * headcount strip + segment) so the skeleton→content swap doesn't shift layout
 * (deur-CLS goal). The tier-filter bar is event-dependent (hidden when ≤1 tier),
 * so it isn't reserved; the big 81px-tiles→loaded jump is what's eliminated.
 */
function ListSkeleton(): JSX.Element {
  return (
    <div className="po-scroll relative h-full overflow-y-auto" style={{ padding: '0 20px 100px' }}>
      <div className="-mx-5">
        <Top big title={t.door.checkinTitle} sub={t.door.loadingSub} />
      </div>
      <div className="pb-3 pt-1">
        <div className="h-[50px] animate-pulse rounded-field border border-line bg-elev" />
      </div>
      <div>
        <div className="mb-[12px] h-[40px] animate-pulse rounded-[12px] border border-line bg-elev" />
        <div className="flex gap-1.5 pb-[14px]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[37px] flex-1 animate-pulse rounded-full border border-line bg-elev" />
          ))}
        </div>
      </div>
      <div className="mb-[10px] mt-2 h-[14px] w-[140px] animate-pulse rounded bg-elev2" />
      <div className="flex flex-col gap-[8px]">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="h-[54px] animate-pulse rounded-[14px] border border-line bg-elev" />
        ))}
      </div>
    </div>
  );
}
