'use client';

import { type JSX, useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { Guest as GuestT } from '@/lib/po/types';
import { usePoEvent, usePoEvents, usePoGuests, useVenueGuests, usePoTiers, usePoPermanentContacts, usePoCanManageTemplates } from '@/features/po/hooks';
import {
  usePoChangeGuestsTierBulk,
  usePoMarkGuestsRegular,
} from '@/features/po/mutations';
import { t, fmt } from '@/lib/i18n';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Btn, Empty, Field, IconBtn, Scroll, Top } from '../../kit';
import { Sheet } from '../../shell';
import { press, col } from './_shared';
import { useGuestSelection, GuestBulkBar, BulkAddToEventSheet, type BulkAddCandidate } from './bulk-add';
import { GuestScopeChips, BulkTierSheet, GuestCardList, GuestTable } from './list-shared';

// QuickAdd is intentionally NOT re-exported here (#2b): the app shell code-splits
// it via `next/dynamic` straight from './quick-add'. Re-exporting it would pull
// the quick-add + phone chunks back into the common GuestsTab bundle.
export { ContactProfile, Contacten } from './profile';
// Paste a list (#33) lives in its own module (share-import S2 grew it past what
// this file could hold under the 800-LOC line); re-exported for the shell.
export { BulkPaste } from './bulk-paste';

// ── GUEST LIST (Guests tab) ──────────────────────────────────────────────────

/** Pure search filter for the gastenlijst — extracted so it's memoizable + testable. */
function filterGuestList(guests: GuestT[], q: string): GuestT[] {
  const term = q.trim().toLowerCase();
  return term ? guests.filter((g) => g.name.toLowerCase().includes(term)) : guests;
}

// Regulars is a FILTER inside the Guests tab now (feedback 1/7: "geen los
// More-scherm"), not a separate screen. The More cluster still has a "Regulars"
// entry — it switches to the Guests tab and pre-arms this filter via a one-shot
// sessionStorage flag (Capacitor-safe: guarded, degrades to no-op). Set from
// settings.tsx, consumed once by GuestsTab on mount.
const GUESTS_REGULARS_FLAG = 'po:guests-regulars';

/** Set the one-shot "open Guests on the Regulars filter" flag (called before
 *  switching to the Guests tab from the More cluster). */
export function armRegularsFilter(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(GUESTS_REGULARS_FLAG, '1');
  } catch {
    /* private mode / no storage — the tab just opens unfiltered */
  }
}

/** Read + clear the flag (once), so a later manual visit to Guests isn't filtered. */
function consumeRegularsFlag(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.sessionStorage.getItem(GUESTS_REGULARS_FLAG)) {
      window.sessionStorage.removeItem(GUESTS_REGULARS_FLAG);
      return true;
    }
  } catch {
    /* unavailable storage */
  }
  return false;
}

/**
 * The Guests TAB — also the target of the per-event "Guest list" push from
 * EventView (G4: merged from the old standalone `Lijst`, which was a thin,
 * fully-redundant wrapper around this same component in single-event scope).
 * Defaults to ALL guests across the venue's events (each row badged with its
 * event), with an event picker to scope to one. Fixes the "tab auto-opened an
 * empty event with no way to switch" trap (feedback Max): you always land on a
 * populated list. RLS still scopes staff to their own guests. Add affordances
 * need an event, so they appear only once one is picked.
 *
 * `pinnedEventId` is set when pushed from an event (EventView's "Guest list"
 * button): the scope starts (and stays) fixed to that event — no scope-chip
 * row, no wandering to other events — and a back button returns to the event,
 * exactly like the old `Lijst`'s UI.
 */
export function GuestsTab({ pinnedEventId }: { pinnedEventId?: string } = {}): JSX.Element {
  const nav = useNav();
  const { data: events = [], isLoading: eventsLoading } = usePoEvents();
  const [scope, setScope] = useState<string | null>(pinnedEventId ?? null);
  const [q, setQ] = useState('');
  const [regularsOnly, setRegularsOnly] = useState(consumeRegularsFlag);
  const dq = useDebouncedValue(q, 140);

  const allMode = scope === null;
  // All-events mode is a server-windowed working set searched server-side (86ey9e8hz):
  // the debounced term goes to the query so a match outside the window is still
  // found, instead of downloading the whole venue and filtering in the browser.
  const venue = useVenueGuests(allMode ? events : [], dq);
  const single = usePoGuests(scope ?? '');
  const active = allMode ? venue : single;
  const guests = useMemo<GuestT[]>(
    () => (allMode ? venue.data?.guests : single.data) ?? [],
    [allMode, venue.data, single.data],
  );

  // Regulars = guests whose linked contact is starred permanent (#11). Manager-only
  // read (RLS); staff get [] → the filter simply yields nothing for them.
  const { data: permanentContacts = [] } = usePoPermanentContacts();
  const permanentIds = useMemo(() => new Set(permanentContacts.map((c) => c.id)), [permanentContacts]);
  const gs = useMemo(() => {
    // All-events already filtered by name on the server; single-event holds the
    // whole event locally, so it keeps the client-side name filter.
    const searched = allMode ? guests : filterGuestList(guests, dq);
    return regularsOnly ? searched.filter((g) => g.contactId && permanentIds.has(g.contactId)) : searched;
  }, [allMode, guests, dq, regularsOnly, permanentIds]);
  const loading = active.isLoading || (allMode && eventsLoading);

  // Pinned (pushed from an event, Snelheid P1): read that ONE event — seeded from
  // the cached venue list, otherwise a single row — instead of waiting for the
  // venue's whole event list. Until it has loaded, the add/paste/tier actions
  // stay disabled, so a fast tap can't fall through to the all-events picker.
  const pinned = usePoEvent(pinnedEventId ?? '');
  const scopeEvent = pinnedEventId ? pinned.event : events.find((e) => e.id === scope) ?? null;
  const pinWaiting = !!pinnedEventId && !scopeEvent;
  const upcoming = useMemo(() => events.filter((e) => e.when === 'upcoming'), [events]);
  // Total is the venue-wide match count (from the server) in all-events mode, the
  // loaded event size in single-event mode — the "of N" in the subtitle.
  const total = allMode ? venue.data?.total ?? guests.length : guests.length;
  const countSub = fmt(t.guests.list.sub, { shown: gs.length, total });

  // Add-guest on the "All events" scope (M10, K-16): no event is picked here, so
  // route through the same event-picker sheet Home's "New guest" uses, then land
  // on the ordinary quickadd flow.
  // The same picker serves "Add guest" and "Paste a list" (item N) — only the
  // screen it lands on differs, so the target rides along in state.
  const [pickTarget, setPickTarget] = useState<'quickadd' | 'bulk' | null>(null);
  const [pickQuery, setPickQuery] = useState('');
  const pickOpen = pickTarget !== null;
  const pickMatches = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    return q ? upcoming.filter((e) => e.name.toLowerCase().includes(q)) : upcoming;
  }, [upcoming, pickQuery]);
  const openPicker = (target: 'quickadd' | 'bulk'): void => {
    setPickQuery('');
    setPickTarget(target);
  };
  const addGuestClick = (): void => {
    if (pinWaiting) return;
    if (scopeEvent) nav.push('quickadd', { id: scopeEvent.id });
    else openPicker('quickadd');
  };
  const pasteListClick = (): void => {
    if (pinWaiting) return;
    if (scopeEvent) nav.push('bulk', { id: scopeEvent.id });
    else openPicker('bulk');
  };

  // ── Multi-select + bulk actions ──
  const { selected, toggle, clear, selectAll } = useGuestSelection();
  const markRegular = usePoMarkGuestsRegular();
  const canManageRegulars = usePoCanManageTemplates();
  const changeBulkTier = usePoChangeGuestsTierBulk(scope ?? '');
  const { data: scopeTiers = [] } = usePoTiers(scope ?? '');
  const [bulkTierOpen, setBulkTierOpen] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const [regularMsg, setRegularMsg] = useState<string | null>(null);

  const selectedPeople: BulkAddCandidate[] = useMemo(
    // z8uq9m2x43: a forgotten (anonymized) guest never goes onto another event —
    // the DB refuses it anyway (guests_contact_same_venue), so keep it out of
    // the batch instead of surfacing a per-row failure.
    () => guests.filter((g) => selected.has(g.id) && !g.anonymized).map((g) => ({ key: g.id, name: g.name, contactId: g.contactId ?? null, plus: g.plus })),
    [guests, selected],
  );

  const openGuest = (id: string): void => {
    const g = guests.find((x) => x.id === id);
    nav.push('guest', { id, eventId: g?.eventId ?? scope ?? '' });
  };
  const onCardAct = (id: string): void => {
    if (selected.size > 0) toggle(id);
    else openGuest(id);
  };

  const runMarkRegular = (): void => {
    setRegularMsg(null);
    markRegular.mutate(
      { guestIds: Array.from(selected) },
      {
        onSuccess: (res) => {
          setRegularMsg(
            res.failed > 0
              ? fmt(t.guests.multiSelect.regularPartial, { done: res.done, failed: res.failed })
              : fmt(t.guests.multiSelect.regularDone, { n: res.done }),
          );
          clear();
        },
        onError: (e) => setRegularMsg(e instanceof Error ? e.message : t.guests.multiSelect.regularFailed),
      },
    );
  };

  const applyBulkTier = (tierId: string): void => {
    if (!scope) return;
    setBulkErr(null);
    changeBulkTier.mutate(
      { guestIds: Array.from(selected), tierId, eventId: scope },
      {
        onSuccess: () => { clear(); setBulkTierOpen(false); },
        onError: (e) => setBulkErr(e instanceof Error ? e.message : t.guests.multiSelect.tierFailed),
      },
    );
  };

  const hasSelection = selected.size > 0;

  return (
    <div className={col}>
      <Top
        onBack={pinnedEventId ? (nav.canGoBack ? nav.back : undefined) : undefined}
        title={t.guests.list.title}
        sub={scopeEvent ? `${scopeEvent.name} · ${countSub}` : countSub}
        right={<IconBtn name="plus" ariaLabel={t.guests.list.addGuest} onClick={addGuestClick} disabled={pinWaiting} />}
      />
      {/* Pinned mode (pushed from an event): single fixed scope, no chip row —
          mirrors the old standalone `Lijst`'s UI exactly. */}
      {!pinnedEventId && (
        <GuestScopeChips
          events={events}
          scope={scope}
          onScope={setScope}
          regularsOnly={regularsOnly}
          onToggleRegulars={() => setRegularsOnly((v) => !v)}
        />
      )}
      <div className="flex-none px-4 md:flex md:items-center md:gap-3 md:pb-3">
        {hasSelection ? (
          <GuestBulkBar
            count={selected.size}
            onSelectAll={() => selectAll(gs.map((g) => g.id))}
            onChangeTier={scopeEvent ? () => { setBulkErr(null); setBulkTierOpen(true); } : null}
            onMarkRegular={canManageRegulars ? runMarkRegular : null}
            onAddToEvent={() => setBulkAddOpen(true)}
            onCancel={clear}
            markBusy={markRegular.isPending}
          />
        ) : (
          <>
            <div className="pb-[10px] md:max-w-[300px] md:flex-1 md:pb-0">
              <Field icon="search" placeholder={t.guests.list.searchPlaceholder} value={q} onChange={setQ} />
            </div>
            <div className="flex flex-wrap gap-2 pb-3 md:ml-auto md:flex-nowrap md:pb-0">
              <Btn sm kind="primary" icon="plus" onClick={addGuestClick} disabled={pinWaiting}>
                {t.guests.list.addGuest}
              </Btn>
              {/* Item N: a labelled button, always there — on "All events" it
                  routes through the same event picker "Add guest" uses. */}
              <Btn sm kind="ghost" icon="paste" onClick={pasteListClick} disabled={pinWaiting}>
                {t.guests.list.pasteList}
              </Btn>
              {scopeEvent && (
                <Btn sm kind="quiet" icon="contact" onClick={() => nav.push('contacten', { id: scopeEvent.id })}>
                  {t.guests.list.contacts}
                </Btn>
              )}
            </div>
          </>
        )}
      </div>
      {regularMsg && (
        <div className="flex-none px-4 pb-2">
          <div className="flex items-center gap-2 rounded-[11px] border border-acc bg-acc-dim px-[12px] py-[9px] text-[12.5px] text-text">
            <Icon name="star" size={14} stroke="#B5A6FF" fill="#B5A6FF" />
            <span className="flex-1">{regularMsg}</span>
            <button type="button" onClick={() => setRegularMsg(null)} aria-label={t.guests.contacts.cancel}>
              <Icon name="close" size={14} className="text-faint" />
            </button>
          </div>
        </div>
      )}
      {hasSelection && !scopeEvent && !pinnedEventId && (
        <div className="flex-none px-4 pb-2 text-[11.5px] text-faint">{t.guests.multiSelect.changeTierAllScope}</div>
      )}
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
          <Empty text={regularsOnly ? t.guests.list.emptyRegulars : q ? t.guests.list.emptyFiltered : t.guests.list.empty} />
        </Scroll>
      ) : (
        <>
          <GuestCardList rows={gs} selected={selected} onAct={onCardAct} onToggle={toggle} />
          <GuestTable
            rows={gs}
            selected={selected}
            onOpen={openGuest}
            onToggle={toggle}
            onToggleAll={() => (gs.length > 0 && gs.every((g) => selected.has(g.id)) ? clear() : selectAll(gs.map((g) => g.id)))}
          />
        </>
      )}
      {bulkTierOpen && scopeEvent && (
        <BulkTierSheet
          count={selected.size}
          tiers={scopeTiers}
          isPending={changeBulkTier.isPending}
          err={bulkErr}
          onPick={applyBulkTier}
          onClose={() => setBulkTierOpen(false)}
        />
      )}
      {bulkAddOpen && (
        <BulkAddToEventSheet
          people={selectedPeople}
          upcoming={upcoming}
          defaultEventId={scope ?? undefined}
          onClose={() => setBulkAddOpen(false)}
          onDone={clear}
        />
      )}
      {pickOpen && (
        <Sheet onClose={() => setPickTarget(null)}>
          <h2 className="mb-4 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
            {pickTarget === 'bulk' ? t.guests.list.pickEventForPaste : t.home.pickEventForGuest}
          </h2>
          {upcoming.length === 0 ? (
            <p className="py-6 text-center text-[14px] text-faint">{t.home.noUpcomingToday}</p>
          ) : (
            <>
              <div className="mb-3 flex w-full items-center gap-[11px] rounded-[14px] border border-line bg-bg px-[15px] py-[11px]">
                <Icon name="search" size={19} className="shrink-0 text-faint" />
                <input
                  value={pickQuery}
                  onChange={(e) => setPickQuery(e.target.value)}
                  placeholder={t.home.searchEvents}
                  className="min-w-0 flex-1 bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint"
                />
              </div>
              {pickMatches.length === 0 ? (
                <p className="py-5 text-center text-[14px] text-faint">{t.home.emptyFilteredTitle}</p>
              ) : (
                <div className="flex w-full flex-col gap-2">
                  {pickMatches.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => {
                        const target = pickTarget ?? 'quickadd';
                        setPickTarget(null);
                        nav.push(target, { id: e.id });
                      }}
                      className={cn(
                        'flex w-full items-center gap-[12px] rounded-[12px] border border-line bg-elev px-[13px] py-[11px] text-left',
                        press,
                      )}
                    >
                      <span className="w-[36px] shrink-0 text-center">
                        <span className="block font-display text-[16px] font-extrabold leading-none text-text">{e.date}</span>
                        <span className="block text-[9px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-[14.5px] font-bold text-text">{e.name}</div>
                        <div className="mt-0.5 text-[12px] text-faint">{fmt(t.home.doorAt, { time: e.time })}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
