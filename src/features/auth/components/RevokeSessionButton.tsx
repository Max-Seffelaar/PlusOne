'use client';

import { useActionState } from 'react';
import { revokeOwnSessionAction, adminRevokeSessionAction, type ActionState } from '../session-actions';

const INITIAL: ActionState = { ok: false };

export function RevokeSessionButton({
  sessionId,
  admin = false,
  label,
}: {
  sessionId: string;
  admin?: boolean;
  label: string;
}): JSX.Element {
  const action = admin ? adminRevokeSessionAction : revokeOwnSessionAction;
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="sessionId" value={sessionId} />
      <button
        type="submit"
        className="btn-ghost text-xs"
        disabled={pending}
        onClick={(e) => {
          if (!window.confirm(admin ? 'Log out this device remotely?' : 'End this session?'))
            e.preventDefault();
        }}
      >
        {pending ? '…' : label}
      </button>
      {!state.ok && state.error && <span className="text-xs text-red-300">{state.error}</span>}
    </form>
  );
}
