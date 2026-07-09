'use client';

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import type { Guest as GuestT } from '@/lib/po/types';
import { t, fmt } from '@/lib/i18n';
import { Icon } from '../../icon';
import { Avatar, Btn, PayChip, StatusDot } from '../../kit';
import { Sheet } from '../../shell';
import { TierPill, press, cardPress } from './_shared';

/** Scope chip for the Guests-tab event picker ("All events" + each event). */
export function ScopeChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full border px-3 py-[7px] font-display text-[12.5px] font-bold transition-[filter] hover:brightness-[1.07]',
        on ? 'border-transparent bg-text text-bg' : 'border-line bg-transparent text-dim',
      )}
    >
      {children}
    </button>
  );
}

/** Pick one tier and apply it to N selected guests. */
export function BulkTierSheet({
  count,
  tiers,
  isPending,
  err,
  onPick,
  onClose,
}: {
  count: number;
  tiers: Array<{ id: string; name: string; short: string; color: string }>;
  isPending: boolean;
  err: string | null;
  onPick: (tierId: string) => void;
  onClose: () => void;
}): JSX.Element {
  const ms = t.guests.multiSelect;
  const guestWord = count === 1 ? ms.guestOne : ms.guestMany;
  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
        {ms.tierSheetTitle}
      </div>
      <div className="mb-4 text-[13px] text-faint">
        {fmt(ms.tierSheetSub, { n: count, guests: guestWord })}
      </div>
      <div className="flex flex-col gap-2">
        {tiers.map((tier) => (
          <button
            key={tier.id}
            type="button"
            disabled={isPending}
            onClick={() => onPick(tier.id)}
            className={cn(
              'flex items-center gap-[12px] rounded-[12px] border border-line bg-elev px-[14px] py-[13px] text-left',
              press,
              isPending && 'opacity-50',
            )}
          >
            <span className="h-[10px] w-[10px] shrink-0 rounded-full" style={{ background: tier.color }} />
            <span className="flex-1 font-display text-[14.5px] font-bold text-text">{tier.name}</span>
            <Icon name="chev" size={16} className="text-ghost" />
          </button>
        ))}
      </div>
      {err && (
        <p className="mt-3 text-[12.5px] text-red-300" role="alert">
          {err}
        </p>
      )}
      {isPending && (
        <p className="mt-3 text-center text-[12.5px] text-faint">{ms.tierBusy}</p>
      )}
      <Btn kind="ghost" full className="mt-3" onClick={onClose} disabled={isPending}>
        {ms.cancelSelection}
      </Btn>
    </Sheet>
  );
}

// Mobile card ≈ avatar 34 + py-8 + one line (denser, feedback Joeri); desktop row ≈ avatar 36 + py-11.
const GUEST_CARD_EST = 52;
const GUEST_ROW_EST = 58;

/** Virtualized mobile card list (own scroll parent → the virtualizer windows it).
 *  Long-press (≥350ms) enters multi-select mode for the pressed card. */
export function GuestCardList({
  rows,
  selected,
  onAct,
  onToggle,
}: {
  rows: GuestT[];
  selected: Set<string>;
  onAct: (id: string) => void;
  onToggle: (id: string) => void;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const longPress = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

  const startLong = (id: string): void => {
    if (longPress.current) clearTimeout(longPress.current.timer);
    const timer = setTimeout(() => {
      longPress.current = null;
      onToggle(id);
    }, 350);
    longPress.current = { id, timer };
  };
  const cancelLong = (): void => {
    if (longPress.current) {
      clearTimeout(longPress.current.timer);
      longPress.current = null;
    }
  };

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GUEST_CARD_EST,
    overscan: 8,
    getItemKey: (i) => rows[i]?.id ?? i,
  });
  return (
    <div ref={scrollRef} className="po-scroll min-h-0 flex-1 overflow-y-auto lg:hidden" style={{ padding: '0 16px 24px' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const g = rows[vi.index];
          if (!g) return null;
          const isSelected = selected.has(g.id);
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
            >
              <div className="pb-[7px]">
                <button
                  type="button"
                  onClick={() => onAct(g.id)}
                  onPointerDown={() => startLong(g.id)}
                  onPointerUp={cancelLong}
                  onPointerLeave={cancelLong}
                  onPointerCancel={cancelLong}
                  className={cn(
                    'flex w-full items-center gap-[10px] rounded-[12px] border px-[11px] py-[8px] text-left',
                    cardPress,
                    isSelected ? 'border-acc bg-acc-dim' : 'border-line bg-elev',
                  )}
                >
                  {selected.size > 0 ? (
                    <span className={cn(
                      'flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                      isSelected ? 'border-acc bg-acc' : 'border-ghost bg-transparent',
                    )}>
                      {isSelected && <Icon name="check2" size={11} stroke="#0B0B0D" sw={2.8} />}
                    </span>
                  ) : (
                    <Avatar name={g.name} size={34} accent={g.role === 'VIP'} />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-display text-[14.5px] font-bold text-text">
                      {g.name}
                      {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
                    </span>
                    {g.eventName && <span className="truncate font-body text-[11px] text-faint">{g.eventName}</span>}
                  </span>
                  {g.note && !isSelected && (
                    <span className="shrink-0 text-acc-soft">
                      <Icon name="note" size={13} />
                    </span>
                  )}
                  {g.pay === 'pay' && !isSelected && <PayChip pay="pay" />}
                  <TierPill name={g.tierName} color={g.tierColor} fallback={g.role} />
                  {g.status === 'refused' ? (
                    <span className="shrink-0 rounded-[7px] border border-line2 px-2 py-[3px] font-body text-[11px] font-bold text-faint">{t.guests.list.refused}</span>
                  ) : (
                    <StatusDot status={g.status} label={false} />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Virtualized desktop table. The header stays sticky; the rows window inside the
 * scroll area as a positioned <tbody> (absolute <tr>s with translateY) so we keep
 * a real <table> for column sizing while only mounting the visible rows. Rows use
 * a CSS grid (matching the header columns) since absolute <tr>s leave normal
 * table layout. A checkbox column on the left enters multi-select mode.
 */
export function GuestTable({
  rows,
  selected,
  onOpen,
  onToggle,
  onToggleAll,
}: {
  rows: GuestT[];
  selected: Set<string>;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => GUEST_ROW_EST,
    overscan: 12,
    getItemKey: (i) => rows[i]?.id ?? i,
  });
  const cols = 'grid-cols-[40px_1fr_120px_120px_170px]';
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <div ref={scrollRef} className="po-scroll hidden min-h-0 flex-1 overflow-y-auto lg:block" style={{ padding: '0 16px 24px' }}>
      <div className="overflow-hidden rounded-[16px] border border-line bg-elev">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-[1]">
            <tr className={cn('grid bg-elev2', cols, '[&>th]:px-3 [&>th]:py-[11px] [&>th]:font-body [&>th]:text-[11px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-[0.04em] [&>th]:text-faint')}>
              <th className="!pl-3">
                <button
                  type="button"
                  // Toggle on pointerdown, not click: in the virtualized table a
                  // focus-shift scrolls the body (top rows sit under the sticky
                  // header) and re-renders the rows between mousedown and mouseup,
                  // which cancels the trusted click. pointerdown fires first, so the
                  // action always lands; onClick handles keyboard only (detail 0). (T11)
                  onPointerDown={(e) => { e.preventDefault(); onToggleAll(); }}
                  onClick={(e) => { if (e.detail === 0) onToggleAll(); }}
                  aria-label={allSelected ? 'Deselect all' : 'Select all'}
                  aria-pressed={allSelected}
                  className={cn(
                    'flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border-2 transition-colors',
                    allSelected ? 'border-acc bg-acc' : 'border-ghost bg-transparent hover:border-dim',
                  )}
                >
                  {allSelected && <Icon name="check2" size={11} stroke="#0B0B0D" sw={2.8} />}
                </button>
              </th>
              <th>{t.guests.list.colGuest}</th>
              <th>{t.guests.list.colRole}</th>
              <th>{t.guests.list.colPayment}</th>
              <th>{t.guests.list.colAdded}</th>
            </tr>
          </thead>
          <tbody className="block" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vi) => {
              const g = rows[vi.index];
              if (!g) return null;
              const isSelected = selected.has(g.id);
              return (
                <tr
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  onClick={() => {
                    if (selected.size > 0) onToggle(g.id);
                    else onOpen(g.id);
                  }}
                  className={cn(
                    'group grid w-full cursor-pointer items-center border-t border-line2 transition-colors',
                    cols,
                    '[&>td]:px-3 [&>td]:py-[11px] [&>td]:align-middle',
                    isSelected ? 'bg-acc-dim hover:bg-acc-dim/80' : 'hover:bg-elev2',
                  )}
                  style={{ position: 'absolute', top: 0, left: 0, transform: `translateY(${vi.start}px)` }}
                >
                  <td
                    className="!pl-3"
                    // Toggle on pointerdown (see the header checkbox): the trusted
                    // click gets cancelled by the virtualized re-render, pointerdown
                    // does not. Covers clicks on the whole 40px column, not just the
                    // 20px dot. onClick handles keyboard focus only. (T11)
                    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(g.id); }}
                    onClick={(e) => { e.stopPropagation(); }}
                  >
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); if (e.detail === 0) onToggle(g.id); }}
                      aria-label={isSelected ? 'Deselect' : 'Select'}
                      className={cn(
                        'flex h-[20px] w-[20px] items-center justify-center rounded-full border-2 transition-colors',
                        isSelected ? 'border-acc bg-acc' : 'border-ghost bg-transparent hover:border-dim',
                      )}
                    >
                      {isSelected && <Icon name="check2" size={10} stroke="#0B0B0D" sw={2.8} />}
                    </button>
                  </td>
                  <td>
                    <div className="flex items-center gap-[11px]">
                      <Avatar name={g.name} size={36} accent={g.role === 'VIP'} />
                      <span className="min-w-0">
                        <span className="font-display text-[14.5px] font-bold text-text">
                          {g.name}
                          {g.plus > 0 && <span className="font-semibold text-faint"> +{g.plus}</span>}
                        </span>
                        {g.eventName && (
                          <span className="mt-0.5 block max-w-[280px] truncate text-[12px] text-faint">{g.eventName}</span>
                        )}
                        {g.note && (
                          <span className="mt-0.5 block max-w-[280px] truncate text-[12px] text-acc-soft">{g.note}</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td>
                    <TierPill name={g.tierName} color={g.tierColor} fallback={g.role} />
                  </td>
                  <td>{g.pay === 'pay' ? <PayChip pay="pay" /> : <span className="text-[12.5px] text-faint">—</span>}</td>
                  <td>
                    {/* No leading em-dash when the adder is unknown (fixes the
                        "—27 Jun" artifact): show the name + date, or the date alone. */}
                    {g.by && <span className="text-[13px] text-dim">{g.by}</span>}
                    {g.addedAt && <span className={cn('font-display text-[12px] text-faint', g.by && 'ml-1.5')}>{g.addedAt}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
