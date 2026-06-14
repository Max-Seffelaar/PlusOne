'use client';

import { useState, useTransition } from 'react';
import { changeEventStatus } from '../actions';
import {
  allowedTransitions,
  STATUS_DESCRIPTIONS,
  type EventStatus,
  type StatusTransition,
} from '../status';
import { StatusBadge } from './StatusBadge';

/**
 * Status lifecycle control. Offers only the moves the caller's role may make
 * (mirrors the DB trigger); the database is still the boundary and rejects
 * anything else with SQLSTATE 45004. Sensitive steps (go-live, un-live) ask for
 * confirmation first, surfacing the same warning the spec attaches to #22.
 */
export function EventStatusControl({
  eventId,
  status,
  isAdmin,
}: {
  eventId: string;
  status: EventStatus;
  isAdmin: boolean;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<StatusTransition | null>(null);
  const [pending, startTransition] = useTransition();

  const moves = allowedTransitions(status, { isAdmin });

  function run(to: EventStatus) {
    setError(null);
    startTransition(async () => {
      const res = await changeEventStatus({ eventId, status: to });
      if (!res.ok) setError(res.message);
      setConfirming(null);
    });
  }

  function onClick(t: StatusTransition) {
    if (t.warning) setConfirming(t);
    else run(t.to);
  }

  return (
    <section className="card flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="label">Status</h2>
        <StatusBadge status={status} />
      </div>
      <p className="text-dim text-sm">{STATUS_DESCRIPTIONS[status]}</p>

      {moves.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {moves.map((t) => (
            <button
              key={t.to}
              type="button"
              disabled={pending}
              onClick={() => onClick(t)}
              className={`${t.requiresAdmin ? 'btn-dark' : 'btn-primary'} text-sm disabled:opacity-50`}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-faint text-sm">Geen statuswijzigingen beschikbaar.</p>
      )}

      {confirming && (
        <div className="border-acc bg-acc-dim rounded-card flex flex-col gap-3 border p-3 text-sm">
          <p className="text-text font-semibold">{confirming.label}?</p>
          <p className="text-dim">{confirming.warning}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary text-sm disabled:opacity-50"
              disabled={pending}
              onClick={() => run(confirming.to)}
            >
              {pending ? '…' : 'Bevestigen'}
            </button>
            <button
              type="button"
              className="btn-ghost text-sm"
              disabled={pending}
              onClick={() => setConfirming(null)}
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-acc-soft text-sm" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
