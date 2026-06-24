'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { assignOrganizer, inviteOrganizer, removeOrganizer } from '../actions';
import type { AssignableMember, EventOrganizerRow } from '../queries';

/**
 * Organizer assignment (#6/#24). Assigning an organizer is a sensitive scope
 * grant: admin + AAL2 (RLS). Two paths: pick an existing user (venue member),
 * or invite a new — possibly external — person by e-mail (no venue membership
 * is created, #24). Removing a scope never touches the account.
 */
export function OrganizerManager({
  eventId,
  organizers,
  candidates,
  isAdmin,
  isAal2,
  hasVerifiedTotp,
}: {
  eventId: string;
  organizers: EventOrganizerRow[];
  candidates: AssignableMember[];
  isAdmin: boolean;
  isAal2: boolean;
  hasVerifiedTotp: boolean;
}): JSX.Element {
  const canManage = isAdmin && isAal2;

  const [selected, setSelected] = useState(candidates[0]?.userId ?? '');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function assign() {
    if (!selected) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await assignOrganizer({ eventId, userId: selected });
      if (!res.ok) setError(res.message);
    });
  }

  function invite() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await inviteOrganizer({ eventId, email });
      if (res.ok) {
        setEmail('');
        setNotice('Organizer set up. They log in at /login with this email.');
      } else {
        setError(res.message);
      }
    });
  }

  function remove(userId: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await removeOrganizer({ eventId, userId });
      if (!res.ok) setError(res.message);
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="label">Organizers ({organizers.length})</h2>

      {organizers.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {organizers.map((o) => (
            <li
              key={o.userId}
              className="card flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">{o.fullName}</p>
                <p className="text-faint truncate text-sm">{o.email}</p>
              </div>
              {canManage && (
                <button
                  type="button"
                  className="btn-ghost text-acc-soft text-xs"
                  disabled={pending}
                  onClick={() => remove(o.userId)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-dim text-sm">No organizer assigned yet.</p>
      )}

      {!isAdmin ? (
        <p className="text-faint text-xs">Only an admin can assign organizers.</p>
      ) : !isAal2 ? (
        <div className="border-acc-dim bg-acc-dim rounded-card border p-4 text-sm">
          <p className="text-text font-semibold">MFA required</p>
          <p className="text-dim mt-1">
            Assigning an organizer needs an MFA-verified session.{' '}
            <Link href={hasVerifiedTotp ? '/mfa/verify' : '/mfa/enroll'} className="text-acc-soft underline">
              {hasVerifiedTotp ? 'Verify with your authenticator' : 'Set up MFA'}
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="border-line flex flex-col gap-4 rounded-card border p-4">
          {candidates.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="label">Assign an existing user</span>
              <div className="flex flex-wrap gap-2">
                <select
                  className="field min-w-0 flex-1"
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {candidates.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.fullName} — {c.email}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn-primary text-sm disabled:opacity-50"
                  disabled={pending || !selected}
                  onClick={assign}
                >
                  Assign
                </button>
              </div>
            </div>
          )}

          <div className="border-line2 flex flex-col gap-2 border-t pt-4">
            <span className="label">Invite a new organizer</span>
            <p className="text-faint text-xs">
              Creates an account (also for external organizers, with no venue access). The first
              OTP login activates it.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                type="email"
                inputMode="email"
                autoComplete="off"
                className="field min-w-0 flex-1"
                placeholder="organizer@external.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary text-sm disabled:opacity-50"
                disabled={pending || !email}
                onClick={invite}
              >
                Invite
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <p className="text-acc-soft text-sm" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-acc-soft text-sm" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
