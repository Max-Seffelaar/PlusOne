'use client';

// "Send confirmation" (Gastcommunicatie F, z8uq9m2vpy): the box on every
// add-guest path. Defaults to the company setting (Company settings > Guest
// contact, default on); the user can untick it per add. Only guests with an
// email get the mail, so the paths show it only when one is in play.

import { type JSX, useState } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useSendConfirmationDefault } from '@/features/po/company-contact';
import { ToggleRow } from '../../kit';

/** The box's state: the company default until the user flips it. */
export function useSendConfirmation(): [boolean, (v: boolean) => void] {
  const fallback = useSendConfirmationDefault();
  const [choice, setChoice] = useState<boolean | null>(null);
  return [choice ?? fallback, setChoice];
}

export function SendConfirmationRow({
  on,
  set,
  className,
}: {
  on: boolean;
  set: (v: boolean) => void;
  className?: string;
}): JSX.Element {
  return (
    <div data-testid="send-confirmation" className={cn('rounded-[14px] border border-line bg-elev px-4', className)}>
      <ToggleRow title={t.guests.mail.sendConfirmation} sub={t.guests.mail.sendConfirmationHint} on={on} set={set} last />
    </div>
  );
}
