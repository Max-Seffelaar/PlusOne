'use client';

/**
 * Refuse-guest modal for the desktop cockpit (G2 door-parity) — the online
 * equivalent of the door's refuse sheet (`GuestDetail.tsx`). Reuses the door's
 * copy (`t.door.refuse*`/`cancel`) rather than a parallel cockpit-only string
 * set. Styled like the cockpit's existing quantified check-in/out modal
 * (`EventDayCockpit.tsx`) so it doesn't read as a foreign pattern.
 */
import { type JSX, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { Btn } from '@/components/po/kit';
import type { Guest } from '@/lib/po/types';

export function CockpitRefuseModal({
  guest,
  onCancel,
  onConfirm,
}: {
  guest: Guest;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-[360px] rounded-[18px] border border-line bg-elev p-5" onClick={(e) => e.stopPropagation()}>
        <div className="font-display text-[17px] font-bold text-text">{t.door.refuseTitle}</div>
        <div className="mt-0.5 text-[12.5px] text-faint">{t.door.refuseSub}</div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          autoFocus
          placeholder={t.door.refusePlaceholder}
          className="mt-3 w-full resize-none rounded-[12px] border border-line bg-bg p-[12px] font-body text-[14px] leading-[1.5] text-text outline-none placeholder:text-faint"
        />
        <div className="mt-4 flex gap-2">
          <Btn desktop kind="ghost" className="flex-1 justify-center" onClick={onCancel}>
            {t.door.cancel}
          </Btn>
          <Btn
            desktop
            className={cn('flex-1 justify-center', trimmed.length === 0 && 'opacity-[0.45]')}
            disabled={trimmed.length === 0}
            onClick={() => onConfirm(trimmed)}
          >
            {fmt(t.door.refuseConfirm, { name: guest.name })}
          </Btn>
        </div>
      </div>
    </div>
  );
}
