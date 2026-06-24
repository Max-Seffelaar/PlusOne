'use client';

import { useState, useTransition } from 'react';
import { updateGuest, changeGuestTier, removeGuest } from '../actions';

export interface EditableGuest {
  id: string;
  full_name: string;
  plus_ones: number;
  email: string | null;
  phone: string | null;
  note: string | null;
  note_priority: 'none' | 'low' | 'high';
  tier_id: string;
  status: string;
}

interface GuestEditFormProps {
  guest: EditableGuest;
  tiers: Array<{ id: string; name: string }>;
}

/**
 * Classic edit form for an existing guest (#33 "daarnaast een klassiek
 * bewerk-formulier"). Field edits go through updateGuest; a tier move is a
 * separate action so it logs cleanly as tier_change (#5). Remove = soft delete
 * (#21). Quota/tier-max breaches surface as inline errors.
 */
export function GuestEditForm({ guest, tiers }: GuestEditFormProps) {
  const [fullName, setFullName] = useState(guest.full_name);
  const [plusOnes, setPlusOnes] = useState(guest.plus_ones);
  const [email, setEmail] = useState(guest.email ?? '');
  const [phone, setPhone] = useState(guest.phone ?? '');
  const [note, setNote] = useState(guest.note ?? '');
  const [notePriority, setNotePriority] = useState(guest.note_priority);
  const [tierId, setTierId] = useState(guest.tier_id);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const removed = guest.status === 'removed';

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await updateGuest({
        guestId: guest.id,
        fullName,
        plusOnes,
        email,
        phone,
        note,
        notePriority,
      });
      if (res.ok) setSaved(true);
      else setError(res.message);
    });
  }

  function moveTier(next: string) {
    const previous = tierId;
    setTierId(next);
    setError(null);
    startTransition(async () => {
      const res = await changeGuestTier({ guestId: guest.id, tierId: next });
      if (!res.ok) {
        setTierId(previous); // revert optimistic change on failure (e.g. tier full)
        setError(res.message);
      }
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await removeGuest(guest.id);
      if (!res.ok) setError(res.message);
    });
  }

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="label">Edit guest</p>
        {removed && <span className="text-xs text-faint">Removed</span>}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Name
        <input className="field" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Plus-ones
          <input
            type="number"
            min={0}
            max={50}
            className="field w-24"
            value={plusOnes}
            onChange={(e) => setPlusOnes(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tier
          <select className="field" value={tierId} onChange={(e) => moveTier(e.target.value)}>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Email <span className="text-faint">(optional)</span>
          <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Phone <span className="text-faint">(optional)</span>
          <input className="field" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Note
        <textarea className="field min-h-[3rem]" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Note priority
        <select
          className="field w-40"
          value={notePriority}
          onChange={(e) => setNotePriority(e.target.value as EditableGuest['note_priority'])}
        >
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="high">High · heads up</option>
        </select>
      </label>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary disabled:opacity-50" disabled={pending} onClick={save}>
          {pending ? '…' : 'Save'}
        </button>
        {!removed && (
          <button type="button" className="btn-ghost" disabled={pending} onClick={remove}>
            Remove guest
          </button>
        )}
      </div>

      {saved && <p className="text-sm text-acc">Saved.</p>}
      {error && <p className="text-sm text-acc-soft">{error}</p>}
    </div>
  );
}
