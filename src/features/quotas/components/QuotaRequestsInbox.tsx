'use client';

import { useState, useTransition } from 'react';
import { decideQuotaRequest } from '../actions';

export interface PendingRequest {
  id: string;
  requesterName: string;
  requestedExtra: number;
  motivation: string | null;
  createdAt: string;
}

/**
 * Admin inbox for open quota requests (#5). Badge + list; approve (writes the
 * override via the AAL2-gated RPC) or deny with a reason. The DB rejects an
 * approval without AAL2 — surfaced here as an error.
 */
export function QuotaRequestsInbox({
  eventId,
  requests,
}: {
  eventId: string;
  requests: PendingRequest[];
}) {
  if (requests.length === 0) {
    return (
      <div className="card">
        <p className="label mb-1">Quota-verzoeken</p>
        <p className="text-sm text-dim">Geen open verzoeken.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="label">Quota-verzoeken</p>
        <span className="rounded-full bg-acc px-2 py-0.5 text-xs font-bold text-on-acc">
          {requests.length}
        </span>
      </div>
      {requests.map((r) => (
        <RequestRow key={r.id} eventId={eventId} request={r} />
      ))}
    </div>
  );
}

function RequestRow({ eventId, request }: { eventId: string; request: PendingRequest }) {
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: 'approved' | 'denied') {
    setError(null);
    startTransition(async () => {
      const res = await decideQuotaRequest({
        requestId: request.id,
        decision,
        reason: decision === 'denied' ? reason : undefined,
        eventId,
      });
      if (!res.ok) setError(res.message);
      // On success the server revalidates and the row disappears from the list.
    });
  }

  return (
    <div className="card flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display">
          {request.requesterName}{' '}
          <span className="text-acc">+{request.requestedExtra}</span>
        </p>
        <span className="text-xs text-faint">
          {new Date(request.createdAt).toLocaleDateString('nl-NL')}
        </span>
      </div>
      {request.motivation && <p className="text-sm text-dim">{request.motivation}</p>}

      {denying ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="field min-h-[3.5rem] text-sm"
            placeholder="Reden van afwijzing (verplicht)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary disabled:opacity-50"
              disabled={pending || reason.trim() === ''}
              onClick={() => decide('denied')}
            >
              Afwijzen bevestigen
            </button>
            <button type="button" className="btn-ghost" onClick={() => setDenying(false)}>
              Terug
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-primary disabled:opacity-50"
            disabled={pending}
            onClick={() => decide('approved')}
          >
            {pending ? '…' : 'Goedkeuren'}
          </button>
          <button type="button" className="btn-dark" disabled={pending} onClick={() => setDenying(true)}>
            Afwijzen
          </button>
        </div>
      )}
      {error && <p className="text-sm text-acc-soft">{error}</p>}
    </div>
  );
}
