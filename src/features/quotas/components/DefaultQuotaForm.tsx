'use client';

import { useActionState } from 'react';
import { setDefaultQuotaAction, type ActionState } from '../default-quota-actions';

const INITIAL: ActionState = { ok: false };

// Inline default-quota editor for one member (admin only — RLS quotas_*_admin +
// AAL2). Read-only finance never renders this; it shows a plain number instead.
export function DefaultQuotaForm({
  venueId,
  userId,
  defaultCount,
}: {
  venueId: string;
  userId: string;
  defaultCount: number;
}): JSX.Element {
  const [state, formAction, pending] = useActionState(setDefaultQuotaAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="venueId" value={venueId} />
      <input type="hidden" name="userId" value={userId} />
      <div className="flex items-center gap-2">
        <label htmlFor={`quota-${userId}`} className="sr-only">
          Default allowance
        </label>
        <input
          id={`quota-${userId}`}
          name="defaultCount"
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          defaultValue={defaultCount}
          className="field w-20 py-1.5 text-right text-sm"
        />
        <button type="submit" className="btn-dark text-xs" disabled={pending}>
          {pending ? '…' : 'Save'}
        </button>
      </div>
      {state.ok && state.message && (
        <span className="text-acc-soft text-xs" role="status">
          {state.message}
        </span>
      )}
      {!state.ok && state.error && (
        <span className="text-xs text-red-300" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}
