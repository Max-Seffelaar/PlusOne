'use client';

/**
 * Door check-in list (spec §4 + decision #39): search-first, big tap targets,
 * Beide/Onderweg/Ingecheckt toggle, live onderweg/binnen counters. Checked-in
 * guests stay visible but dim and, under "Beide", sink below an "AL BINNEN · N"
 * divider. Recreated from the prototype `Deur` screen using the shared kit.
 *
 * Perf (STAP 3.5b · #1a/#1b): at ~1500 guests the list is virtualized with
 * `@tanstack/react-virtual` — the four sections are flattened into ONE tagged
 * item array (`flattenCheckInItems`) and only the visible window of rows mounts.
 * Search is debounced (the input stays instant; the expensive flatten runs on the
 * settled term). Rendering changes only — the data/outbox flow is untouched.
 */
import { useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Icon } from '@/components/po/icon';
import { Avatar, Label, PayChip, StatusDot, Top } from '@/components/po/kit';
import { useDoor } from '../DoorProvider';
import type { DoorGuest } from '../model';
import { flattenCheckInItems, partsLeft, type CheckInItem, type Filter } from './checkin-items';
import { TierChip } from './TierChip';

const cardPress = 'transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]';

// Distinct estimates per item type so the virtualizer reserves close-to-real
// space before measurement (header ≈ a thin divider, guest/refused ≈ a tall card).
const HEADER_EST = 34;
const GUEST_EST = 86;

function Seg({ value, onChange }: { value: Filter; onChange: (v: Filter) => void }): JSX.Element {
  const items: [Filter, string][] = [
    ['both', 'Beide'],
    ['wait', 'Onderweg'],
    ['in', 'Ingecheckt'],
  ];
  return (
    <div className="flex flex-none gap-1.5 px-5 pb-[14px]">
      {items.map(([k, l]) => (
        <button
          key={k}
          type="button"
          onClick={() => onChange(k)}
          className={cn(
            'flex-1 cursor-pointer rounded-full border py-[9px] font-display text-[13px] font-bold transition-[filter] hover:brightness-[1.07]',
            value === k ? 'border-transparent bg-text text-bg' : 'border-line bg-transparent text-dim',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function CheckInList({ onOpenGuest, onAdd }: { onOpenGuest: (id: string) => void; onAdd: () => void }): JSX.Element {
  const { view, outboxByGuest, undoRefusal } = useDoor();
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filter>('both');
  // Input stays instant; the heavy flatten runs on the settled term (#1b).
  const dq = useDebouncedValue(q, 140);

  // Hooks must run before the early return, so derive against a stable fallback.
  const guests = view?.guests;
  const refused = view?.refused;
  const flat = useMemo(
    () => flattenCheckInItems(guests ?? [], refused ?? [], f, dq),
    [guests, refused, f, dq],
  );

  if (!view) return <ListSkeleton />;

  return (
    <div className="flex h-full flex-col">
      <Top
        big
        title="Check-in"
        sub={`${view.event.name}${view.event.venueName ? ` · ${view.event.venueName}` : ''}`}
      />
      {/* Both units side by side (S1.3): the big number is gasten (rows — the
          door's per-name unit), the sub-line is koppen (incl. +1's, #5) so it
          reconciles with EventView/cockpit. */}
      <div className="flex flex-none gap-[10px] px-5 pb-[14px]">
        <div className="flex-1 rounded-[14px] border border-line bg-elev px-[14px] py-[12px]">
          <div className="font-display text-[26px] font-extrabold leading-none text-text">{view.waitingCount}</div>
          <div className="mt-1 text-[12px] text-faint">gasten onderweg</div>
          <div className="mt-0.5 text-[11px] text-ghost">{view.waitingHeadcount} koppen</div>
        </div>
        <div className="flex-1 rounded-[14px] bg-acc-dim px-[14px] py-[12px]">
          <div className="font-display text-[26px] font-extrabold leading-none text-acc">{view.insideCount}</div>
          <div className="mt-1 text-[12px] text-dim">gasten binnen</div>
          <div className="mt-0.5 text-[11px] text-faint">{view.insideHeadcount} koppen</div>
        </div>
      </div>
      <div className="flex-none px-5 pb-3">
        <div className="flex items-center gap-[11px] rounded-field border border-line bg-elev px-[15px] py-[13px]">
          <span className="text-faint">
            <Icon name="search" size={19} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Typ de naam van de gast…"
            autoFocus
            className="min-w-0 flex-1 border-none bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint"
          />
          <button
            type="button"
            onClick={onAdd}
            aria-label="Gast ter plekke toevoegen"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-text text-bg transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.94]"
          >
            <Icon name="plus" size={18} sw={2.4} />
          </button>
        </div>
      </div>
      <Seg value={f} onChange={setF} />
      <VirtualBody
        flat={flat}
        q={dq}
        filter={f}
        view={view}
        outboxByGuest={outboxByGuest}
        onOpenGuest={onOpenGuest}
        undoRefusal={undoRefusal}
      />
    </div>
  );
}

/** The scrollable, virtualized list region (its own scroll parent for the virtualizer). */
function VirtualBody({
  flat,
  q,
  filter,
  view,
  outboxByGuest,
  onOpenGuest,
  undoRefusal,
}: {
  flat: ReturnType<typeof flattenCheckInItems>;
  q: string;
  filter: Filter;
  view: NonNullable<ReturnType<typeof useDoor>['view']>;
  outboxByGuest: ReturnType<typeof useDoor>['outboxByGuest'];
  onOpenGuest: (id: string) => void;
  undoRefusal: (id: string) => void;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { items, matchedCount } = flat;

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (items[i]?.type === 'header' ? HEADER_EST : GUEST_EST),
    overscan: 8,
    // Stable keys so a check-in flip / reorder re-uses measurements correctly.
    getItemKey: (i) => items[i]?.key ?? i,
  });

  const renderRow = (item: CheckInItem): JSX.Element => {
    if (item.type === 'header') return divider(item.label);
    if (item.type === 'refused') return refusedRow(item.g, undoRefusal);
    return guestRow(item.g, outboxByGuest, onOpenGuest);
  };

  return (
    <div ref={scrollRef} className="po-scroll min-h-0 flex-1 overflow-y-auto" style={{ padding: '0 20px 100px' }}>
      <Label className="mb-[10px]">
        {q
          ? `${matchedCount} gevonden`
          : filter === 'in'
            ? `${view.insideCount} ingecheckt`
            : filter === 'wait'
              ? `${view.waitingCount} nog aan de deur`
              : 'Volgende aan de deur'}
      </Label>
      {items.length === 0 ? (
        <div className="py-[30px] text-center text-[14px] text-faint">
          {q ? 'Geen gast gevonden.' : filter === 'in' ? 'Nog niemand ingecheckt.' : 'Iedereen is binnen 🎉'}
        </div>
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const item = items[vi.index];
            if (!item) return null;
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
              >
                {/* gap between cards lived in `flex gap-[9px]`; reproduce as bottom padding. */}
                <div className={item.type === 'header' ? '' : 'pb-[9px]'}>{renderRow(item)}</div>
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
  const fully = g.inside && remaining === 0; // helemaal binnen
  return (
    <button
      type="button"
      onClick={() => onOpenGuest(g.id)}
      className={cn(
        'flex w-full items-center gap-[13px] rounded-[16px] border p-[13px] text-left',
        cardPress,
        // Deels binnen: NIET gedimd + accent-rand (springt eruit). Helemaal
        // binnen: gedimd. Onderweg: normaal.
        partly ? 'bg-elev' : fully ? 'border-line2 bg-transparent opacity-[0.55]' : 'border-line bg-elev',
      )}
      style={partly ? { borderColor: 'rgba(181,166,255,0.45)' } : undefined}
    >
      <Avatar name={g.name} size={46} accent={!g.inside && g.tierName === 'VIP'} />
      <div className="min-w-0 flex-1">
        <div className={cn('truncate font-display text-[17px] font-bold', fully ? 'text-dim' : 'text-text')}>
          {g.name}
          {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
        </div>
        <div className="mt-[5px] flex flex-wrap items-center gap-1.5">
          <TierChip name={g.tierName} color={g.tierColor} icon={g.tierIcon} />
          {g.pay && !g.inside && <PayChip pay="pay" />}
          {isDuplicate && (
            <span className="rounded-[6px] border border-dashed border-line px-[7px] py-[2px] font-body text-[10px] font-bold tracking-[0.03em] text-faint">
              DUPLICAAT
            </span>
          )}
        </div>
        <div className="mt-[5px] truncate font-body text-[11.5px]">
          {partly ? (
            <span className="font-semibold text-acc">
              {1 + (g.arrived ?? 0)}/{1 + g.plus} binnen · nog {remaining} onderweg
            </span>
          ) : (
            <span className="text-faint">
              door {g.addedByName}
              {g.last4 && ` · ••${g.last4}`}
            </span>
          )}
        </div>
      </div>
      {partly ? (
        <span className="shrink-0 rounded-[8px] bg-acc px-[10px] py-[6px] font-display text-[12px] font-bold text-on-acc">
          nog {remaining}
        </span>
      ) : fully ? (
        <StatusDot status="in" label={false} />
      ) : (
        <span className="text-acc">
          <Icon name="chev" size={24} />
        </span>
      )}
    </button>
  );
}

function refusedRow(g: DoorGuest, undoRefusal: (id: string) => void): JSX.Element {
  return (
    <div className="flex items-center gap-[13px] rounded-[16px] border border-line2 bg-transparent p-[13px]">
      <Avatar name={g.name} size={46} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[17px] font-bold text-dim">
          {g.name}
          {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
        </div>
        <div className="mt-[5px] truncate font-body text-[11.5px] text-faint">
          Geweigerd{g.refusedReason ? ` · ${g.refusedReason}` : ''}
        </div>
      </div>
      <button
        type="button"
        onClick={() => undoRefusal(g.id)}
        className="shrink-0 rounded-[10px] border border-acc-soft bg-acc-dim px-[12px] py-[8px] font-display text-[12px] font-bold text-acc transition-[filter,transform] hover:brightness-[1.12] active:scale-[0.97]"
      >
        Ongedaan
      </button>
    </div>
  );
}

/**
 * Loading skeleton — reserves roughly the same vertical space as the loaded
 * header area (two stat tiles + search field + segment control) so the
 * skeleton→content swap doesn't shift layout (helps the deur-CLS goal).
 */
function ListSkeleton(): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <Top big title="Check-in" sub="Laden…" />
      {/* stat tiles (height matches the loaded gasten + koppen tiles → no CLS) */}
      <div className="flex flex-none gap-[10px] px-5 pb-[14px]">
        <div className="h-[81px] flex-1 animate-pulse rounded-[14px] border border-line bg-elev" />
        <div className="h-[81px] flex-1 animate-pulse rounded-[14px] bg-acc-dim" />
      </div>
      {/* search field */}
      <div className="flex-none px-5 pb-3">
        <div className="h-[50px] animate-pulse rounded-field border border-line bg-elev" />
      </div>
      {/* segment control */}
      <div className="flex flex-none gap-1.5 px-5 pb-[14px]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[37px] flex-1 animate-pulse rounded-full border border-line bg-elev" />
        ))}
      </div>
      {/* a few placeholder rows */}
      <div className="min-h-0 flex-1 overflow-hidden px-5">
        <div className="mb-[10px] h-[14px] w-[140px] animate-pulse rounded bg-elev2" />
        <div className="flex flex-col gap-[9px]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-[16px] border border-line bg-elev" />
          ))}
        </div>
      </div>
    </div>
  );
}
