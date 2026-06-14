'use client';

import { useState, useTransition } from 'react';
import { setListLock } from '../actions';
import { ListLockBanner } from './ListLockBanner';

/**
 * Lock/unlock the guest list (#23). Available to admin and organizer; the lock
 * itself is enforced by RLS (staff lose guest mutations) and audited (fase 3
 * trigger writes lock/unlock).
 */
export function LockControl({
  eventId,
  locked,
}: {
  eventId: string;
  locked: boolean;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const res = await setListLock({ eventId, locked: !locked });
      if (!res.ok) setError(res.message);
    });
  }

  return (
    <section className="card flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="label">Lijst-lock</h2>
          <p className="text-dim mt-0.5 text-sm">
            {locked
              ? 'Vergrendeld. Staff kan niet meer muteren.'
              : 'Open. Typisch vergrendel je bij deuropening.'}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={toggle}
          className={`${locked ? 'btn-primary' : 'btn-dark'} text-sm disabled:opacity-50`}
        >
          {locked ? 'Ontgrendelen' : 'Vergrendelen'}
        </button>
      </div>

      <ListLockBanner locked={locked} />

      {error && (
        <p className="text-acc-soft text-sm" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
