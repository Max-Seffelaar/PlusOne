'use client';

import { useState, useTransition } from 'react';
import { setListLock, setAutoLock } from '../actions';
import { isEffectivelyLocked } from '../lock';
import { isoToLocalInput, localInputToIso } from '../datetime';
import { formatEventDate, formatEventTime } from '../format';
import { DateTimeField } from './DateTimeField';
import { ListLockBanner } from './ListLockBanner';

/**
 * Lock the guest list (#23): handmatig (direct) of gepland op een tijdstip.
 * Beide worden in de database afgedwongen (can_write_guests) — staff verliest
 * mutaties, admin/organisator/doorhost behouden ze. Handmatige lock/unlock wordt
 * gelogd (fase-3 trigger).
 */
export function LockControl({
  eventId,
  locked,
  autoLockAt,
}: {
  eventId: string;
  locked: boolean;
  autoLockAt: string | null;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [autoInput, setAutoInput] = useState(() => isoToLocalInput(autoLockAt));
  const [pending, startTransition] = useTransition();

  const effective = isEffectivelyLocked(locked, autoLockAt);
  const autoActive = autoLockAt != null;
  const autoPassed = autoActive && !locked && effective;

  function toggleManual() {
    setError(null);
    startTransition(async () => {
      const res = await setListLock({ eventId, locked: !locked });
      if (!res.ok) setError(res.message);
    });
  }

  function saveAuto() {
    setError(null);
    const iso = localInputToIso(autoInput);
    if (!iso) {
      setError('Kies een geldige datum en tijd voor de auto-lock.');
      return;
    }
    startTransition(async () => {
      const res = await setAutoLock({ eventId, autoLockAt: iso });
      if (!res.ok) setError(res.message);
    });
  }

  function clearAuto() {
    setError(null);
    setAutoInput('');
    startTransition(async () => {
      const res = await setAutoLock({ eventId, autoLockAt: null });
      if (!res.ok) setError(res.message);
    });
  }

  return (
    <section className="card flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="label">Lijst-lock</h2>
          <p className="text-dim mt-0.5 text-sm">
            {locked
              ? 'Handmatig vergrendeld. Staff kan niet meer muteren.'
              : 'Open. Typisch vergrendel je bij deuropening.'}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={toggleManual}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {locked ? 'Ontgrendelen' : 'Vergrendelen'}
        </button>
      </div>

      <div className="border-line2 flex flex-col gap-2 border-t pt-3">
        <span className="label">Automatisch vergrendelen op tijd</span>
        <p className="text-faint text-xs">
          Vanaf dit moment kan staff niets meer toevoegen of wijzigen (admin, organisator en doorhost
          wel).
        </p>
        {autoActive && (
          <p className="text-dim text-sm">
            {autoPassed ? 'Automatisch vergrendeld sinds ' : 'Vergrendelt automatisch op '}
            <span className="text-text font-semibold">
              {formatEventDate(autoLockAt)} · {formatEventTime(autoLockAt)}
            </span>
            .
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[14rem] flex-1">
            <DateTimeField value={autoInput} onChange={setAutoInput} placeholder="Kies datum en tijd" allowClear />
          </div>
          <button
            type="button"
            disabled={pending || !autoInput}
            onClick={saveAuto}
            className="btn-secondary text-sm disabled:opacity-50"
          >
            {autoActive ? 'Bijwerken' : 'Instellen'}
          </button>
          {autoActive && (
            <button type="button" disabled={pending} onClick={clearAuto} className="btn-ghost text-sm">
              Uitzetten
            </button>
          )}
        </div>
      </div>

      <ListLockBanner locked={effective} />

      {error && (
        <p className="text-acc-soft text-sm" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
