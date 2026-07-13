'use client';

import { useState, useMemo } from 'react';
import { v7 as uuidv7 } from 'uuid';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { Guest as GuestT } from '@/lib/po/types';
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
import { usePoEvents, usePoGuests, useVenueGuests, usePoTiers, usePoQuota, usePoPermanentContacts, usePoCanManageTemplates } from '@/features/po/hooks';
import {
  usePoAddGuestsBulk,
  usePoUpdateGuest,
  usePoChangeGuestsTierBulk,
  usePoMarkGuestsRegular,
} from '@/features/po/mutations';
import { findEventGuestsByNames } from '@/features/po/queries';
import { createClient } from '@/lib/supabase/client';
import { captureUnexpectedError } from '@/lib/observability/capture';
import { t, fmt } from '@/lib/i18n';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Avatar, Btn, Empty, Field, IconBtn, Label, MiniChip, Scroll, Top } from '../../kit';
import { BottomBar, Sheet } from '../../shell';
import { DupeOption, NoTiersBlock, press, col } from './_shared';
import { useGuestSelection, GuestBulkBar, BulkAddToEventSheet, type BulkAddCandidate } from './bulk-add';
import { ScopeChip, BulkTierSheet, GuestCardList, GuestTable } from './list-shared';

export { QuickAdd } from './quick-add';
export { ContactProfile, Contacten } from './profile';

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
  const venue = useVenueGuests(allMode ? events : []);
  const single = usePoGuests(scope ?? '');
  const active = allMode ? venue : single;
  const guests = useMemo(() => active.data ?? [], [active.data]);

  // Regulars = guests whose linked contact is starred permanent (#11). Manager-only
  // read (RLS); staff get [] → the filter simply yields nothing for them.
  const { data: permanentContacts = [] } = usePoPermanentContacts();
  const permanentIds = useMemo(() => new Set(permanentContacts.map((c) => c.id)), [permanentContacts]);
  const gs = useMemo(() => {
    const searched = filterGuestList(guests, dq);
    return regularsOnly ? searched.filter((g) => g.contactId && permanentIds.has(g.contactId)) : searched;
  }, [guests, dq, regularsOnly, permanentIds]);
  const loading = active.isLoading || (allMode && eventsLoading);

  const scopeEvent = events.find((e) => e.id === scope) ?? null;
  const upcoming = useMemo(() => events.filter((e) => e.when === 'upcoming'), [events]);
  const countSub = fmt(t.guests.list.sub, { shown: gs.length, total: guests.length });

  // Add-guest on the "All events" scope (M10, K-16): no event is picked here, so
  // route through the same event-picker sheet Home's "New guest" uses, then land
  // on the ordinary quickadd flow.
  const [pickOpen, setPickOpen] = useState(false);
  const [pickQuery, setPickQuery] = useState('');
  const pickMatches = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    return q ? upcoming.filter((e) => e.name.toLowerCase().includes(q)) : upcoming;
  }, [upcoming, pickQuery]);
  const addGuestClick = (): void => {
    if (scopeEvent) nav.push('quickadd', { id: scopeEvent.id });
    else {
      setPickQuery('');
      setPickOpen(true);
    }
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
    () => guests.filter((g) => selected.has(g.id)).map((g) => ({ key: g.id, name: g.name, contactId: g.contactId ?? null, plus: g.plus })),
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
        right={<IconBtn name="plus" ariaLabel={t.guests.list.addGuest} onClick={addGuestClick} />}
      />
      {/* Pinned mode (pushed from an event): single fixed scope, no chip row —
          mirrors the old standalone `Lijst`'s UI exactly. */}
      {!pinnedEventId && (
        <div className="flex-none overflow-x-auto px-4 pb-3">
          <div className="flex w-max items-center gap-1.5">
            <ScopeChip on={allMode} onClick={() => setScope(null)}>
              {t.guests.list.allScope}
            </ScopeChip>
            {events.map((e) => (
              <ScopeChip key={e.id} on={scope === e.id} onClick={() => setScope(e.id)}>
                {e.name}
              </ScopeChip>
            ))}
            <span className="mx-1 h-4 w-px shrink-0 bg-line" />
            <button
              type="button"
              onClick={() => setRegularsOnly((v) => !v)}
              aria-pressed={regularsOnly}
              className={cn(
                'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-[7px] font-display text-[12.5px] font-bold transition-[filter] hover:brightness-[1.07]',
                regularsOnly ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-transparent text-dim',
              )}
            >
              <Icon name="star" size={12} fill={regularsOnly ? '#B5A6FF' : 'none'} stroke={regularsOnly ? '#B5A6FF' : 'currentColor'} />
              {t.guests.list.regularsFilter}
            </button>
          </div>
        </div>
      )}
      <div className="flex-none px-4 lg:flex lg:items-center lg:gap-3 lg:pb-3">
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
            <div className="pb-[10px] lg:max-w-[300px] lg:flex-1 lg:pb-0">
              <Field icon="search" placeholder={t.guests.list.searchPlaceholder} value={q} onChange={setQ} />
            </div>
            <div className="flex gap-2 pb-3 lg:ml-auto lg:pb-0">
              <Btn sm kind="primary" icon="plus" onClick={addGuestClick}>
                {t.guests.list.addGuest}
              </Btn>
              {scopeEvent && (
                <>
                  <Btn sm kind="quiet" icon="paste" onClick={() => nav.push('bulk', { id: scopeEvent.id })}>
                    {t.guests.list.pasteList}
                  </Btn>
                  <Btn sm kind="quiet" icon="contact" onClick={() => nav.push('contacten', { id: scopeEvent.id })}>
                    {t.guests.list.contacts}
                  </Btn>
                </>
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
      {hasSelection && !scopeEvent && (
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
        <Sheet onClose={() => setPickOpen(false)}>
          <h2 className="mb-4 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
            {t.home.pickEventForGuest}
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
                        setPickOpen(false);
                        nav.push('quickadd', { id: e.id });
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

// ── Per-row inline fix (parity with the contacts import, T12) ─────────────────
// A pasted e-mail/phone that is broken (Jesse's "name#mail.com", Mila's
// "06-ABC-4567", an obfuscated "x at y dot z", a too-short "020") is silently
// left in the name by the #33 parser. We recover it from the raw line so it lands
// in the editor FLAGGED — the user fixes it inline, or removes the row. Nothing is
// silently dropped or mangled.
const BULK_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BULK_NAME_MAX = 500;

interface RowFix {
  name?: string;
  email?: string;
  phone?: string;
}

/** digits only. */
function bulkDigits(v: string): number {
  return v.replace(/\D/g, '').length;
}
/** A plausible guest phone: 8–15 digits, phone-ish chars only. */
function isValidBulkPhone(v: string): boolean {
  return /^[+()\-\s./0-9]+$/.test(v) && bulkDigits(v) >= 8 && bulkDigits(v) <= 15;
}
/** A CSV cell that is an e-mail ATTEMPT (so it can be flagged, not hidden). */
function isEmailAttempt(cell: string): boolean {
  if (/@/.test(cell)) return true;
  if (!/\s/.test(cell) && /#/.test(cell) && /\.[a-z]{2,}$/i.test(cell)) return true; // name#mail.com
  if (/\bat\b/i.test(cell) && /\bdot\b/i.test(cell)) return true; // x at y dot z
  return false;
}
/** A CSV cell clearly meant as a phone but not a valid one (letters, too short…). */
function isPhoneAttempt(cell: string): boolean {
  return /\d/.test(cell) && bulkDigits(cell) >= 3 && /^[+()\-\s./0-9A-Za-z]+$/.test(cell) && !isValidBulkPhone(cell);
}
/** Remove a captured/attempted fragment from the parser's name string. */
function stripFragment(name: string, frag: string): string {
  return name.replace(frag, '').replace(/\s{2,}/g, ' ').trim();
}

export interface BulkRowView {
  name: string;
  email: string;
  phone: string;
  /** null = valid; else why it can't be added yet. */
  error: string | null;
}

/** Recover broken contact info from the raw line, apply the user's inline edit,
 *  then validate exactly like addGuestSchema (name ≤500, e-mail/phone shape). */
export function buildBulkRow(r: ParseResult, resolvedName: string, ed: RowFix | undefined): BulkRowView {
  let name = resolvedName;
  let email = r.email ?? '';
  let phone = r.phone ?? '';
  for (const c of r.raw.split(/[,;\t]/).map((x) => x.trim()).filter(Boolean)) {
    if (c === r.email || c === r.phone) continue;
    if (!email && isEmailAttempt(c)) {
      email = c; // keep the raw broken value so it stays flagged for the user to fix
      name = stripFragment(name, c);
    } else if (!phone && isPhoneAttempt(c)) {
      phone = c;
      name = stripFragment(name, c);
    }
  }
  name = (ed?.name ?? name).trim();
  email = (ed?.email ?? email).trim();
  phone = (ed?.phone ?? phone).trim();

  let error: string | null = null;
  if (name === '') error = t.guests.bulk.errName;
  else if (name.length > BULK_NAME_MAX) error = fmt(t.guests.bulk.errNameLong, { n: name.length });
  else if (email !== '' && !BULK_EMAIL_RE.test(email)) error = t.guests.bulk.errEmail;
  else if (phone !== '' && !isValidBulkPhone(phone)) error = t.guests.bulk.errPhone;
  return { name, email, phone, error };
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
  const [edits, setEdits] = useState<Record<number, RowFix>>({});
  const [removed, setRemoved] = useState<Record<number, boolean>>({});
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [dupeMode, setDupeMode] = useState<DupeMode>('add');
  const [busy, setBusy] = useState(false);
  const [orchErr, setOrchErr] = useState<string | null>(null);

  // A fresh paste clears every stale per-row choice / inline edit / removal.
  const resetRows = (): void => {
    setChoices({});
    setEdits({});
    setRemoved({});
    setOpen({});
  };

  const rows = defaultTierId ? parseBulk(text, qaTiers, defaultTierId) : [];
  const resolvedRows = rows.map((r, i) => resolveRow(r, choices[i], defaultTierId ?? ''));
  // Per-row editable view: recovers a broken e-mail/phone from the raw line and
  // validates name/e-mail/phone (parity with the contacts import, T12).
  const views = rows.map((r, i) => buildBulkRow(r, resolvedRows[i].name, edits[i]));
  const activeIdx = rows.map((_, i) => i).filter((i) => !removed[i]);
  const flaggedCount = activeIdx.filter((i) => views[i].error).length;
  const doubtful = activeIdx.filter((i) => resolvedRows[i].needsChoice).length;
  const removedCount = rows.length - activeIdx.length;
  const total = totalSlots(activeIdx.map((i) => ({ plusOnes: resolvedRows[i].plusOnes })));
  const ready = activeIdx.filter((i) => !views[i].error && !resolvedRows[i].needsChoice).length;

  const editRow = (i: number, field: keyof RowFix, value: string): void => {
    setEdits((e) => ({ ...e, [i]: { ...e[i], [field]: value } }));
    setOpen((o) => (o[i] ? o : { ...o, [i]: true }));
  };
  const toggleRow = (i: number): void => setOpen((o) => ({ ...o, [i]: !o[i] }));
  const removeRow = (i: number): void => setRemoved((r) => ({ ...r, [i]: true }));

  const byName = useMemo(
    () => indexGuestsByName(evGuests.map((g) => ({ id: g.id, name: g.name, plusOnes: g.plus }))),
    [evGuests],
  );
  const plannable: BulkRowInput[] = activeIdx
    .filter((i) => !views[i].error && !resolvedRows[i].needsChoice && views[i].name !== '')
    .map((i) => ({ name: views[i].name, plusOnes: resolvedRows[i].plusOnes, tierId: resolvedRows[i].tierId, email: views[i].email || undefined, phone: views[i].phone || undefined }));
  const dupNames = suspectedDuplicates(plannable, byName);

  const exempt = quota?.exempt ?? false;
  const remaining = exempt ? null : quota?.remaining ?? null;
  const overQuota = remaining !== null && total > remaining;
  const canConfirm = !busy && activeIdx.length > 0 && doubtful === 0 && flaggedCount === 0 && !overQuota && !!defaultTierId && !!evId;

  const confirm = async (): Promise<void> => {
    if (!canConfirm) return;
    setOrchErr(null);
    setBusy(true);
    // Authoritative server-side duplicate check AT CONFIRM (86ey8xg4p, follow-up
    // to 86ey8w7ek): `byName` above is only a HINT built from whatever page of
    // evGuests has loaded — on a big/not-yet-loaded event it can miss real
    // duplicates and let the same guest get inserted 3-5x. One batched, indexed
    // RPC call resolves every pasted name against the full RLS-scoped list right
    // before the plan executes. A failure (offline / deploy skew) falls back to
    // the client hint — offline stays quiet, but a missing RPC must reach Sentry
    // or the safeguard would be silently inert in prod.
    let authByName = byName;
    try {
      const names = plannable.map((r) => r.name);
      if (names.length > 0) {
        const matches = await findEventGuestsByNames(createClient(), evId, names);
        authByName = indexGuestsByName(matches);
      }
    } catch (e) {
      captureUnexpectedError(e, { source: 'query', key: 'find_event_guests_by_names' });
    }
    const plan = planBulkAdd(plannable, authByName, dupeMode);
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
      resetRows();
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
                resetRows();
              }}
              rows={5}
              placeholder={t.guests.bulk.placeholder}
              className="mb-4 w-full resize-y rounded-[14px] border border-line bg-elev p-[14px] font-body text-[14.5px] leading-[1.5] text-text outline-none placeholder:text-faint"
            />
            {rows.length > 0 && (
              <>
                <div className="mb-[10px] flex items-center justify-between gap-2">
                  <Label>{fmt(t.guests.bulk.preview, { n: activeIdx.length })}</Label>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {flaggedCount > 0 && <MiniChip className="border-transparent bg-red-300/15 text-red-300">{fmt(t.guests.bulk.needsFixCount, { n: flaggedCount })}</MiniChip>}
                    {doubtful > 0 && <MiniChip className="border-acc text-acc">{fmt(t.guests.bulk.toCheck, { n: doubtful })}</MiniChip>}
                  </div>
                </div>
                {flaggedCount > 0 && (
                  <div className="mb-3 flex gap-[11px] rounded-[13px] border border-red-300/40 bg-red-300/10 p-[13px]">
                    <span className="mt-px shrink-0 text-red-300"><Icon name="warn" size={17} /></span>
                    <div className="text-[12.5px] leading-[1.45] text-text">
                      <span className="font-semibold">{t.guests.bulk.needsFixTitle}</span>
                      <div className="mt-0.5 text-faint">{fmt(flaggedCount === 1 ? t.guests.bulk.needsFixOne : t.guests.bulk.needsFixMany, { n: flaggedCount })}</div>
                    </div>
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {rows.map((r, i) => {
                    if (removed[i]) return null;
                    const res = resolvedRows[i];
                    const view = views[i];
                    const ask = res.needsChoice;
                    const err = view.error;
                    const showEditor = !!err || !!open[i];
                    const tier = tiers.find((tt) => tt.id === res.tierId);
                    const onList = !ask && !err && byName.has(view.name.trim().toLowerCase());
                    return (
                      <div key={i} className={cn('rounded-[14px] border bg-elev', err ? 'border-red-300/45' : ask ? 'border-acc' : 'border-line')}>
                        <div className="flex items-center gap-[11px] p-[12px]">
                          <button type="button" onClick={() => toggleRow(i)} className={cn('flex min-w-0 flex-1 items-center gap-[11px] text-left', press)}>
                            <Avatar name={view.name || r.raw} size={34} accent={tier?.role === 'VIP'} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-display text-[14.5px] font-bold text-text">
                                {view.name || r.raw}
                                {res.plusOnes > 0 && <span className="text-faint"> +{res.plusOnes}</span>}
                              </div>
                              <div className={cn('mt-0.5 truncate text-[11.5px]', err ? 'text-red-300' : ask ? 'text-acc' : 'text-faint')}>
                                {err ? err : ask ? fmt(t.guests.bulk.rowUnknown, { x: r.ambiguous?.text ?? '' }) : tier?.short ?? '—'}
                              </div>
                              {!err && (view.email || view.phone) && (
                                <div className="mt-0.5 flex items-center gap-[5px] text-[11px] text-faint">
                                  <Icon name={view.email ? 'mail' : 'phone'} size={11} className="shrink-0" />
                                  <span className="truncate">{[view.email, view.phone].filter(Boolean).join(' · ')}</span>
                                </div>
                              )}
                            </div>
                          </button>
                          {err ? (
                            <span className="shrink-0 rounded-[7px] bg-red-300/15 px-2 py-[3px] text-[10.5px] font-bold text-red-300">{t.guests.bulk.rowInvalid}</span>
                          ) : ask ? null : onList ? (
                            <MiniChip className="border-acc text-acc">{t.guests.bulk.rowAlreadyOnList}</MiniChip>
                          ) : (
                            <span className="text-acc"><Icon name="check2" size={17} stroke="#B5A6FF" sw={2.2} /></span>
                          )}
                          <button type="button" onClick={() => removeRow(i)} aria-label={t.guests.bulk.removeRow} className={cn('-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-[9px] text-faint', press)}>
                            <Icon name="close" size={15} />
                          </button>
                        </div>
                        {showEditor && (
                          <div className="flex flex-col gap-2 border-t border-line px-[12px] pb-[12px] pt-[11px]">
                            <Field icon="user" placeholder={t.guests.bulk.fieldName} value={view.name} onChange={(v) => editRow(i, 'name', v)} />
                            <Field icon="mail" placeholder={t.guests.bulk.fieldEmail} value={view.email} onChange={(v) => editRow(i, 'email', v)} type="email" inputMode="email" />
                            <Field icon="phone" placeholder={t.guests.bulk.fieldPhone} value={view.phone} onChange={(v) => editRow(i, 'phone', v)} type="tel" inputMode="tel" />
                          </div>
                        )}
                        {ask && r.ambiguous && (
                          <div className="flex flex-wrap gap-[7px] px-[12px] pb-[12px]">
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
                {removedCount > 0 && (
                  <div className="mt-2 flex items-center justify-center gap-2 text-[12px] text-faint">
                    <span>{fmt(t.guests.bulk.removedLine, { n: removedCount })}</span>
                    <button type="button" onClick={() => setRemoved({})} className={cn('font-semibold text-acc', press)}>{t.guests.bulk.undo}</button>
                  </div>
                )}
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
            : flaggedCount > 0
              ? fmt(flaggedCount === 1 ? t.guests.bulk.fixFirstOne : t.guests.bulk.fixFirstMany, { n: flaggedCount })
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
