'use client';

/**
 * Desktop interaction layer: the modals + the event-detail/edit panel that turn
 * the dashboard's action buttons into real mutations.
 *
 * Same contract as the MOBILE screens (`screens/events.tsx`, `screens/guests.tsx`):
 * reads come through the USER-scoped browser-client hooks (RLS is the boundary),
 * writes go through the existing `'use server'` actions, and on success we
 * invalidate the matching `['po', …]` query so every view re-renders with fresh
 * data. The desktop is a single-page client dashboard — these are local-state
 * overlays, no router.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { usePoEvents, usePoTiers, useSession } from '@/features/po/PoLiveProvider';
import { usePoDoor, type PoDoorState } from '@/features/po/door-live';
import { doorSnapshotKey } from '@/features/door/queries';
import {
  createEvent,
  createTier,
  deleteTier,
  duplicateEvent,
  updateEvent,
  updateTier,
} from '@/features/events/actions';
import { addGuest } from '@/features/guests/actions';
import { inviteUserAction } from '@/features/auth/invite-actions';
import { setEventQuota, clearEventQuota } from '@/features/quotas/actions';
import { updateVenue } from '@/features/venues/actions';
import { usePoEventQuotas, usePoVenueSettings, type EventQuotaRow } from '@/features/po/desktop-live';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import {
  parseQuickAdd as parseQuickAddLive,
  resolveAmbiguity,
  type ParseResult,
} from '@/features/guests/quick-add-parser';
import type { Guest, PoEvent, Tier } from '@/lib/po/types';
import { Icon, type IconName } from '../icon';
import { Avatar } from '../kit';
import { DBtn, DCard, DDateTime, DFieldLabel, DInput, DModal, Tag } from './kit';

const press = 'transition-[filter,transform,background,border-color,color] hover:brightness-[1.08] active:scale-[0.985]';

// ISO timestamp -> value for <input type="datetime-local"> (local wall-clock).
// Mirrors the mobile EventEdit helper so create/edit pre-fill identically.
function toLocalInput(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// "Best guess" alias from a tier name (first word) so a new tier is immediately
// matchable by the quick-add — identical to the mobile Tiers logic.
function guessAlias(name: string): string {
  return name.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean)[0] ?? '';
}

/** Searchable event dropdown — scales to a venue with dozens of events where the
 *  old tile row didn't (test feedback). Shows the date chip + name, filters by
 *  name as you type. */
function EventPicker({ events, value, onChange }: { events: PoEvent[]; value: string | undefined; onChange: (id: string) => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const selected = events.find((e) => e.id === value);
  const needle = q.trim().toLowerCase();
  const filtered = needle ? events.filter((e) => e.name.toLowerCase().includes(needle)) : events;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative mb-[14px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn('flex w-full items-center gap-[11px] rounded-[12px] border border-line bg-elev2 px-[13px] py-[10px] text-left', press)}
      >
        {selected ? (
          <span className="w-[34px] shrink-0 text-center">
            <span className="block font-display text-[15px] font-extrabold leading-none text-text">{selected.date}</span>
            <span className="block text-[9px] font-bold tracking-[0.05em] text-faint">{selected.mon}</span>
          </span>
        ) : null}
        <span className={cn('min-w-0 flex-1 truncate font-display text-[14px] font-bold', selected ? 'text-text' : 'font-body text-faint')}>
          {selected ? selected.name : 'Kies een evenement…'}
        </span>
        <Icon name="chevD" size={16} className={cn('shrink-0 text-ghost transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="listbox" className="po-screen-anim mt-2 overflow-hidden rounded-[14px] border border-line bg-elev2">
          <div className="flex items-center gap-[9px] border-b border-line px-[13px] py-[10px]">
            <Icon name="search" size={16} className="text-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Zoek evenement…"
              aria-label="Zoek evenement"
              className="min-w-0 flex-1 border-none bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
            />
          </div>
          <div className="max-h-[44vh] overflow-y-auto py-1">
            {filtered.map((e) => {
              const on = e.id === value;
              return (
                <button
                  key={e.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => {
                    onChange(e.id);
                    setOpen(false);
                    setQ('');
                  }}
                  className={cn('flex w-full items-center gap-[11px] px-[13px] py-[9px] text-left', on ? 'bg-acc-dim' : 'hover:bg-white/[0.04]')}
                >
                  <span className="w-[34px] shrink-0 text-center">
                    <span className={cn('block font-display text-[14px] font-extrabold leading-none', on ? 'text-acc' : 'text-text')}>{e.date}</span>
                    <span className="block text-[9px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
                  </span>
                  <span className={cn('min-w-0 flex-1 truncate font-display text-[13.5px] font-bold', on ? 'text-acc' : 'text-text')}>{e.name}</span>
                  {e.venue ? <span className="shrink-0 truncate text-[11.5px] text-faint">{e.venue}</span> : null}
                  {on && <Icon name="check2" size={15} stroke="#B5A6FF" sw={2.4} />}
                </button>
              );
            })}
            {filtered.length === 0 && <div className="px-[13px] py-[14px] text-center text-[13px] text-faint">Geen evenement gevonden</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── NEW EVENT ───────────────────────────────────────────────────────────────
/** Create an event scoped to the current venue (mirrors EventEdit's create path). */
export function NewEventModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }): JSX.Element {
  const qc = useQueryClient();
  const { currentVenue } = useSession();
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && startsAt.length > 0 && Boolean(currentVenue) && !busy;

  async function save(): Promise<void> {
    if (!canSave) return;
    setBusy(true);
    setErr(null);
    const res = await createEvent({
      venueId: currentVenue!.id,
      name,
      startsAt: new Date(startsAt),
      endsAt: endsAt ? new Date(endsAt) : null,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ['po', 'events'] });
    // Open the fresh event straight away (test feedback): you land in its detail
    // to edit, add tiers and see the (empty) guest list — not a silent close.
    onCreated(res.id);
  }

  return (
    <DModal
      title="Nieuw event"
      sub={currentVenue ? currentVenue.name : 'Geen venue geselecteerd'}
      onClose={onClose}
      footer={
        <>
          <DBtn kind="ghost" onClick={onClose}>
            Annuleren
          </DBtn>
          <DBtn icon="check" onClick={save} className={canSave ? '' : 'opacity-50'}>
            {busy ? 'Bezig…' : 'Event aanmaken'}
          </DBtn>
        </>
      }
    >
      <DFieldLabel>Naam</DFieldLabel>
      <DInput value={name} onChange={setName} placeholder="bv. FRENZY" autoFocus className="mb-[14px]" />

      <DFieldLabel>Venue</DFieldLabel>
      <div className="mb-[14px] flex items-center gap-[10px] rounded-[12px] border border-line bg-elev2 px-[14px] py-[11px] text-[14.5px] text-dim">
        <Icon name="building" size={17} className="text-faint" />
        {currentVenue?.name ?? 'Geen venue geselecteerd'}
      </div>

      <DFieldLabel>Deur open</DFieldLabel>
      <DDateTime value={startsAt} onChange={setStartsAt} className="mb-[14px]" />

      <DFieldLabel>Einde (optioneel)</DFieldLabel>
      <DDateTime value={endsAt} onChange={setEndsAt} />

      {err && <p className="mt-3 text-[13px] text-acc-soft">{err}</p>}
    </DModal>
  );
}

// ── NEW USER (invite, #4/#20/#24) ─────────────────────────────────────────────
const VENUE_ROLES: { value: string; label: string }[] = [
  { value: 'staff', label: 'Staff' },
  { value: 'doorhost', label: 'Deurhost' },
  { value: 'user_manager', label: 'Gebruikersbeheer' },
  { value: 'finance', label: 'Finance' },
  { value: 'admin', label: 'Admin' },
];

/** Invite a user to the current venue with roles. Sends through the existing
 *  inviteUserAction (server-side: AAL2 + caller-role + escalation guard + RLS on
 *  the invite insert). At AAL1 the action returns the "MFA vereist" message, which
 *  we surface as-is — proof the AAL2 gate works. */
export function NewUserModal({ onClose }: { onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const { currentVenue } = useSession();
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [quota, setQuota] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const validEmail = /.+@.+\..+/.test(email);
  const canSend = validEmail && roles.length > 0 && Boolean(currentVenue) && !busy;
  const sensitive = roles.includes('admin') || roles.includes('finance');
  // Quota only matters for the roles that add guests under a personal limit
  // (#5/#22); admin/organizer are exempt and finance/user_manager don't add.
  const showQuota = roles.includes('staff') || roles.includes('doorhost');

  function toggleRole(r: string): void {
    setRoles((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));
    setErr(null);
  }

  async function send(): Promise<void> {
    if (!canSend || !currentVenue) return;
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    const fd = new FormData();
    fd.set('venueId', currentVenue.id);
    fd.set('email', email);
    roles.forEach((r) => fd.append('roles', r));
    // Only send a quota when a guest-adding role is selected; '' = none.
    fd.set('defaultQuota', showQuota ? quota : '');
    const res = await inviteUserAction({ ok: false }, fd);
    setBusy(false);
    if (!res.ok) {
      setErr(res.error ?? 'Kon de uitnodiging niet versturen.');
      return;
    }
    setOkMsg(res.message ?? 'Uitnodiging klaargezet.');
    setEmail('');
    setRoles([]);
    setQuota('');
    await qc.invalidateQueries({ queryKey: ['po', 'team'] });
  }

  return (
    <DModal
      title="Gebruiker uitnodigen"
      sub={currentVenue ? currentVenue.name : 'Geen venue geselecteerd'}
      onClose={onClose}
      footer={
        <>
          <DBtn kind="ghost" onClick={onClose}>
            Klaar
          </DBtn>
          <DBtn icon="arrowR" onClick={send} className={canSend ? '' : 'opacity-50'}>
            {busy ? 'Bezig…' : 'Verstuur uitnodiging'}
          </DBtn>
        </>
      }
    >
      <DFieldLabel>E-mailadres</DFieldLabel>
      <DInput value={email} onChange={(v) => { setEmail(v); setErr(null); }} placeholder="naam@venue.nl" inputMode="email" autoFocus className="mb-[14px]" />

      <DFieldLabel>Rollen</DFieldLabel>
      <div className="mb-2 flex flex-wrap gap-2">
        {VENUE_ROLES.map((r) => {
          const on = roles.includes(r.value);
          return (
            <button
              key={r.value}
              type="button"
              onClick={() => toggleRole(r.value)}
              className={cn('rounded-[11px] border px-[13px] py-[8px] font-display text-[13.5px] font-bold', press, on ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-elev2 text-dim')}
            >
              {r.label}
            </button>
          );
        })}
      </div>

      {showQuota && (
        <div className="mb-1 mt-[14px]">
          <DFieldLabel>Gastenquotum (optioneel)</DFieldLabel>
          <DInput
            value={quota}
            onChange={(v) => { setQuota(v.replace(/[^0-9]/g, '')); setErr(null); }}
            placeholder="bijv. 10"
            inputMode="numeric"
            className="max-w-[160px]"
          />
          <p className="mt-1.5 text-[12px] leading-[1.45] text-faint">
            Hoeveel gasten dit teamlid op de lijst mag zetten. Wordt hun vaste quotum zodra ze de uitnodiging accepteren; per event kun je het later bijstellen via de Quota-tab.
          </p>
        </div>
      )}

      {sensitive && (
        <p className="mb-1 text-[12.5px] leading-[1.45] text-faint">
          Admin en Finance krijgen <b>verplichte MFA</b> bij eerste login. Deze uitnodiging zelf vereist ook AAL2.
        </p>
      )}
      {err && <p className="mt-2 text-[13px] text-acc-soft">{err}</p>}
      {okMsg && <p className="mt-2 text-[13px] font-bold text-acc">{okMsg}</p>}
    </DModal>
  );
}

// ── VENUE SETTINGS ────────────────────────────────────────────────────────────
const RETENTION_OPTIONS = ['6', '12', '24'];

/** Edit the current venue: name, **Locatie-adres** (feeds guest comms), AVG
 *  retention. Reads via usePoVenueSettings; saves through updateVenue (admin-only
 *  by RLS, audited). Mirrors the mobile VenueSettings but live. */
export function VenueSettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const { currentVenue } = useSession();
  const venueId = currentVenue?.id ?? null;
  const { settings, isLoading } = usePoVenueSettings(venueId);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [retention, setRetention] = useState('12');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Hydrate the form once the live values arrive (and on venue switch).
  useEffect(() => {
    if (settings) {
      setName(settings.name);
      setAddress(settings.address);
      setRetention(String(settings.retentionMonths));
    }
  }, [settings]);

  const canSave = name.trim().length > 0 && Boolean(venueId) && !busy;

  async function save(): Promise<void> {
    if (!canSave || !venueId) return;
    setBusy(true);
    setErr(null);
    setOkMsg(null);
    const res = await updateVenue({
      venueId,
      name: name.trim(),
      address: address.trim(),
      retentionMonths: Number(retention),
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    setOkMsg('Opgeslagen.');
    await qc.invalidateQueries({ queryKey: ['po', 'venue-settings', venueId] });
    await qc.invalidateQueries({ queryKey: ['po', 'session'] }); // venue name in the switcher
  }

  return (
    <DModal
      title="Venue instellingen"
      sub={currentVenue?.name ?? 'Geen venue'}
      onClose={onClose}
      footer={
        <>
          <DBtn kind="ghost" onClick={onClose}>
            Klaar
          </DBtn>
          <DBtn icon="check" onClick={save} className={canSave ? '' : 'opacity-50'}>
            {busy ? 'Bezig…' : 'Opslaan'}
          </DBtn>
        </>
      }
    >
      {isLoading && !settings ? (
        <p className="py-3 text-[13px] text-faint">Laden…</p>
      ) : (
        <>
          <DFieldLabel>Naam</DFieldLabel>
          <DInput value={name} onChange={(v) => { setName(v); setErr(null); setOkMsg(null); }} placeholder="Venue-naam" className="mb-[14px]" />

          <DFieldLabel>Locatie (adres)</DFieldLabel>
          <DInput value={address} onChange={(v) => { setAddress(v); setErr(null); setOkMsg(null); }} placeholder="Straat + nr, postcode, plaats" className="mb-1" />
          <p className="mb-[14px] text-[12px] leading-[1.45] text-faint">Het volledige adres van de locatie — komt later in de gastcommunicatie te staan.</p>

          <DFieldLabel>AVG-bewaartermijn</DFieldLabel>
          <div className="mb-2 flex gap-2">
            {RETENTION_OPTIONS.map((m) => {
              const on = retention === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setRetention(m); setOkMsg(null); }}
                  className={cn('flex-1 rounded-[11px] border py-[10px] font-display text-[14px] font-bold', press, on ? 'border-transparent bg-acc text-on-acc' : 'border-line bg-elev2 text-dim')}
                >
                  {m} mnd
                </button>
              );
            })}
          </div>
          <p className="text-[12px] leading-[1.45] text-faint">Gastdata wordt na deze termijn automatisch geanonimiseerd tot “Gast #X”. Het audit log blijft intact.</p>

          {err && <p className="mt-3 text-[13px] text-acc-soft">{err}</p>}
          {okMsg && <p className="mt-3 text-[13px] font-bold text-acc">{okMsg}</p>}
        </>
      )}
    </DModal>
  );
}

// ── NEW GUEST (quick-add) ─────────────────────────────────────────────────────
/** Desktop quick-add: pick an event from the venue, parse one line (#33), addGuest. */
export function NewGuestModal({ onClose }: { onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const { events } = usePoEvents();
  // Adding to a live/upcoming list; fall back to all events if none are upcoming.
  const upcoming = events.filter((e) => e.when === 'upcoming');
  const pickable = upcoming.length ? upcoming : events;

  const [eventId, setEventId] = useState<string | undefined>(pickable[0]?.id);
  const { tiers } = usePoTiers(eventId);

  const [val, setVal] = useState('');
  const [resolveTier, setResolveTier] = useState<string | null>(null);
  const [added, setAdded] = useState<{ id: number; name: string; plus: number; tierShort: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const defaultTierId = useMemo(
    () => resolveDefaultTierId(tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases }))),
    [tiers],
  );

  // Deterministic parse against this event's tiers (null until tiers resolve).
  const live = useMemo<{ result: ParseResult; tier: Tier } | null>(() => {
    if (!val || !defaultTierId || tiers.length === 0) return null;
    const result = parseQuickAddLive(
      val,
      tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases })),
      defaultTierId,
    );
    const chosenId = resolveTier ?? result.tierId ?? defaultTierId;
    const tier = tiers.find((t) => t.id === chosenId) ?? tiers.find((t) => t.id === defaultTierId) ?? tiers[0];
    return { result, tier };
  }, [val, tiers, defaultTierId, resolveTier]);

  const needsAsk = Boolean(live && live.result.status === 'ambiguous' && !resolveTier);
  const unknownWords = live?.result.ambiguous ? live.result.ambiguous.text.split(/\s+/).filter(Boolean) : [];
  const askTiers: Tier[] = live
    ? (live.result.ambiguous?.suggestions ?? [])
        .map((s) => tiers.find((t) => t.id === s.tierId))
        .filter((t): t is Tier => Boolean(t))
    : [];
  const cost = live ? 1 + live.result.plusOnes : 0;
  const canAdd = Boolean(live && !needsAsk && eventId && defaultTierId) && !busy;

  function onVal(v: string): void {
    setVal(v);
    setResolveTier(null);
    setErr(null);
  }

  async function commit(): Promise<void> {
    if (!canAdd || !live || !eventId || !defaultTierId) return;
    // Fold the unknown words back into the name, or pick the chosen tier (#33).
    const choice =
      resolveTier === NAME_CHOICE
        ? ({ kind: 'name' } as const)
        : resolveTier
          ? ({ kind: 'tier', tierId: resolveTier } as const)
          : null;
    const resolved = choice
      ? resolveAmbiguity(live.result, choice, defaultTierId)
      : { name: live.result.name, plusOnes: live.result.plusOnes, tierId: live.tier.id };

    setBusy(true);
    setErr(null);
    const res = await addGuest({
      eventId,
      tierId: resolved.tierId,
      fullName: resolved.name,
      plusOnes: resolved.plusOnes,
      source: 'app',
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    setAdded((a) => [{ id: Date.now(), name: resolved.name, plus: resolved.plusOnes, tierShort: live.tier.short }, ...a]);
    setVal('');
    setResolveTier(null);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['po', 'events'] }),
      qc.invalidateQueries({ queryKey: ['po', 'guests', eventId] }),
      qc.invalidateQueries({ queryKey: ['po', 'tiers', eventId] }),
    ]);
  }

  // No events at all: tell the user to make one first (per the task spec).
  if (pickable.length === 0) {
    return (
      <DModal
        title="Nieuwe gast"
        onClose={onClose}
        footer={
          <DBtn icon="cal" onClick={onClose}>
            Sluiten
          </DBtn>
        }
      >
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-[13px] border border-line bg-elev2 text-faint">
            <Icon name="cal" size={20} />
          </span>
          <div className="text-[14px] text-dim">Maak eerst een event aan om gasten toe te voegen.</div>
        </div>
      </DModal>
    );
  }

  return (
    <DModal
      title="Nieuwe gast"
      sub="Typ vrij — naam, +gasten, tier"
      onClose={onClose}
      footer={
        <>
          <DBtn kind="ghost" onClick={onClose}>
            Klaar
          </DBtn>
          <DBtn icon="plus" onClick={commit} className={canAdd ? '' : 'opacity-50'}>
            {busy ? 'Bezig…' : live ? `Voeg toe · ${live.result.name || 'gast'}` : 'Typ een naam'}
          </DBtn>
        </>
      }
    >
      <DFieldLabel>Evenement</DFieldLabel>
      <EventPicker
        events={pickable}
        value={eventId}
        onChange={(id) => {
          setEventId(id);
          setResolveTier(null);
        }}
      />

      <DFieldLabel>Naam, +gasten, tier</DFieldLabel>
      <input
        autoFocus
        value={val}
        onChange={(e) => onVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !needsAsk) void commit();
        }}
        placeholder={'bv. "Juri Braakman +2 vip"'}
        className={cn(
          'w-full rounded-[12px] border bg-elev2 px-[14px] py-[12px] font-display text-[16px] font-bold tracking-[-0.01em] text-text outline-none transition-colors placeholder:text-faint',
          live ? 'border-acc' : 'border-line focus:border-acc',
        )}
      />

      {live && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <PreviewChip icon="user" label={live.result.name || '—'} />
          {live.result.plusOnes > 0 && <PreviewChip icon="users" label={`+${live.result.plusOnes}`} />}
          {!needsAsk && <PreviewChip dot={live.tier.color} label={live.tier.short} />}
          {!needsAsk && (
            <span className="text-[12.5px] text-faint">
              kost {cost} {cost === 1 ? 'plek' : 'plekken'}
            </span>
          )}
        </div>
      )}

      {needsAsk && live && (
        <div className="mt-3 rounded-[14px] bg-acc-dim p-[14px]">
          <div className="mb-[11px] text-[13.5px] leading-[1.45] text-text">
            <b>“{unknownWords.join(' ')}”</b> herken ik niet. Wat bedoel je?
          </div>
          <div className="flex flex-col gap-2">
            {askTiers.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setResolveTier(t.id)}
                className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[11px] text-text', press)}
              >
                <span className="h-[10px] w-[10px] rounded-full" style={{ background: t.color }} />
                <span className="flex-1 text-left font-display text-[14px] font-bold">{t.short}</span>
                <Icon name="chev" size={16} className="text-ghost" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setResolveTier(NAME_CHOICE)}
              className={cn('flex items-center gap-[10px] rounded-[12px] border border-line bg-bg px-[13px] py-[11px] text-text', press)}
            >
              <Icon name="user" size={15} className="text-faint" />
              <span className="flex-1 text-left font-display text-[14px] font-bold">Hoort bij de naam</span>
              <Icon name="chev" size={16} className="text-ghost" />
            </button>
          </div>
        </div>
      )}

      {added.length > 0 && (
        <>
          <DFieldLabel className="mt-5">Net toegevoegd · {added.length}</DFieldLabel>
          <div className="flex flex-col gap-2">
            {added.map((g) => (
              <div key={g.id} className="flex items-center gap-[11px] rounded-[12px] border border-line bg-elev2 p-[10px]">
                <Avatar name={g.name} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[14px] font-bold text-text">
                    {g.name}
                    {g.plus > 0 && <span className="text-faint"> +{g.plus}</span>}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-faint">{g.tierShort}</div>
                </div>
                <span className="inline-flex items-center gap-[5px] font-body text-[11.5px] font-bold text-acc">
                  <Icon name="check2" size={13} stroke="#B5A6FF" sw={2.4} />
                  op lijst
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {err && <p className="mt-3 text-[13px] text-acc-soft">{err}</p>}
    </DModal>
  );
}

/** Sentinel resolveTier value for the "Hoort bij de naam" choice (#33). */
const NAME_CHOICE = '__name__';

function PreviewChip({ icon, dot, label }: { icon?: 'user' | 'users'; dot?: string; label: string }): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[9px] border border-line bg-elev2 px-[11px] py-1.5 font-display text-[13px] font-bold text-text">
      {dot && <span className="h-[9px] w-[9px] rounded-full" style={{ background: dot }} />}
      {icon && <Icon name={icon} size={13} className="text-faint" />}
      {label}
    </span>
  );
}

// ── EVENT DETAIL (panel) ──────────────────────────────────────────────────────
type DetailTab = 'door' | 'edit' | 'quota';

/** Event detail = the event-day command centre (#3): a live KPI band + a "Deur"
 *  tab (search + real quick check-in via the offline outbox) + a "Bewerken" tab
 *  (basics + tiers). Mirrors the mobile EventView + EventEdit, tabbed for desktop.
 *  Check-in is real; "uitchecken" (void) isn't in the live model yet — we never
 *  fake it (see backlog). */
export function EventDetailModal({ event, onClose, onDuplicated }: { event: PoEvent; onClose: () => void; onDuplicated?: (newId: string) => void }): JSX.Element {
  const qc = useQueryClient();
  const door = usePoDoor(event.id);
  // Land on the live-ops tab unless there's nothing to run yet (draft/past).
  const [tab, setTab] = useState<DetailTab>(
    event.when === 'past' || event.status === 'draft' ? 'edit' : 'door',
  );
  const [dupBusy, setDupBusy] = useState(false);
  const [dupErr, setDupErr] = useState<string | null>(null);

  const listed = door.guests.length;
  const inside = door.inside.size;
  const onderweg = Math.max(0, listed - inside);
  const heads = (scope: 'all' | 'in'): number =>
    door.guests.reduce(
      (n, g) => (scope === 'in' && !door.inside.has(g.id) ? n : n + 1 + g.plus),
      0,
    );

  // Duplicate this event as a fresh draft (basics + tiers, no guests) and jump
  // straight into the copy's detail — same create→detail flow as a new event.
  async function duplicate(): Promise<void> {
    if (dupBusy) return;
    setDupBusy(true);
    setDupErr(null);
    const res = await duplicateEvent(event.id);
    if (!res.ok) {
      setDupBusy(false);
      setDupErr(res.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ['po', 'events'] });
    setDupBusy(false);
    if (onDuplicated) onDuplicated(res.id);
    else onClose();
  }

  return (
    <DModal
      title={event.name}
      sub={`${event.venue} · ${event.date} ${event.mon}${event.time ? ` · deur ${event.time}` : ''}`}
      onClose={onClose}
      width={680}
      footer={
        <>
          <DBtn kind="ghost" icon="paste" onClick={duplicate} className={dupBusy ? 'pointer-events-none opacity-50' : ''}>
            {dupBusy ? 'Bezig…' : 'Dupliceer'}
          </DBtn>
          <DBtn kind="ghost" icon="close" onClick={onClose}>
            Sluiten
          </DBtn>
        </>
      }
    >
      {dupErr && <p className="mb-3 text-[12.5px] text-acc-soft">{dupErr}</p>}

      {/* Live KPI band — always visible: the numbers Max wants in his face on the night. */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <KpiCell label="Onderweg" value={onderweg} />
        <KpiCell label="Binnen" value={inside} sub={`${heads('in')} koppen`} accent />
        <KpiCell label="Op lijst" value={listed} sub={`${heads('all')} koppen`} />
      </div>

      <div className="mb-4 flex gap-1.5 rounded-[12px] border border-line bg-elev2 p-1">
        <TabBtn on={tab === 'door'} onClick={() => setTab('door')} icon="ticket">
          Deur
        </TabBtn>
        <TabBtn on={tab === 'quota'} onClick={() => setTab('quota')} icon="users">
          Quota
        </TabBtn>
        <TabBtn on={tab === 'edit'} onClick={() => setTab('edit')} icon="note">
          Bewerken
        </TabBtn>
      </div>

      {tab === 'door' && <DoorRoster door={door} eventId={event.id} />}
      {tab === 'quota' && <EventQuotaPanel eventId={event.id} />}
      {tab === 'edit' && <EventEditFields event={event} onClose={onClose} />}
    </DModal>
  );
}

function KpiCell({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: boolean }): JSX.Element {
  return (
    <div className={cn('rounded-[14px] border px-[15px] py-[13px]', accent ? 'border-transparent bg-acc-dim' : 'border-line bg-elev2')}>
      <div className={cn('font-display text-[26px] font-extrabold leading-none tracking-[-0.02em]', accent ? 'text-acc' : 'text-text')}>{value}</div>
      <div className="mt-[6px] text-[12px] font-bold uppercase tracking-[0.04em] text-faint">{label}</div>
      {sub && <div className="mt-0.5 text-[11.5px] text-faint">{sub}</div>}
    </div>
  );
}

function TabBtn({ on, onClick, icon, children }: { on: boolean; onClick: () => void; icon: IconName; children: ReactNode }): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('flex flex-1 items-center justify-center gap-2 rounded-[9px] px-3 py-[9px] font-display text-[14px] font-bold', press, on ? 'bg-acc-dim text-acc' : 'bg-transparent text-dim hover:text-text')}
    >
      <Icon name={icon} size={16} sw={on ? 2.2 : 1.9} />
      {children}
    </button>
  );
}

/** Per-event quota tab (#5): set a team member's allotment FOR THIS EVENT. Every
 *  member shows their standing ("vast") quotum + an optional per-event override;
 *  writes go through setEventQuota/clearEventQuota (AAL2-gated server-side). */
function EventQuotaPanel({ eventId }: { eventId: string }): JSX.Element {
  const qc = useQueryClient();
  const { rows, venueId, isLoading } = usePoEventQuotas(eventId);
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: ['po', 'event-quotas', venueId, eventId] });
  };

  return (
    <div>
      <p className="mb-3 text-[12.5px] leading-[1.5] text-faint">
        Geef een teamlid een afwijkend aantal plekken voor dít event. Zonder override geldt hun vaste
        quotum. Aanpassen vereist MFA (admin).
      </p>

      {isLoading && rows.length === 0 && <p className="py-3 text-[13px] text-faint">Laden…</p>}
      {!isLoading && rows.length === 0 && (
        <p className="py-6 text-center text-[13px] text-faint">Nog geen teamleden voor deze venue.</p>
      )}

      <div className="flex max-h-[46dvh] flex-col gap-2 overflow-y-auto pr-1">
        {rows.map((r) => (
          <QuotaRow key={r.userId} row={r} eventId={eventId} onChanged={refresh} />
        ))}
      </div>
    </div>
  );
}

/** One member row: a clamped 0–1000 stepper + Opslaan (when changed) / Reset
 *  (when an override is active). Each row owns its draft + busy/err state so a
 *  failed save (e.g. the AAL2 gate at AAL1) is shown locally, not globally. */
function QuotaRow({ row, eventId, onChanged }: { row: EventQuotaRow; eventId: string; onChanged: () => void }): JSX.Element {
  const effective = row.override ?? row.venueDefault;
  const hasOverride = row.override !== null;
  const [val, setVal] = useState(effective);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Re-sync the draft when the underlying row refreshes after a save/clear.
  useEffect(() => {
    setVal(row.override ?? row.venueDefault);
  }, [row.override, row.venueDefault]);

  const dirty = val !== effective;
  const clamp = (n: number): number => Math.max(0, Math.min(1000, n));
  const step = 'flex h-[32px] w-[32px] items-center justify-center rounded-[9px] border border-line bg-elev2 text-text disabled:opacity-40';

  const save = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const res = await setEventQuota({ eventId, userId: row.userId, quotaOverride: val });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    onChanged();
  };
  const reset = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    const res = await clearEventQuota({ eventId, userId: row.userId });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    onChanged();
  };

  return (
    <div className="rounded-[14px] border border-line bg-elev2 p-[11px]">
      <div className="flex items-center gap-3">
        <Avatar name={row.name} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[14.5px] font-bold text-text">{row.name}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-faint">
            {row.role} · vast quotum {row.venueDefault}
            {hasOverride && <span className="font-bold text-acc"> · override {row.override}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Min" disabled={busy || val <= 0} onClick={() => setVal((v) => clamp(v - 1))} className={cn(step, press)}>
            <Icon name="minus" size={15} />
          </button>
          <span className="w-[34px] text-center font-display text-[16px] font-extrabold tabular-nums text-text">{val}</span>
          <button type="button" aria-label="Plus" disabled={busy || val >= 1000} onClick={() => setVal((v) => clamp(v + 1))} className={cn(step, press)}>
            <Icon name="plus" size={15} />
          </button>
        </div>

        {dirty ? (
          <DBtn sm icon="check" onClick={save}>
            {busy ? '…' : 'Opslaan'}
          </DBtn>
        ) : hasOverride ? (
          <DBtn sm kind="ghost" onClick={reset}>
            {busy ? '…' : 'Reset'}
          </DBtn>
        ) : (
          <span className="w-[64px]" />
        )}
      </div>
      {err && <p className="mt-2 pl-[48px] text-[12.5px] text-acc-soft">{err}</p>}
    </div>
  );
}

/** Inline quick-add inside the event detail: add a guest straight to THIS event
 *  (no event picker). Reuses the same #33 parser + addGuest action as the New
 *  Guest modal; an ambiguous tier word is auto-folded into the name here. */
function InlineAddGuest({ eventId }: { eventId: string }): JSX.Element {
  const qc = useQueryClient();
  const { tiers } = usePoTiers(eventId);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  const tierList = useMemo(() => tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases })), [tiers]);
  const defaultTierId = useMemo(() => resolveDefaultTierId(tierList), [tierList]);
  const parsed = useMemo<ParseResult | null>(() => {
    if (!val.trim() || !defaultTierId || tierList.length === 0) return null;
    return parseQuickAddLive(val, tierList, defaultTierId);
  }, [val, tierList, defaultTierId]);
  const canAdd = Boolean(parsed && defaultTierId) && !busy;

  async function commit(): Promise<void> {
    if (!parsed || !defaultTierId || busy) return;
    setBusy(true);
    setErr(null);
    const resolved =
      parsed.status === 'ambiguous'
        ? resolveAmbiguity(parsed, { kind: 'name' } as const, defaultTierId)
        : { name: parsed.name, plusOnes: parsed.plusOnes, tierId: parsed.tierId ?? defaultTierId };
    const res = await addGuest({ eventId, tierId: resolved.tierId, fullName: resolved.name, plusOnes: resolved.plusOnes, source: 'app' });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    setAdded((a) => [resolved.name, ...a].slice(0, 4));
    setVal('');
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['po', 'events'] }),
      qc.invalidateQueries({ queryKey: doorSnapshotKey(eventId) }),
      qc.invalidateQueries({ queryKey: ['po', 'tiers', eventId] }),
    ]);
  }

  return (
    <div className="mb-3 rounded-[14px] border border-line bg-elev2 p-3">
      <DFieldLabel>Gast toevoegen</DFieldLabel>
      {tierList.length === 0 ? (
        <p className="text-[12.5px] text-faint">Maak eerst een tier aan (tab Bewerken) om gasten te kunnen toevoegen.</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <DInput value={val} onChange={(v) => { setVal(v); setErr(null); }} onEnter={commit} placeholder={'bv. "Juri Braakman +2 vip"'} className="flex-1" />
            <DBtn sm icon="plus" onClick={commit} className={canAdd ? '' : 'opacity-50'}>
              {busy ? '…' : 'Toevoegen'}
            </DBtn>
          </div>
          {parsed && (
            <div className="mt-1.5 text-[12px] text-faint">
              → {parsed.name || '—'}
              {parsed.plusOnes > 0 ? ` +${parsed.plusOnes}` : ''}
            </div>
          )}
          {err && <p className="mt-1.5 text-[12.5px] text-acc-soft">{err}</p>}
          {added.length > 0 && <div className="mt-1.5 text-[12px] font-bold text-acc">Toegevoegd: {added.join(', ')}</div>}
        </>
      )}
    </div>
  );
}

/** Live door roster: local search + per-guest quick check-in. Check-in routes
 *  through the shared `usePoDoor` outbox (idempotent UUIDv7 upsert, #25), exactly
 *  like the mobile Deur screen — colleague check-ins land via realtime. */
function DoorRoster({ door, eventId }: { door: PoDoorState; eventId: string }): JSX.Element {
  const [q, setQ] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  // Clicking a row opens the guest detail (view + capped check-in + task ack),
  // replacing the list within the same modal until you go back.
  const detailGuest = detailId ? door.guests.find((g) => g.id === detailId) : null;
  if (detailGuest) return <DesktopGuestDetail g={detailGuest} door={door} onBack={() => setDetailId(null)} />;

  const needle = q.trim().toLowerCase();
  const rows = door.guests
    .filter((g) => !needle || g.name.toLowerCase().includes(needle))
    .slice()
    .sort((a, b) => {
      const ai = door.inside.has(a.id) ? 1 : 0;
      const bi = door.inside.has(b.id) ? 1 : 0;
      if (ai !== bi) return ai - bi; // onderweg first (actionable), binnen sinks down
      return a.name.localeCompare(b.name, 'nl');
    });

  return (
    <div>
      <InlineAddGuest eventId={eventId} />
      <DInput value={q} onChange={setQ} placeholder="Zoek gast…" className="mb-3" />

      {door.isLoading && door.guests.length === 0 && <p className="py-3 text-[13px] text-faint">Laden…</p>}
      {!door.isLoading && door.guests.length === 0 && (
        <p className="py-6 text-center text-[13px] text-faint">Nog geen gasten op deze lijst.</p>
      )}

      <div className="flex max-h-[44dvh] flex-col gap-2 overflow-y-auto pr-1">
        {rows.map((g) => {
          const isIn = door.inside.has(g.id);
          const at = door.log[g.id]?.at;
          return (
            <div key={g.id} className={cn('flex items-center gap-[12px] rounded-[14px] border p-[11px]', isIn ? 'border-line2 bg-transparent' : 'border-line bg-elev2')}>
              <button type="button" onClick={() => setDetailId(g.id)} className={cn('flex min-w-0 flex-1 items-center gap-[12px] text-left', press)}>
                <Avatar name={g.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[14.5px] font-bold text-text">
                    {g.name}
                    {g.plus > 0 && <span className="text-faint"> +{g.plus}</span>}
                  </div>
                  <div className="mt-0.5 truncate text-[11.5px] text-faint">
                    {g.flag === 'high' ? '⚑ ' : ''}
                    {g.role}
                    {g.note ? ` · ${g.note}` : ''}
                  </div>
                </div>
              </button>
              {isIn ? (
                <span className="inline-flex items-center gap-[6px] whitespace-nowrap font-body text-[12px] font-bold text-acc">
                  <Icon name="check2" size={14} stroke="#B5A6FF" sw={2.4} />
                  binnen{at ? ` · ${at}` : ''}
                </span>
              ) : (
                <DBtn sm icon="check" onClick={() => door.checkIn(g.id, 1 + g.plus)}>
                  Inchecken
                </DBtn>
              )}
            </div>
          );
        })}
      </div>

      {door.toast && (
        <div className="mt-3 rounded-[12px] border border-line bg-elev2 px-[14px] py-[10px] text-center text-[13px] font-bold text-acc">
          {door.toast}
        </div>
      )}
    </div>
  );
}

/** Desktop guest detail (click a roster row): info + note/task ack + a quantity-
 *  capped check-in — the desktop counterpart of the mobile Guest screen. The
 *  count caps at 1 + plus_ones (edit the order to change that). "Uitchecken"/void
 *  is not in the live model and is intentionally absent. */
function DesktopGuestDetail({ g, door, onBack }: { g: Guest; door: PoDoorState; onBack: () => void }): JSX.Element {
  const isIn = door.inside.has(g.id);
  const at = door.log[g.id]?.at;
  const done = door.taskDone(g.id);
  const [count, setCount] = useState(1 + g.plus);
  const stepBtn = 'flex h-[38px] w-[38px] items-center justify-center rounded-[11px] border border-line bg-elev2 text-text disabled:opacity-40';

  return (
    <div>
      <button type="button" onClick={onBack} className={cn('mb-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-faint hover:text-text', press)}>
        <Icon name="chev" size={15} className="rotate-180" />
        Terug naar lijst
      </button>

      <div className="mb-4 flex items-center gap-3">
        <Avatar name={g.name} size={46} accent={g.role === 'VIP'} />
        <div className="min-w-0">
          <div className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
            {g.name}
            {g.plus > 0 && <span className="text-faint"> +{g.plus}</span>}
          </div>
          <div className="mt-0.5 text-[12.5px] text-faint">
            {g.role}
            {g.by ? ` · toegevoegd door ${g.by}` : ''}
          </div>
        </div>
      </div>

      {g.note && (
        <div className={cn('mb-4 rounded-[14px] border p-[14px]', g.flag === 'high' && !done ? 'border-transparent bg-acc-dim' : 'border-line bg-elev2')}>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.04em] text-faint">
              <Icon name="flag" size={13} stroke={g.flag === 'high' ? '#B5A6FF' : 'rgba(255,255,255,0.4)'} fill={g.flag === 'high' ? '#B5A6FF' : 'none'} />
              {g.flag === 'high' ? 'Belangrijke opdracht' : 'Opdracht'}
            </span>
            <span className={cn('text-[11.5px] font-bold', done ? 'text-acc' : 'text-faint')}>{done ? 'OPGEPAKT' : 'OPEN'}</span>
          </div>
          <div className="mb-3 text-[14px] leading-[1.45] text-text">{g.note}</div>
          <DBtn sm kind={done ? 'ghost' : 'primary'} icon={done ? 'history' : 'check2'} onClick={() => door.ackTask(g.id, !done)}>
            {done ? 'Heropenen' : 'Markeer als opgepakt'}
          </DBtn>
        </div>
      )}

      {(() => {
        const arrived = isIn ? g.arrived ?? 0 : 0;
        const headsIn = 1 + arrived;
        const headsTotal = 1 + g.plus;
        // Fully in: everyone of the party arrived — nothing left to check in.
        if (isIn && arrived >= g.plus) {
          return (
            <div className="flex items-center gap-2 rounded-[14px] border border-line2 bg-elev2 px-[14px] py-[13px] text-[14px] font-bold text-acc">
              <Icon name="check2" size={16} stroke="#B5A6FF" sw={2.4} />
              Helemaal binnen{g.plus > 0 ? ` · ${headsTotal} personen` : ''}{at ? ` · ${at}` : ''}
            </div>
          );
        }
        // Onderweg (first check-in) or partially in (incremental "nog inchecken").
        // The slider sets the new TOTAL inside; you can never go below who's in.
        const stepMin = isIn ? headsIn + 1 : 1;
        const cnt = Math.min(Math.max(count, stepMin), headsTotal);
        const showStepper = headsTotal > stepMin;
        return (
          <div>
            {isIn && (
              <div className="mb-3 flex items-center gap-2 rounded-[14px] border border-line2 bg-elev2 px-[14px] py-[11px] text-[13.5px] font-bold text-acc">
                <Icon name="check2" size={15} stroke="#B5A6FF" sw={2.4} />
                {headsIn}/{headsTotal} binnen{at ? ` · ${at}` : ''}
              </div>
            )}
            {showStepper && (
              <>
                <DFieldLabel>{isIn ? 'Nog inchecken — totaal binnen' : 'Hoeveel komen er binnen?'}</DFieldLabel>
                <div className="mb-4 flex items-center gap-3">
                  <button type="button" disabled={cnt <= stepMin} onClick={() => setCount(Math.max(stepMin, cnt - 1))} className={cn(stepBtn, press)} aria-label="Minder">
                    <Icon name="minus" size={17} sw={2.4} />
                  </button>
                  <div className="font-display text-[20px] font-extrabold tabular-nums text-text">
                    {cnt}
                    <span className="text-faint">/{headsTotal}</span>
                  </div>
                  <button type="button" disabled={cnt >= headsTotal} onClick={() => setCount(Math.min(headsTotal, cnt + 1))} className={cn(stepBtn, press, 'text-acc')} aria-label="Meer">
                    <Icon name="plus" size={17} sw={2.4} stroke="#B5A6FF" />
                  </button>
                </div>
              </>
            )}
            <DBtn
              icon="check"
              onClick={() => {
                if (isIn) door.setArrival(g.id, cnt);
                else door.checkIn(g.id, cnt);
                onBack();
              }}
            >
              {isIn ? 'Nog inchecken' : 'Inchecken'} · {cnt} {cnt === 1 ? 'persoon' : 'personen'}
            </DBtn>
          </div>
        );
      })()}
    </div>
  );
}

/** The event-basics edit form (name + door/end times) with an inline save,
 *  followed by the tier manager. Same actions as the mobile EventEdit + Tiers. */
function EventEditFields({ event, onClose }: { event: PoEvent; onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [name, setName] = useState(event.name);
  const [startsAt, setStartsAt] = useState(toLocalInput(event.startsAtISO));
  const [endsAt, setEndsAt] = useState(toLocalInput(event.endsAtISO));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && startsAt.length > 0 && !busy;

  async function save(): Promise<void> {
    if (!canSave) return;
    setBusy(true);
    setErr(null);
    const res = await updateEvent({
      eventId: event.id,
      name,
      startsAt: new Date(startsAt),
      endsAt: endsAt ? new Date(endsAt) : null,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ['po', 'events'] });
    onClose();
  }

  return (
    <div>
      <DFieldLabel>Naam</DFieldLabel>
      <DInput value={name} onChange={setName} placeholder="bv. FRENZY" className="mb-[14px]" />

      <div className="mb-[14px] grid grid-cols-2 gap-3">
        <div>
          <DFieldLabel>Deur open</DFieldLabel>
          <DDateTime value={startsAt} onChange={setStartsAt} />
        </div>
        <div>
          <DFieldLabel>Einde (optioneel)</DFieldLabel>
          <DDateTime value={endsAt} onChange={setEndsAt} />
        </div>
      </div>

      {err && <p className="mb-2 text-[13px] text-acc-soft">{err}</p>}

      <DBtn icon="check" onClick={save} className={canSave ? '' : 'opacity-50'}>
        {busy ? 'Bezig…' : 'Opslaan'}
      </DBtn>

      <div className="mt-5 border-t border-line2 pt-5">
        <TierManager eventId={event.id} />
      </div>
    </div>
  );
}

const TIER_COLORS = ['#B5A6FF', '#9DE0C0', '#E8C98A', '#9FB8E8', '#E89AC0', '#8E8E93'];

/** Tier list + inline create/edit/delete for one event (mirrors mobile Tiers). */
function TierManager({ eventId }: { eventId: string }): JSX.Element {
  const qc = useQueryClient();
  const { tiers, isLoading } = usePoTiers(eventId);
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [nm, setNm] = useState('');
  const [color, setColor] = useState('#9DE0C0');
  const [max, setMax] = useState('');
  const [aliasText, setAliasText] = useState('');
  const [aliasAuto, setAliasAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = adding || editId !== null;

  function reset(): void {
    setNm('');
    setColor('#9DE0C0');
    setMax('');
    setAliasText('');
    setAliasAuto(true);
    setErr(null);
  }
  function startNew(): void {
    reset();
    setEditId(null);
    setAdding(true);
  }
  function startEdit(t: Tier): void {
    setNm(t.name);
    setColor(t.color);
    setMax(t.max != null ? String(t.max) : '');
    setAliasText(t.aliases.join(', '));
    setAliasAuto(false);
    setErr(null);
    setAdding(false);
    setEditId(t.id);
  }
  function closeForm(): void {
    setAdding(false);
    setEditId(null);
    reset();
  }
  function onName(v: string): void {
    setNm(v);
    if (aliasAuto) setAliasText(guessAlias(v));
  }

  async function saveTier(): Promise<void> {
    if (!nm.trim() || busy) return;
    setBusy(true);
    setErr(null);
    let aliases = aliasText.split(',').map((a) => a.trim()).filter(Boolean);
    if (aliases.length === 0) {
      const g = guessAlias(nm);
      if (g) aliases = [g];
    }
    const maxGuests = max.trim() ? Number(max) : null;
    const res = editId
      ? await updateTier({ tierId: editId, name: nm, color, maxGuests, aliases })
      : await createTier({ eventId, name: nm, color, maxGuests, aliases });
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ['po', 'tiers', eventId] });
    closeForm();
  }

  async function removeTier(): Promise<void> {
    if (!editId || busy) return;
    setBusy(true);
    setErr(null);
    const res = await deleteTier(editId);
    setBusy(false);
    if (!res.ok) {
      setErr(res.message);
      return;
    }
    await qc.invalidateQueries({ queryKey: ['po', 'tiers', eventId] });
    closeForm();
  }

  const aliasChips = aliasText.split(',').map((a) => a.trim()).filter(Boolean);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <DFieldLabel className="mb-0">Tiers &amp; aliassen · {tiers.length}</DFieldLabel>
        <DBtn sm kind={open ? 'ghost' : 'dark'} icon={open ? 'close' : 'plus'} onClick={() => (open ? closeForm() : startNew())}>
          {open ? 'Sluiten' : 'Tier'}
        </DBtn>
      </div>

      {open && (
        <DCard className="mb-3 border-acc p-4">
          <DFieldLabel>{editId ? 'Tier bewerken' : 'Nieuwe tier'}</DFieldLabel>
          <DInput value={nm} onChange={onName} placeholder="Naam, bv. “Backstage”" autoFocus className="mb-3" />

          <DFieldLabel>Kleur</DFieldLabel>
          <div className="mb-3 flex gap-[9px]">
            {TIER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="h-[32px] w-[32px] cursor-pointer rounded-full transition-[filter] hover:brightness-[1.1]"
                style={{ background: c, border: '2px solid ' + (color === c ? '#FFFFFF' : 'transparent') }}
                aria-label={`Kleur ${c}`}
              />
            ))}
          </div>

          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <DFieldLabel>Max gasten (optioneel)</DFieldLabel>
              <DInput value={max} onChange={setMax} placeholder="∞" inputMode="numeric" />
            </div>
            <div>
              <DFieldLabel>Aliassen (quick-add)</DFieldLabel>
              <DInput
                value={aliasText}
                onChange={(v) => {
                  setAliasText(v);
                  setAliasAuto(false);
                }}
                placeholder="backstage, bs, prod…"
              />
            </div>
          </div>

          {aliasChips.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1.5">
              {aliasChips.map((a) => (
                <span key={a} className="rounded-[8px] border border-line bg-elev2 px-[9px] py-[5px] font-mono text-[12px] text-dim">
                  {a}
                </span>
              ))}
            </div>
          )}

          {err && <p className="mt-2 text-[13px] text-acc-soft">{err}</p>}

          <div className="mt-3 flex items-center gap-2">
            <DBtn sm icon="check" onClick={saveTier} className={nm.trim() && !busy ? '' : 'opacity-50'}>
              {busy ? 'Bezig…' : editId ? 'Opslaan' : 'Tier aanmaken'}
            </DBtn>
            {editId && (
              <DBtn sm kind="ghost" onClick={removeTier}>
                Verwijderen
              </DBtn>
            )}
          </div>
        </DCard>
      )}

      {isLoading && tiers.length === 0 && <p className="py-2 text-[13px] text-faint">Laden…</p>}
      {!isLoading && tiers.length === 0 && !open && (
        <p className="py-2 text-[13px] text-faint">Nog geen tiers — voeg er een toe voor de quick-add.</p>
      )}

      <div className="flex flex-col gap-2">
        {tiers.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => startEdit(t)}
            className={cn('rounded-[14px] border bg-elev2 p-[13px] text-left', editId === t.id ? 'border-acc' : 'border-line', press)}
          >
            <div className="flex items-center gap-[11px]">
              <span className="h-[14px] w-[14px] shrink-0 rounded-full" style={{ background: t.color }} />
              <div className="min-w-0 flex-1">
                <div className="font-display text-[14.5px] font-bold text-text">{t.name}</div>
                <div className="mt-px text-[12px] text-faint">{t.max ? `${t.used} / ${t.max} gebruikt` : `${t.used} · geen max`}</div>
              </div>
              {t.isDefault && <Tag t="Standaard" />}
              <Icon name="chev" size={16} className="text-ghost" />
            </div>
            {t.aliases.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {t.aliases.map((a) => (
                  <span key={a} className="rounded-[8px] border border-line bg-elev px-[9px] py-[4px] font-mono text-[11.5px] text-dim">
                    {a}
                  </span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
