'use client';

import { useState, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { v7 as uuidv7 } from 'uuid';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { Guest as GuestT, PoEvent } from '@/lib/po/types';
import {
  indexGuestsByName,
  suspectedDuplicates,
  planBulkAdd,
  type DupeMode,
  type BulkRowInput,
} from '@/features/guests/bulk-dedupe';
import {
  parseBulk,
  resolveAmbiguity,
  totalSlots,
  type QuickAddTier,
  type AmbiguityChoice,
  type ParseResult,
} from '@/features/guests/quick-add-parser';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import { usePoEvents, usePoGuests, useVenueGuests, usePoTiers, usePoQuota, usePoPermanentContacts } from '@/features/po/hooks';
import {
  usePoAddGuestsBulk,
  usePoUpdateGuest,
  usePoToggleContactPermanent,
  usePoSyncPermanent,
  usePoChangeGuestsTierBulk,
} from '@/features/po/mutations';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { t, fmt } from '@/lib/i18n';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, MiniChip, Note, PayChip, RoleChip, Scroll, StatusDot, Top } from '../../kit';
import { BottomBar, Sheet } from '../../shell';
import { DupeOption, NoTiersBlock, press, col, cardPress } from './_shared';

export { QuickAdd } from './quick-add';
export { ContactProfile, Contacten } from './profile';

// ── GUEST LIST (pushed) ──────────────────────────────────────────────────────

/** Pure search filter for the gastenlijst — extracted so it's memoizable + testable. */
function filterGuestList(guests: GuestT[], q: string): GuestT[] {
  const term = q.trim().toLowerCase();
  return term ? guests.filter((g) => g.name.toLowerCase().includes(term)) : guests;
}

export function Lijst({ ev }: { ev: PoEvent }): JSX.Element {
  const nav = useNav();
  const { data: guests = [], isLoading, isError } = usePoGuests(ev.id);
  const { data: tiers = [] } = usePoTiers(ev.id);
  const changeBulkTier = usePoChangeGuestsTierBulk(ev.id);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTierOpen, setBulkTierOpen] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const dq = useDebouncedValue(q, 140);
  const gs = useMemo(() => filterGuestList(guests, dq), [guests, dq]);

  const toggleSelect = (id: string): void =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelection = (): void => setSelected(new Set());

  const openGuest = (id: string): void => nav.push('guest', { id, eventId: ev.id });
  const onCardAct = (id: string): void => {
    if (selected.size > 0) toggleSelect(id);
    else openGuest(id);
  };

  const applyBulkTier = (tierId: string): void => {
    setBulkErr(null);
    changeBulkTier.mutate(
      { guestIds: Array.from(selected), tierId, eventId: ev.id },
      {
        onSuccess: () => {
          clearSelection();
          setBulkTierOpen(false);
        },
        onError: (e) =>
          setBulkErr(e instanceof Error ? e.message : t.guests.multiSelect.tierFailed),
      },
    );
  };

  return (
    <div className={col}>
      <Top onBack={nav.canGoBack ? nav.back : undefined} title={t.guests.list.title} sub={`${ev.name} · ${fmt(t.guests.list.sub, { shown: gs.length, total: guests.length })}`} right={<IconBtn name="plus" onClick={() => nav.push('quickadd', { id: ev.id })} />} />
      <div className="flex-none px-4 lg:flex lg:items-center lg:gap-3 lg:pb-3">
        {selected.size > 0 ? (
          <div className="flex w-full flex-wrap items-center gap-2 pb-3 lg:pb-0">
            <span className="flex-1 font-display text-[14px] font-bold text-text">
              {fmt(t.guests.multiSelect.selectionBar, { n: selected.size })}
            </span>
            <Btn sm kind="quiet" onClick={() => setSelected(new Set(gs.map((g) => g.id)))}>
              {t.guests.multiSelect.selectAll}
            </Btn>
            <Btn sm kind="primary" icon="ticket" onClick={() => { setBulkErr(null); setBulkTierOpen(true); }}>
              {t.guests.multiSelect.changeTier}
            </Btn>
            <Btn sm kind="ghost" onClick={clearSelection}>
              {t.guests.multiSelect.cancelSelection}
            </Btn>
          </div>
        ) : (
          <>
            <div className="pb-[10px] lg:max-w-[300px] lg:flex-1 lg:pb-0">
              <Field icon="search" placeholder={t.guests.list.searchPlaceholder} value={q} onChange={setQ} />
            </div>
            <div className="flex gap-2 pb-3 lg:ml-auto lg:pb-0">
              <Btn sm kind="primary" icon="plus" onClick={() => nav.push('quickadd', { id: ev.id })}>
                {t.guests.list.addGuest}
              </Btn>
              <Btn sm kind="quiet" icon="paste" onClick={() => nav.push('bulk', { id: ev.id })}>
                {t.guests.list.pasteList}
              </Btn>
              <Btn sm kind="quiet" icon="contact" onClick={() => nav.push('contacten', { id: ev.id })}>
                {t.guests.list.contacts}
              </Btn>
            </div>
          </>
        )}
      </div>
      {isLoading ? (
        <Scroll pad={16} bottom={24}>
          <Empty text={t.guests.list.loading} />
        </Scroll>
      ) : isError ? (
        <Scroll pad={16} bottom={24}>
          <Empty text={t.guests.list.loadError} />
        </Scroll>
      ) : gs.length === 0 ? (
        <Scroll pad={16} bottom={24}>
          <Empty text={q ? t.guests.list.emptyFiltered : t.guests.list.empty} />
        </Scroll>
      ) : (
        <>
          <GuestCardList rows={gs} selected={selected} onAct={onCardAct} onToggle={toggleSelect} />
          <GuestTable rows={gs} selected={selected} onOpen={openGuest} onToggle={toggleSelect} />
        </>
      )}
      {bulkTierOpen && (
        <BulkTierSheet
          count={selected.size}
          tiers={tiers}
          isPending={changeBulkTier.isPending}
          err={bulkErr}
          onPick={applyBulkTier}
          onClose={() => setBulkTierOpen(false)}
        />
      )}
    </div>
  );
}

/** Stable empties so GuestsTab can reuse the multi-select list components without
 *  its own selection state — the Guests TAB is browse-only; bulk actions live on
 *  the event-scoped `Lijst` (reached from an event). */
const EMPTY_SELECTION: Set<string> = new Set();
const noop = (): void => {};

/** Scope chip for the Guests-tab event picker ("All events" + each event). */
function ScopeChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }): JSX.Element {
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

/**
 * The Guests TAB — distinct from the pushed single-event `Lijst`. Defaults to ALL
 * guests across the venue's events (each row badged with its event), with an event
 * picker to scope to one. Fixes the "tab auto-opened an empty event with no way to
 * switch" trap (feedback Max): you always land on a populated list. RLS still scopes
 * staff to their own guests. Add affordances need an event, so they appear only once
 * one is picked.
 */
export function GuestsTab(): JSX.Element {
  const nav = useNav();
  const { data: events = [], isLoading: eventsLoading } = usePoEvents();
  const [scope, setScope] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const dq = useDebouncedValue(q, 140);

  const allMode = scope === null;
  const venue = useVenueGuests(allMode ? events : []);
  const single = usePoGuests(scope ?? '');
  const active = allMode ? venue : single;
  const guests = useMemo(() => active.data ?? [], [active.data]);
  const gs = useMemo(() => filterGuestList(guests, dq), [guests, dq]);
  const loading = active.isLoading || (allMode && eventsLoading);

  const scopeEvent = events.find((e) => e.id === scope) ?? null;
  const countSub = fmt(t.guests.list.sub, { shown: gs.length, total: guests.length });
  const openGuest = (id: string): void => {
    const g = guests.find((x) => x.id === id);
    nav.push('guest', { id, eventId: g?.eventId ?? scope ?? '' });
  };

  return (
    <div className={col}>
      <Top
        title={t.guests.list.title}
        sub={scopeEvent ? `${scopeEvent.name} · ${countSub}` : countSub}
        right={scopeEvent ? <IconBtn name="plus" onClick={() => nav.push('quickadd', { id: scopeEvent.id })} /> : undefined}
      />
      <div className="flex-none overflow-x-auto px-4 pb-3">
        <div className="flex w-max gap-1.5">
          <ScopeChip on={allMode} onClick={() => setScope(null)}>
            {t.guests.list.allScope}
          </ScopeChip>
          {events.map((e) => (
            <ScopeChip key={e.id} on={scope === e.id} onClick={() => setScope(e.id)}>
              {e.name}
            </ScopeChip>
          ))}
        </div>
      </div>
      <div className="flex-none px-4 lg:flex lg:items-center lg:gap-3 lg:pb-3">
        <div className="pb-[10px] lg:max-w-[300px] lg:flex-1 lg:pb-0">
          <Field icon="search" placeholder={t.guests.list.searchPlaceholder} value={q} onChange={setQ} />
        </div>
        {scopeEvent && (
          <div className="flex gap-2 pb-3 lg:ml-auto lg:pb-0">
            <Btn sm kind="primary" icon="plus" onClick={() => nav.push('quickadd', { id: scopeEvent.id })}>
              {t.guests.list.addGuest}
            </Btn>
            <Btn sm kind="quiet" icon="paste" onClick={() => nav.push('bulk', { id: scopeEvent.id })}>
              {t.guests.list.pasteList}
            </Btn>
            <Btn sm kind="quiet" icon="contact" onClick={() => nav.push('contacten', { id: scopeEvent.id })}>
              {t.guests.list.contacts}
            </Btn>
          </div>
        )}
      </div>
      {loading ? (
        <Scroll pad={16} bottom={24}>
          <Empty text={t.guests.list.loading} />
        </Scroll>
      ) : active.isError ? (
        <Scroll pad={16} bottom={24}>
          <Empty text={t.guests.list.loadError} />
        </Scroll>
      ) : gs.length === 0 ? (
        <Scroll pad={16} bottom={24}>
          <Empty text={q ? t.guests.list.emptyFiltered : t.guests.list.empty} />
        </Scroll>
      ) : (
        <>
          <GuestCardList rows={gs} selected={EMPTY_SELECTION} onAct={openGuest} onToggle={noop} />
          <GuestTable rows={gs} selected={EMPTY_SELECTION} onOpen={openGuest} onToggle={noop} />
        </>
      )}
    </div>
  );
}

/** Pick one tier and apply it to N selected guests. */
function BulkTierSheet({
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
function GuestCardList({
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
                  <RoleChip role={g.role} />
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
function GuestTable({
  rows,
  selected,
  onOpen,
  onToggle,
}: {
  rows: GuestT[];
  selected: Set<string>;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
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
  return (
    <div ref={scrollRef} className="po-scroll hidden min-h-0 flex-1 overflow-y-auto lg:block" style={{ padding: '0 16px 24px' }}>
      <div className="overflow-hidden rounded-[16px] border border-line bg-elev">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-[1]">
            <tr className={cn('grid bg-elev2', cols, '[&>th]:px-3 [&>th]:py-[11px] [&>th]:font-body [&>th]:text-[11px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-[0.04em] [&>th]:text-faint')}>
              <th className="!pl-3" />
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
                    onClick={(e) => { e.stopPropagation(); onToggle(g.id); }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggle(g.id);
                      }}
                      aria-label={isSelected ? 'Deselect' : 'Select'}
                      className={cn(
                        'flex h-[20px] w-[20px] items-center justify-center rounded-full border-2 transition-colors',
                        isSelected ? 'border-acc bg-acc' : 'border-ghost bg-transparent opacity-25 group-hover:opacity-100',
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
                    <RoleChip role={g.role} />
                  </td>
                  <td>{g.pay === 'pay' ? <PayChip pay="pay" /> : <span className="text-[12.5px] text-faint">—</span>}</td>
                  <td>
                    <span className="text-[13px] text-dim">{g.by || '—'}</span>
                    {g.addedAt && <span className="ml-1.5 font-display text-[12px] text-faint">{g.addedAt}</span>}
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

// ── BULK PASTE (#33) ─────────────────────────────────────────────────────────
interface ResolvedRow {
  name: string;
  plusOnes: number;
  tierId: string;
  needsChoice: boolean;
}

/** Fold a parsed line + the user's chip choice into a final addable row. */
function resolveRow(r: ParseResult, choice: AmbiguityChoice | undefined, defaultTierId: string): ResolvedRow {
  if (r.status === 'ambiguous') {
    if (!choice) return { name: r.name, plusOnes: r.plusOnes, tierId: defaultTierId, needsChoice: true };
    const res = resolveAmbiguity(r, choice, defaultTierId);
    return { name: res.name, plusOnes: res.plusOnes, tierId: res.tierId, needsChoice: false };
  }
  return { name: r.name, plusOnes: r.plusOnes, tierId: r.tierId ?? defaultTierId, needsChoice: false };
}

export function BulkPaste({ eventId }: { eventId?: string }): JSX.Element {
  const nav = useNav();
  const { data: liveEvents = [] } = usePoEvents();
  const upcoming = liveEvents.filter((e) => e.when === 'upcoming');
  const curEv = liveEvents.find((e) => e.id === eventId) ?? upcoming[0] ?? liveEvents[0];
  const evId = curEv?.id ?? '';

  const { data: tiers = [] } = usePoTiers(evId);
  const { data: quota } = usePoQuota(evId);
  const { data: evGuests = [] } = usePoGuests(evId);
  const addBulk = usePoAddGuestsBulk(evId);
  const update = usePoUpdateGuest(evId);

  const qaTiers: QuickAddTier[] = tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases }));
  const defaultTierId = resolveDefaultTierId(qaTiers);

  const [text, setText] = useState('');
  const [choices, setChoices] = useState<Record<number, AmbiguityChoice>>({});
  const [dupeMode, setDupeMode] = useState<DupeMode>('add');
  const [busy, setBusy] = useState(false);
  const [orchErr, setOrchErr] = useState<string | null>(null);

  const rows = defaultTierId ? parseBulk(text, qaTiers, defaultTierId) : [];
  const resolvedRows = rows.map((r, i) => resolveRow(r, choices[i], defaultTierId ?? ''));
  const total = totalSlots(resolvedRows.map((r) => ({ plusOnes: r.plusOnes })));
  const doubtful = resolvedRows.filter((r) => r.needsChoice || r.name === '').length;
  const ready = rows.length - doubtful;

  const byName = useMemo(
    () => indexGuestsByName(evGuests.map((g) => ({ id: g.id, name: g.name, plusOnes: g.plus }))),
    [evGuests],
  );
  const plannable: BulkRowInput[] = resolvedRows
    .map((r, i) => ({ name: r.name, plusOnes: r.plusOnes, tierId: r.tierId, email: rows[i]?.email ?? undefined, phone: rows[i]?.phone ?? undefined }))
    .filter((r) => r.name !== '');
  const dupNames = suspectedDuplicates(plannable, byName);

  const exempt = quota?.exempt ?? false;
  const remaining = exempt ? null : quota?.remaining ?? null;
  const overQuota = remaining !== null && total > remaining;
  const canConfirm = !busy && rows.length > 0 && doubtful === 0 && !overQuota && !!defaultTierId && !!evId;

  const confirm = async (): Promise<void> => {
    if (!canConfirm) return;
    setOrchErr(null);
    setBusy(true);
    const plan = planBulkAdd(plannable, byName, dupeMode);
    try {
      if (plan.inserts.length > 0) {
        await addBulk.mutateAsync({
          eventId: evId,
          source: 'app',
          guests: plan.inserts.map((r) => ({ id: uuidv7(), fullName: r.name, plusOnes: r.plusOnes, tierId: r.tierId, email: r.email, phone: r.phone })),
        });
      }
      for (const u of plan.updates) {
        await update.mutateAsync({ guestId: u.guestId, plusOnes: u.plusOnes });
      }
      setText('');
      setChoices({});
      nav.back();
    } catch (e) {
      setOrchErr(e instanceof Error ? e.message : t.guests.bulk.addFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.guests.bulk.title} sub={curEv ? fmt(t.guests.bulk.subTo, { event: curEv.name }) : t.guests.bulk.subFallback} />
      <Scroll bottom={120}>
        {!curEv ? (
          <Empty text={t.guests.bulk.noUpcoming} />
        ) : !defaultTierId ? (
          <NoTiersBlock eventId={evId} canCreate={exempt} />
        ) : (
          <>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setChoices({});
              }}
              rows={5}
              placeholder={t.guests.bulk.placeholder}
              className="mb-4 w-full resize-y rounded-[14px] border border-line bg-elev p-[14px] font-body text-[14.5px] leading-[1.5] text-text outline-none placeholder:text-faint"
            />
            {rows.length > 0 && (
              <>
                <div className="mb-[10px] flex items-center justify-between">
                  <Label>{fmt(t.guests.bulk.preview, { n: rows.length })}</Label>
                  {doubtful > 0 && <MiniChip className="border-acc text-acc">{fmt(t.guests.bulk.toCheck, { n: doubtful })}</MiniChip>}
                </div>
                <div className="flex flex-col gap-2">
                  {rows.map((r, i) => {
                    const res = resolvedRows[i];
                    const ask = res.needsChoice;
                    const tier = tiers.find((t) => t.id === res.tierId);
                    return (
                      <div key={i} className={cn('rounded-[14px] border bg-elev p-[12px]', ask ? 'border-acc' : 'border-line')}>
                        <div className="flex items-center gap-[11px]">
                          <Avatar name={res.name || r.raw} size={34} accent={tier?.role === 'VIP'} />
                          <div className="min-w-0 flex-1">
                            <div className="font-display text-[14.5px] font-bold text-text">
                              {res.name || r.raw}
                              {res.plusOnes > 0 && <span className="text-faint"> +{res.plusOnes}</span>}
                            </div>
                            <div className={cn('mt-0.5 text-[11.5px]', ask ? 'text-acc' : 'text-faint')}>
                              {ask ? fmt(t.guests.bulk.rowUnknown, { x: r.ambiguous?.text ?? '' }) : tier?.short ?? '—'}
                            </div>
                          </div>
                          {!ask &&
                            (byName.has(res.name.trim().toLowerCase()) ? (
                              <MiniChip className="border-acc text-acc">{t.guests.bulk.rowAlreadyOnList}</MiniChip>
                            ) : (
                              <span className="text-acc">
                                <Icon name="check2" size={17} stroke="#B5A6FF" sw={2.2} />
                              </span>
                            ))}
                        </div>
                        {ask && r.ambiguous && (
                          <div className="mt-[11px] flex flex-wrap gap-[7px]">
                            {r.ambiguous.suggestions.map((s) => (
                              <button
                                key={s.tierId}
                                type="button"
                                onClick={() => setChoices((c) => ({ ...c, [i]: { kind: 'tier', tierId: s.tierId } }))}
                                className={cn('flex-1 rounded-[10px] border border-line bg-elev2 py-[9px] font-display text-[12.5px] font-bold text-text', press)}
                              >
                                {s.tierName}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => setChoices((c) => ({ ...c, [i]: { kind: 'default' } }))}
                              className={cn('flex-1 rounded-[10px] border border-line bg-elev2 py-[9px] font-display text-[12.5px] font-bold text-text', press)}
                            >
                              {tiers.find((x) => x.id === defaultTierId)?.short ?? t.guests.bulk.rowChoiceDefault}
                            </button>
                            <button
                              type="button"
                              onClick={() => setChoices((c) => ({ ...c, [i]: { kind: 'name' } }))}
                              className={cn('flex-1 rounded-[10px] border border-line bg-elev2 py-[9px] font-display text-[12.5px] font-bold text-text', press)}
                            >
                              {t.guests.bulk.rowChoiceName}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {dupNames.length > 0 && (
                  <div className="mt-4 rounded-[16px] border border-acc bg-acc-dim p-[14px]">
                    <div className="mb-1 flex items-center gap-2">
                      <Icon name="warn" size={16} stroke="#B5A6FF" />
                      <Label className="text-acc-soft">
                        {fmt(t.guests.bulk.dupeHeader, { n: dupNames.length })}
                      </Label>
                    </div>
                    <div className="mb-3 flex flex-wrap gap-1.5">
                      {dupNames.slice(0, 12).map((n) => (
                        <MiniChip key={n} className="border-transparent bg-bg text-text">
                          {n}
                        </MiniChip>
                      ))}
                      {dupNames.length > 12 && (
                        <MiniChip className="border-transparent bg-bg text-faint">+{dupNames.length - 12}</MiniChip>
                      )}
                    </div>
                    <div className="mb-2 text-[12.5px] font-semibold text-text">{t.guests.bulk.dupeWhatToDo}</div>
                    <div className="flex flex-col gap-1.5">
                      <DupeOption on={dupeMode === 'add'} onClick={() => setDupeMode('add')} title={t.guests.bulk.dupeAddTitle} sub={t.guests.bulk.dupeAddSub} />
                      <DupeOption on={dupeMode === 'replace'} onClick={() => setDupeMode('replace')} title={t.guests.bulk.dupeReplaceTitle} sub={t.guests.bulk.dupeReplaceSub} />
                      <DupeOption on={dupeMode === 'again'} onClick={() => setDupeMode('again')} title={t.guests.bulk.dupeAgainTitle} sub={t.guests.bulk.dupeAgainSub} />
                    </div>
                  </div>
                )}
                {!exempt && remaining !== null && (
                  <div className={cn('mt-3 text-[12.5px]', overQuota ? 'text-acc-soft' : 'text-faint')}>
                    {fmt(t.guests.bulk.quotaLine, { total, slots: total === 1 ? t.guests.bulk.slotOne : t.guests.bulk.slotMany, remaining })}
                    {overQuota && t.guests.bulk.quotaBlocked}
                  </div>
                )}
                {(addBulk.isError || orchErr) && (
                  <div className="mt-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
                    <Icon name="warn" size={16} stroke="#B5A6FF" />
                    <span className="flex-1">{orchErr ?? addBulk.error?.message}</span>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Scroll>
      <BottomBar>
        <Btn kind="primary" full icon="check" onClick={() => void confirm()} className={canConfirm ? '' : 'opacity-[0.45]'}>
          {busy
            ? t.guests.bulk.busy
            : doubtful > 0
              ? fmt(t.guests.bulk.submitOpen, { ready, open: doubtful })
              : dupNames.length > 0
                ? fmt(t.guests.bulk.submitProcess, { ready, lines: ready === 1 ? t.guests.bulk.lineOne : t.guests.bulk.lineMany })
                : fmt(t.guests.bulk.submitAdd, { ready, guests: ready === 1 ? t.guests.bulk.guestOne : t.guests.bulk.guestMany })}
        </Btn>
      </BottomBar>
    </div>
  );
}

// ── PERMANENTE GASTEN (pushed) ───────────────────────────────────────────────
export function Vaste(): JSX.Element {
  const nav = useNav();
  const { roles } = usePoIdentity();
  const canView = roles.includes('admin') || roles.includes('finance');
  const { data: list = [], isLoading, isError } = usePoPermanentContacts();
  const toggleVast = usePoToggleContactPermanent();
  const sync = usePoSyncPermanent();
  const { data: liveEvents = [] } = usePoEvents();
  const upcoming = liveEvents.filter((e) => e.when === 'upcoming');
  const permanent = list ?? [];
  const noRights = !isLoading && !isError && !canView && permanent.length === 0;

  const [pick, setPick] = useState(false);
  const [result, setResult] = useState<{ event: string; added: number; total: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runSync = (evId: string, evName: string): void => {
    setErrorMsg(null);
    setResult(null);
    const total = permanent.length;
    sync.mutate(
      { eventId: evId },
      {
        onSuccess: (res) => {
          setPick(false);
          setResult({ event: evName, added: res.ok ? res.added : 0, total });
        },
        onError: (e) => setErrorMsg(e instanceof Error ? e.message : t.guests.permanent.syncFailed),
      },
    );
  };

  return (
    <div className={col}>
      <Top
        onBack={nav.back}
        title={t.guests.permanent.title}
        sub={fmt(t.guests.permanent.sub, { n: permanent.length, guests: permanent.length === 1 ? t.guests.permanent.guestOne : t.guests.permanent.guestMany })}
        right={<IconBtn name="plus" onClick={() => nav.push('contacten')} />}
      />
      <Scroll bottom={24}>
        <div className="mb-4 flex gap-[12px] rounded-[16px] bg-acc-dim p-[15px]">
          <Icon name="star" size={20} stroke="#B5A6FF" fill="#B5A6FF" />
          <div className="text-[13.5px] leading-[1.45] text-text">
            {t.guests.permanent.blurb}
          </div>
        </div>

        {result && (
          <div className="mb-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
            <Icon name="check" size={16} stroke="#B5A6FF" />
            <span className="flex-1">
              {result.added === 0
                ? fmt(t.guests.permanent.resultNoneAdded, { event: result.event })
                : result.added === result.total
                  ? fmt(t.guests.permanent.resultAllAdded, { total: result.total, guests: result.total === 1 ? t.guests.permanent.guestOneLabel : t.guests.permanent.guestManyLabel, event: result.event })
                  : fmt(t.guests.permanent.resultPartial, { added: result.added, total: result.total, event: result.event })}
            </span>
          </div>
        )}
        {errorMsg && (
          <div className="mb-3 flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
            <Icon name="warn" size={16} stroke="#B5A6FF" />
            <span className="flex-1">{errorMsg}</span>
          </div>
        )}

        {!isLoading && !isError && permanent.length > 0 && (
          <Btn kind="dark" full icon="cal" className="mb-4" disabled={sync.isPending} onClick={() => setPick(true)}>
            {sync.isPending ? t.guests.permanent.addNowBusy : t.guests.permanent.addNow}
          </Btn>
        )}

        {isLoading ? (
          <Empty text={t.guests.permanent.loading} />
        ) : noRights ? (
          <Note icon="shield">
            {t.guests.permanent.noRights}
          </Note>
        ) : isError ? (
          <Empty text={t.guests.permanent.loadError} />
        ) : permanent.length === 0 ? (
          <Empty text={t.guests.permanent.empty} />
        ) : (
          <div className="flex flex-col gap-[9px]">
            {permanent.map((c) => {
              const removing = toggleVast.isPending && toggleVast.variables?.contactId === c.id;
              return (
                <div key={c.id} className="flex items-center gap-[12px] rounded-[16px] border border-line bg-elev p-[12px]">
                  <Avatar name={c.name} size={42} accent />
                  <div className="flex-1">
                    <div className="font-display text-[15.5px] font-bold text-text">{c.name}</div>
                    <div className="mt-[3px] text-[12px] text-faint">{fmt(t.guests.permanent.autoRole, { role: c.role })}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleVast.mutate({ contactId: c.id, isPermanent: false })}
                    disabled={removing}
                    title={t.guests.permanent.removeRegular}
                    className={cn('flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line text-faint', press)}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Scroll>

      {pick && (
        <Sheet onClose={() => setPick(false)} center={false}>
          <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.guests.permanent.syncTitle}</div>
          <div className="mb-4 text-[13px] text-faint">{t.guests.permanent.syncSub}</div>
          {upcoming.length === 0 ? (
            <Empty text={t.guests.permanent.noUpcoming} />
          ) : (
            <div className="flex flex-col gap-2">
              {upcoming.map((e) => (
                <button key={e.id} type="button" disabled={sync.isPending} onClick={() => runSync(e.id, e.name)} className={cn('flex items-center gap-[12px] rounded-[12px] border border-line bg-elev px-[13px] py-[12px] text-left', press)}>
                  <span className="w-[38px] shrink-0 text-center">
                    <span className="block font-display text-[16px] font-extrabold leading-none text-text">{e.date}</span>
                    <span className="block text-[9px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-[14.5px] font-bold text-text">{e.name}</span>
                    <span className="block text-[11.5px] text-faint">{e.venue}</span>
                  </span>
                  <Icon name="chev" size={16} className="text-ghost" />
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
