'use client';

import { useActionState } from 'react';
import { revokeInviteAction, type ActionState } from '../invite-actions';

const INITIAL: ActionState = { ok: false };

export function RevokeInviteButton({ inviteId }: { inviteId: string }): JSX.Element {
  const [state, formAction, pending] = useActionState(revokeInviteAction, INITIAL);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="inviteId" value={inviteId} />
      <button
        type="submit"
        className="btn-ghost text-xs"
        disabled={pending}
        onClick={(e) => {
          if (!window.confirm('Uitnodiging intrekken?')) e.preventDefault();
        }}
      >
        {pending ? '…' : 'Intrekken'}
      </button>
      {!state.ok && state.error && <span className="text-xs text-red-300">{state.error}</span>}
    </form>
  );
}
