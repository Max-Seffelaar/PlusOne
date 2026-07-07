'use client';

import { useState, useTransition } from 'react';
import { approveGuestRequest, denyGuestRequest } from '../actions';

export interface PendingGuestRequest {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  plusOnes: number;
  motivation: string | null;
  birthdate: string | null;
  createdAt: string;
}

export interface TierOption {
  id: string;
  name: string;
}

/**
 * Admin/organizer inbox for landing-page requests (#12). Badge + list; approve
 * (pick a tier → guest with source=landing, #31) or deny with a reason. Landing
 * approvals fall OUTSIDE the approver's personal quota but still count toward
 * tier-max — a full tier is rejected by the DB and surfaced here.
 */
export function GuestRequestsInbox({
  eventId,
  requests,
  tiers,
}: {
  eventId: string;
  requests: PendingGuestRequest[];
  tiers: TierOption[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="label">Landing page requests</p>
        {requests.length > 0 && (
          <span className="rounded-full bg-acc px-2 py-0.5 text-xs font-bold text-on-acc">
            {requests.length}
          </span>
        )}
      </div>

      <p className="text-sm text-dim">
        Requests fall <b>outside</b> your own quota. Approving one costs you no spot,
        but still counts toward the tier max.
      </p>

      {requests.length === 0 ? (
        <div className="card">
          <p className="text-sm text-dim">No requests right now. The line&apos;s clear.</p>
        </div>
      ) : (
        requests.map((r) => (
          <RequestRow key={r.id} eventId={eventId} request={r} tiers={tiers} />
        ))
      )}
    </section>
  );
}

function RequestRow({
  eventId,
  request,
  tiers,
}: {
  eventId: string;
  request: PendingGuestRequest;
  tiers: TierOption[];
}) {
  const [tierId, setTierId] = useState(tiers[0]?.id ?? '');
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const heads = 1 + request.plusOnes;
  const contact = [request.phone, request.email].filter(Boolean).join(' · ');

  function approve() {
    setError(null);
    startTransition(async () => {
      const res = await approveGuestRequest({ requestId: request.id, tierId, eventId });
      if (!res.ok) setError(res.message);
      // On success the server revalidates and the row disappears.
    });
  }

  function deny() {
    setError(null);
    startTransition(async () => {
      const res = await denyGuestRequest({ requestId: request.id, reason, eventId });
      if (!res.ok) setError(res.message);
    });
  }

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display">
          {request.fullName}
          {request.plusOnes > 0 && <span className="text-acc"> +{request.plusOnes}</span>}
          <span className="text-faint"> · {heads} {heads === 1 ? 'person' : 'people'}</span>
        </p>
        <span className="text-xs text-faint">
          {new Date(request.createdAt).toLocaleDateString('en-GB')}
        </span>
      </div>
      {contact && <p className="text-sm text-dim">{contact}</p>}
      {request.birthdate && (
        <p className="text-sm text-faint">
          Born {new Date(request.birthdate).toLocaleDateString('en-GB')}
        </p>
      )}
      {request.motivation && <p className="text-sm text-dim">“{request.motivation}”</p>}

      {denying ? (
        <div className="flex flex-col gap-2">
          <textarea
            className="field min-h-[3.5rem] text-sm"
            placeholder="Reason for declining (required)"
            aria-label="Reason for declining"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary disabled:opacity-50"
              disabled={pending || reason.trim() === ''}
              onClick={deny}
            >
              Confirm decline
            </button>
            <button type="button" className="btn-ghost" onClick={() => setDenying(false)}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1">
            <span className="label">Tier</span>
            <select
              className="field"
              aria-label={`Tier for ${request.fullName}`}
              value={tierId}
              onChange={(e) => setTierId(e.target.value)}
              disabled={tiers.length === 0}
            >
              {tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-primary disabled:opacity-50"
              disabled={pending || tiers.length === 0 || tierId === ''}
              onClick={approve}
            >
              {pending ? '…' : 'Approve'}
            </button>
            <button
              type="button"
              className="btn-dark"
              disabled={pending}
              onClick={() => setDenying(true)}
            >
              Decline
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-acc-soft">{error}</p>}
    </div>
  );
}
