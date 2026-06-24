'use client';

import { useActionState, useEffect, useState } from 'react';
import { updateMemberRolesAction, type ActionState } from '../actions';
import { VENUE_ROLES, ROLE_LABELS, type VenueRole } from '@/features/auth/roles';

const INITIAL: ActionState = { ok: false };

// Edit a member's roles (AAL2 — sensitive). Mirrors the InviteForm role picker:
// the admin role is only selectable by an admin (escalation guard, also in RLS).
// Collapsed by default to keep the member list scannable.
export function MemberRolesEditor({
  venueId,
  userId,
  memberName,
  currentRoles,
  callerIsAdmin,
}: {
  venueId: string;
  userId: string;
  memberName: string;
  currentRoles: VenueRole[];
  callerIsAdmin: boolean;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(updateMemberRolesAction, INITIAL);

  // Close the editor once the change lands; the list re-renders with new badges.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok, state.message]);

  if (!open) {
    return (
      <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(true)}>
        Edit roles
      </button>
    );
  }

  return (
    <form action={formAction} className="border-line bg-bg/40 flex w-full flex-col gap-3 rounded-field border p-3">
      <input type="hidden" name="venueId" value={venueId} />
      <input type="hidden" name="userId" value={userId} />

      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1">Roles for {memberName}</legend>
        <div className="grid grid-cols-2 gap-2">
          {VENUE_ROLES.map((role: VenueRole) => {
            const disabled = role === 'admin' && !callerIsAdmin;
            return (
              <label
                key={role}
                className={`rounded-field flex items-center gap-2 border px-3 py-2 text-sm transition-colors ${
                  disabled
                    ? 'border-line2 text-faint cursor-not-allowed'
                    : 'border-line text-text hover:border-acc cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  name="roles"
                  value={role}
                  defaultChecked={currentRoles.includes(role)}
                  disabled={disabled}
                  className="accent-acc"
                />
                {ROLE_LABELS[role]}
              </label>
            );
          })}
        </div>
        {!callerIsAdmin && (
          <p className="text-faint text-xs">Only an admin can grant or revoke the admin role.</p>
        )}
      </fieldset>

      <div className="flex items-center gap-2">
        <button type="submit" className="btn-primary text-sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn-ghost text-sm" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
      </div>

      {!state.ok && state.error && (
        <p className="text-sm text-red-300" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
