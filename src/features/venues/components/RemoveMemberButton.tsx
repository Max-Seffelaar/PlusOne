'use client';

import { type JSX, useActionState, useState } from 'react';
import { removeMemberAction, type ActionState } from '../actions';

const INITIAL: ActionState = { ok: false };

// Remove a membership with an EXPLICIT, EXPLAINED confirmation (decision #24):
// the panel spells out that only this venue's access is revoked — the account
// and any other venue/event access survive. `disabledReason` (e.g. last admin)
// blocks the action up front with a clear hint.
export function RemoveMemberButton({
  venueId,
  userId,
  memberName,
  venueName,
  disabledReason,
}: {
  venueId: string;
  userId: string;
  memberName: string;
  venueName: string;
  disabledReason?: string;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(removeMemberAction, INITIAL);

  if (disabledReason) {
    return (
      <span className="text-faint text-xs" title={disabledReason}>
        Can&apos;t remove
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn-ghost text-xs text-red-300"
        onClick={() => setConfirming(true)}
      >
        Remove
      </button>
    );
  }

  return (
    <div className="border-line bg-bg/40 flex w-full flex-col gap-3 rounded-field border p-3">
      <p className="text-sm">
        Remove <span className="font-semibold">{memberName}</span> from{' '}
        <span className="font-semibold">{venueName}</span>?
      </p>
      <p className="text-faint text-xs">
        This only revokes access to <span className="text-dim">this</span> venue. The account stays, and
        access to other venues or events doesn&apos;t change. This action is logged.
      </p>
      <form action={formAction} className="flex items-center gap-2">
        <input type="hidden" name="venueId" value={venueId} />
        <input type="hidden" name="userId" value={userId} />
        <button type="submit" className="btn-dark text-sm text-red-300" disabled={pending}>
          {pending ? 'Removing…' : 'Remove for good'}
        </button>
        <button
          type="button"
          className="btn-ghost text-sm"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Cancel
        </button>
      </form>
      {!state.ok && state.error && (
        <p className="text-sm text-red-300" role="alert">
          {state.error}
        </p>
      )}
    </div>
  );
}
