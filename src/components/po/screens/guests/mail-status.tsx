'use client';

// The confirmation-mail state of a guest (ClickUp z8uq9m49k1): a short line
// in the guest list rows, and in the guest's event sheet the line plus
// "Resend confirmation" when the database allows it (not sent or failed; after
// a bounce only once the address has changed). The rules live in the database
// (guest_confirmation_state); this file only shows them.

import type { JSX } from 'react';
import { fmt, t } from '@/lib/i18n';
import type { ConfirmationState, GuestConfirmation } from '@/features/po/guest-mail-status';
import { usePoResendConfirmation } from '@/features/po/guest-mail-status';
import { Btn, Note } from '../../kit';

const PROBLEM: readonly ConfirmationState[] = ['not_sent', 'bounced', 'complained', 'failed'];

export function confirmationLabel(state: ConfirmationState): string {
  const m = t.guests.mail;
  switch (state) {
    case 'not_sent':
      return m.statusNotSent;
    case 'queued':
      return m.statusQueued;
    case 'sent':
      return m.statusSent;
    case 'delivered':
      return m.statusDelivered;
    case 'bounced':
      return m.statusBounced;
    case 'complained':
      return m.statusComplained;
    case 'failed':
      return m.statusFailed;
    case 'opted_out':
      return m.statusOptedOut;
  }
}

/** "Confirmation: Delivered", as a span the row can place in its subline. */
export function MailStatusTag({ status, className }: { status: GuestConfirmation | undefined; className?: string }): JSX.Element | null {
  if (!status) return null;
  return (
    <span
      data-testid="guest-mail-status"
      data-state={status.state}
      className={className}
      style={PROBLEM.includes(status.state) ? { fontWeight: 700 } : undefined}
    >
      {fmt(t.guests.mail.statusLabel, { status: confirmationLabel(status.state) })}
    </span>
  );
}

/** The guest's event sheet: the state, the bounce hint, and the resend button. */
export function ConfirmationBlock({
  guestId,
  eventId,
  status,
  mayEdit,
}: {
  guestId: string;
  eventId: string;
  status: GuestConfirmation | undefined;
  /** The viewer may edit this guest (the database checks again). */
  mayEdit: boolean;
}): JSX.Element | null {
  const m = t.guests.mail;
  const resend = usePoResendConfirmation(eventId);
  if (!status) return null;
  return (
    <div data-testid="guest-confirmation" className="flex flex-col gap-2 rounded-[14px] border border-line bg-elev px-4 py-3">
      <MailStatusTag status={status} className="font-body text-[13.5px] text-text" />
      {status.needsNewAddress && (
        <p className="text-[12.5px] leading-[1.45] text-faint">
          {status.state === 'complained' ? m.complainedHint : m.bouncedHint}
        </p>
      )}
      {status.canResend && mayEdit && (
        <Btn
          kind="ghost"
          full
          onClick={() => resend.mutate(guestId)}
          disabled={resend.isPending || resend.isSuccess}
        >
          {resend.isPending ? m.resending : m.resend}
        </Btn>
      )}
      {resend.isSuccess && <Note icon="mail">{m.resent}</Note>}
      {resend.isError && <Note icon="mail">{resend.error.message}</Note>}
    </div>
  );
}
