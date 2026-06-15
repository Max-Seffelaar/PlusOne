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
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { usePoEvents, usePoTiers, useSession } from '@/features/po/PoLiveProvider';
import {
  createEvent,
  createTier,
  deleteTier,
  updateEvent,
  updateTier,
} from '@/features/events/actions';
import { addGuest } from '@/features/guests/actions';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import {
  parseQuickAdd as parseQuickAddLive,
  resolveAmbiguity,
  type ParseResult,
} from '@/features/guests/quick-add-parser';
import type { PoEvent, Tier } from '@/lib/po/types';
import { Icon } from '../icon';
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

// ── NEW EVENT ───────────────────────────────────────────────────────────────
/** Create an event scoped to the current venue (mirrors EventEdit's create path). */
export function NewEventModal({ onClose }: { onClose: () => void }): JSX.Element {
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
    onClose();
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
      <div className="mb-[14px] flex flex-wrap gap-2">
        {pickable.map((e) => {
          const on = e.id === eventId;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => {
                setEventId(e.id);
                setResolveTier(null);
              }}
              className={cn(
                'flex items-center gap-[9px] rounded-[12px] border px-[12px] py-[9px] text-left',
                press,
                on ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-elev2 text-dim',
              )}
            >
              <span className="text-center">
                <span className={cn('block font-display text-[15px] font-extrabold leading-none', on ? 'text-acc' : 'text-text')}>{e.date}</span>
                <span className="block text-[9px] font-bold tracking-[0.05em] text-faint">{e.mon}</span>
              </span>
              <span className="font-display text-[13.5px] font-bold">{e.name}</span>
            </button>
          );
        })}
      </div>

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

// ── EVENT DETAIL / EDIT (panel) ───────────────────────────────────────────────
/** Edit an event's basics + manage its tiers, all in a desktop modal (no router).
 *  Mirrors the mobile EventEdit + Tiers screens. */
export function EventDetailModal({ event, onClose }: { event: PoEvent; onClose: () => void }): JSX.Element {
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
    <DModal
      title="Event bewerken"
      sub={`${event.venue} · ${event.date} ${event.mon}`}
      onClose={onClose}
      width={620}
      footer={
        <>
          <DBtn kind="ghost" onClick={onClose}>
            Annuleren
          </DBtn>
          <DBtn icon="check" onClick={save} className={canSave ? '' : 'opacity-50'}>
            {busy ? 'Bezig…' : 'Opslaan'}
          </DBtn>
        </>
      }
    >
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

      <div className="mt-2 border-t border-line2 pt-5">
        <TierManager eventId={event.id} />
      </div>
    </DModal>
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
