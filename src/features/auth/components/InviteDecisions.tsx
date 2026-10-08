'use client';

/** The invitee's Accept / Decline, shared by the Home banner and the onboarding
 *  invite step (z8uq9m2yvp), so the two can never drift apart.
 *
 *  `useInviteDecisions` owns what both need: one action at a time, the error
 *  line, the "you declined" notice, and the set of cards to hide. A card hides
 *  once it is declined, or once the server says it is no longer open (expired,
 *  declined or accepted elsewhere, revoked): no dead buttons. Parents derive
 *  their list from THEIR data (props or a query) minus `isGone`, so a refetch or
 *  new props are always followed. Accepting never hides a card; the parent
 *  refreshes and the page re-resolves.
 *
 *  `InviteActions` is the button row for one invite. Decline asks first
 *  ("Decline this invite?" → Keep / Decline invite) because it is the one
 *  action that cannot be undone from this screen. */
import { type JSX, useCallback, useState, useTransition } from 'react';
import { fmt, t } from '@/lib/i18n';
import { Btn } from '@/components/po/kit';
import { acceptInviteAction, declineInviteAction } from '@/features/auth/invite-actions';

export interface DecisionInvite {
  id: string;
  /** The inviting company's name, for the "you declined" notice. */
  company: string;
}

export function useInviteDecisions({
  onAccepted,
  onChanged,
}: {
  /** Accept worked: refresh so identity, venue switcher and the page re-resolve. */
  onAccepted: () => void;
  /** Anything that changes the open list (decline, "no longer open"): refetch. */
  onChanged?: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<{ id: string; kind: 'accept' | 'decline' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declinedFrom, setDeclinedFrom] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const copy = t.shared.invites;

  const hide = useCallback((id: string) => setGone((prev) => new Set(prev).add(id)), []);

  const run = (kind: 'accept' | 'decline', invite: DecisionInvite): void => {
    setError(null);
    setDeclinedFrom(null);
    setBusy({ id: invite.id, kind });
    startTransition(async () => {
      const res = kind === 'accept' ? await acceptInviteAction(invite.id) : await declineInviteAction(invite.id);
      if (res.ok) {
        if (kind === 'accept') {
          onAccepted();
        } else {
          hide(invite.id);
          setDeclinedFrom(invite.company);
        }
        onChanged?.();
        return;
      }
      if (res.code === 'not_open') {
        hide(invite.id);
        setError(copy.notOpen);
        onChanged?.();
        return;
      }
      setError(kind === 'accept' ? copy.error : copy.declineError);
    });
  };

  return {
    pending,
    busy,
    error,
    declinedFrom,
    isGone: (id: string): boolean => gone.has(id),
    accept: (invite: DecisionInvite): void => run('accept', invite),
    decline: (invite: DecisionInvite): void => run('decline', invite),
  };
}

export function InviteActions({
  invite,
  pending,
  busyKind,
  onAccept,
  onDecline,
}: {
  invite: DecisionInvite;
  /** Any invite action is running: every button is disabled. */
  pending: boolean;
  /** What THIS card is doing, for its button label. */
  busyKind: 'accept' | 'decline' | null;
  onAccept: () => void;
  onDecline: () => void;
}): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const copy = t.shared.invites;

  if (confirming) {
    return (
      <div>
        <p className="mb-2 text-[13px] leading-[1.45] text-dim">{fmt(copy.confirmDecline, { company: invite.company })}</p>
        <div className="flex gap-2">
          <Btn kind="ghost" sm full disabled={pending} onClick={() => setConfirming(false)}>
            {copy.keep}
          </Btn>
          <Btn
            kind="danger"
            sm
            full
            disabled={pending}
            onClick={() => {
              setConfirming(false);
              onDecline();
            }}
          >
            {copy.declineConfirm}
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Btn kind="ghost" sm full disabled={pending} onClick={() => setConfirming(true)}>
        {busyKind === 'decline' ? copy.declining : copy.decline}
      </Btn>
      <Btn kind="primary" sm full icon="check" disabled={pending} onClick={onAccept}>
        {busyKind === 'accept' ? copy.accepting : copy.accept}
      </Btn>
    </div>
  );
}
