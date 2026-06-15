'use client';

import { useState, useTransition } from 'react';
import { createTier, updateTier, deleteTier } from '../actions';
import type { EventTierRow } from '../queries';

// Single lavender-led palette (design-system.md). null color = inherit grey.
const PALETTE = ['#B5A6FF', '#9DE0C0', '#E8C98A', '#9FB8E8', '#E89AC0', '#8E8E93'];

function aliasesToText(aliases: string[]): string {
  return aliases.join(', ');
}
function textToAliases(text: string): string[] {
  return text
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
}

function ColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (c: string) => void;
}): JSX.Element {
  return (
    <div className="flex flex-wrap gap-2.5">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Kleur ${c}`}
          onClick={() => onChange(c)}
          className="h-10 w-10 rounded-full transition-transform hover:scale-110"
          // Dark gap + white ring reads clearly on any surface.
          style={{ background: c, boxShadow: value === c ? '0 0 0 2px #0B0B0D, 0 0 0 4px #FFFFFF' : 'none' }}
        />
      ))}
    </div>
  );
}

interface TierFields {
  name: string;
  description: string;
  color: string;
  maxGuests: string;
  aliasesText: string;
}

function emptyFields(): TierFields {
  return { name: '', description: '', color: PALETTE[0], maxGuests: '', aliasesText: '' };
}

function fieldsFrom(t: EventTierRow): TierFields {
  return {
    name: t.name,
    description: t.description ?? '',
    color: t.color ?? PALETTE[0],
    maxGuests: t.maxGuests == null ? '' : String(t.maxGuests),
    aliasesText: aliasesToText(t.aliases),
  };
}

function parseMax(text: string): { value: number | null; error?: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { value: null };
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n <= 0) return { value: null, error: 'Maximum moet een getal groter dan 0 zijn.' };
  return { value: n };
}

function TierEditFields({
  fields,
  setFields,
}: {
  fields: TierFields;
  setFields: (f: TierFields) => void;
}): JSX.Element {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span className="label">Naam</span>
        <input
          className="field"
          value={fields.name}
          placeholder="bv. VIP + fles op tafel"
          onChange={(e) => setFields({ ...fields, name: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="label">Beschrijving (optioneel)</span>
        <input
          className="field"
          value={fields.description}
          onChange={(e) => setFields({ ...fields, description: e.target.value })}
        />
      </label>
      <div className="flex flex-col gap-1 text-sm">
        <span className="label">Kleur</span>
        <ColorPicker value={fields.color} onChange={(c) => setFields({ ...fields, color: c })} />
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="label">Max aantal (optioneel)</span>
        <input
          className="field w-32"
          inputMode="numeric"
          value={fields.maxGuests}
          placeholder="∞"
          onChange={(e) => setFields({ ...fields, maxGuests: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="label">Aliassen · voeden de quick-add</span>
        <input
          className="field font-mono"
          value={fields.aliasesText}
          placeholder="vip, fles, champagne"
          onChange={(e) => setFields({ ...fields, aliasesText: e.target.value })}
        />
      </label>
    </>
  );
}

function TierRow({ tier }: { tier: EventTierRow }): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<TierFields>(() => fieldsFrom(tier));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    const max = parseMax(fields.maxGuests);
    if (max.error) {
      setError(max.error);
      return;
    }
    startTransition(async () => {
      const res = await updateTier({
        tierId: tier.id,
        name: fields.name,
        description: fields.description,
        color: fields.color,
        maxGuests: max.value,
        aliases: textToAliases(fields.aliasesText),
      });
      if (res.ok) setEditing(false);
      else setError(res.message);
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deleteTier({ tierId: tier.id });
      if (!res.ok) setError(res.message);
    });
  }

  const pct = tier.maxGuests ? Math.min(100, (tier.used / tier.maxGuests) * 100) : 0;

  return (
    <li className="border-line bg-elev rounded-card border p-4">
      {editing ? (
        <div className="flex flex-col gap-3">
          <TierEditFields fields={fields} setFields={setFields} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary text-sm disabled:opacity-50" disabled={pending} onClick={save}>
              {pending ? '…' : 'Opslaan'}
            </button>
            <button type="button" className="btn-ghost text-sm" disabled={pending} onClick={() => setEditing(false)}>
              Annuleren
            </button>
            <button
              type="button"
              className="btn-ghost text-acc-soft ml-auto text-sm"
              disabled={pending}
              onClick={remove}
            >
              Verwijderen
            </button>
          </div>
          {error && (
            <p className="text-acc-soft text-sm" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full"
              style={{ background: tier.color ?? 'rgba(255,255,255,0.4)' }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="font-display text-text font-bold">{tier.name}</p>
              <p className="text-faint text-xs">
                {tier.maxGuests ? `${tier.used} / ${tier.maxGuests} bezet` : `${tier.used} · geen max`}
                {tier.description ? ` · ${tier.description}` : ''}
              </p>
            </div>
            <button type="button" className="btn-ghost text-xs" onClick={() => setEditing(true)}>
              Bewerken
            </button>
          </div>
          {tier.maxGuests != null && (
            <div className="bg-elev2 h-1.5 overflow-hidden rounded-full">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tier.color ?? '#B5A6FF' }} />
            </div>
          )}
          {tier.aliases.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tier.aliases.map((a) => (
                <span key={a} className="border-line bg-elev2 text-dim rounded-md border px-2 py-0.5 font-mono text-xs">
                  {a}
                </span>
              ))}
            </div>
          )}
          {error && (
            <p className="text-acc-soft text-sm" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function AddTierForm({ eventId }: { eventId: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<TierFields>(emptyFields);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    setError(null);
    const max = parseMax(fields.maxGuests);
    if (max.error) {
      setError(max.error);
      return;
    }
    startTransition(async () => {
      const res = await createTier({
        eventId,
        name: fields.name,
        description: fields.description,
        color: fields.color,
        maxGuests: max.value,
        aliases: textToAliases(fields.aliasesText),
      });
      if (res.ok) {
        setFields(emptyFields());
        setOpen(false);
      } else {
        setError(res.message);
      }
    });
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary w-full text-sm" onClick={() => setOpen(true)}>
        + Tier toevoegen
      </button>
    );
  }

  return (
    <div className="border-acc bg-elev rounded-card flex flex-col gap-3 border p-4">
      <p className="label">Nieuwe tier</p>
      <TierEditFields fields={fields} setFields={setFields} />
      <div className="flex gap-2">
        <button type="button" className="btn-primary text-sm disabled:opacity-50" disabled={pending} onClick={create}>
          {pending ? '…' : 'Tier aanmaken'}
        </button>
        <button type="button" className="btn-ghost text-sm" disabled={pending} onClick={() => setOpen(false)}>
          Annuleren
        </button>
      </div>
      {error && (
        <p className="text-acc-soft text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function TierManager({
  eventId,
  tiers,
  canManage,
}: {
  eventId: string;
  tiers: EventTierRow[];
  canManage: boolean;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="label">Tiers ({tiers.length})</h2>
      </div>
      <p className="text-faint text-xs">
        Tiers werken als tickettypes. Aliassen bepalen wat de quick-add herkent (“fles” → VIP). Een
        max begrenst het aantal gasten in de tier.
      </p>

      {tiers.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {tiers.map((t) => (
            <TierRow key={t.id} tier={t} />
          ))}
        </ul>
      ) : (
        <p className="text-dim text-sm">Nog geen tiers. Voeg er minstens één toe (bijv. “Regular”).</p>
      )}

      {canManage && <AddTierForm eventId={eventId} />}
    </section>
  );
}
