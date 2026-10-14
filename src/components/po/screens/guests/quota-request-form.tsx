'use client';

/**
 * The quota request form (#5): motivation, optionally the guest the spots are
 * for (z8uq9m2xyp), Send / Cancel. One form for both entry points:
 *   - Add guest, over quota: the spots are what the typed guest needs and the
 *     guest toggle is offered (quick-add.tsx owns that state);
 *   - the event's guest list, "Request more spots" (z8uq9m5kux): no guest, the
 *     requester picks the number with a stepper.
 * The database fixes the number for a named guest whatever is sent here
 * (fit_quota_request_to_guest), so a stale quota hint can't under-ask.
 */
import { type JSX, useState } from 'react';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import { QUOTA_EXTRA_MAX } from '@/features/quotas/schemas';
import { usePoEventForEdit, usePoQuota } from '@/features/po/hooks';
import { usePoRequestExtraSlots } from '@/features/po/mutations';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { canManageGuests } from '@/features/auth/roles';
import { Icon } from '../../icon';
import { Btn, CountStepper, Label, ToggleRow } from '../../kit';

export function QuotaRequestForm({
  spots,
  onSpots,
  motivation,
  onMotivation,
  guest,
  pending,
  error,
  onSend,
  onCancel,
}: {
  spots: number;
  /** Given → a stepper (1..QUOTA_EXTRA_MAX); left out → a fixed label. */
  onSpots?: (n: number) => void;
  motivation: string;
  onMotivation: (v: string) => void;
  /** The typed guest ("Lisa de Vries +1") and whether to send them along. */
  guest?: { label: string; on: boolean; set: (v: boolean) => void };
  pending: boolean;
  error: string | null;
  onSend: () => void;
  onCancel: () => void;
}): JSX.Element {
  const slots = spots === 1 ? t.guests.add.slotOne : t.guests.add.slotMany;
  const blocked = pending || motivation.trim() === '';
  return (
    <div className="mt-[10px] flex flex-col gap-[10px] rounded-[16px] border border-line bg-elev p-[14px]" data-testid="quota-request-form">
      {onSpots ? (
        <div className="flex items-center gap-[11px]">
          <Label className="min-w-0 flex-1">{t.guests.add.requestSpotsLabel}</Label>
          <div data-testid="quota-request-spots">
            <CountStepper
              value={spots}
              min={1}
              max={QUOTA_EXTRA_MAX}
              onChange={onSpots}
              lessLabel={t.guests.add.requestSpotsLess}
              moreLabel={t.guests.add.requestSpotsMore}
            />
          </div>
        </div>
      ) : (
        <Label>{fmt(t.guests.add.requestExtraLabel, { n: spots, slots })}</Label>
      )}
      <textarea
        autoFocus
        value={motivation}
        onChange={(e) => onMotivation(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder={t.guests.add.requestMotivPlaceholder}
        className="w-full resize-none rounded-[12px] border border-line bg-bg px-[13px] py-[11px] text-[14px] text-text outline-none placeholder:text-faint focus:border-acc"
      />
      {guest && (
        <div className="rounded-[12px] border border-line bg-bg px-[13px]" data-testid="quota-request-with-guest">
          <ToggleRow title={fmt(t.guests.add.requestWithGuest, { guest: guest.label })} on={guest.on} set={guest.set} last />
        </div>
      )}
      {error && (
        <p className="text-[12.5px] text-acc" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Btn kind="primary" icon="check" className={cn(blocked && 'opacity-[0.45]')} disabled={blocked} onClick={onSend}>
          {pending ? t.guests.add.sending : t.guests.add.send}
        </Btn>
        <Btn kind="ghost" onClick={onCancel}>
          {t.guests.add.cancel}
        </Btn>
      </div>
    </div>
  );
}

/**
 * The event guest list's quota row (z8uq9m5kux): "Your quota · n of m left" and
 * "Request more spots", which opens the form above without a guest. Only for
 * someone who adds guests under a personal quota (staff, doorhost, crew), not
 * for a quota-exempt role or one that can't add guests. Online-only write via
 * the shared server action (not door-adjacent).
 */
export function GuestListQuotaBar({ eventId }: { eventId: string }): JSX.Element | null {
  const { data: quota } = usePoQuota(eventId);
  const { roles } = usePoIdentity();
  const { canManage } = usePoEventForEdit(eventId);
  const request = usePoRequestExtraSlots(eventId);
  const [open, setOpen] = useState(false);
  const [spots, setSpots] = useState(1);
  const [motivation, setMotivation] = useState('');

  if (!quota || quota.exempt || quota.remaining === null) return null;
  if (!(canManageGuests(roles) || canManage)) return null;

  const close = (): void => {
    setOpen(false);
    setMotivation('');
    setSpots(1);
  };

  return (
    <div className="flex-none px-4 pb-3" data-testid="guest-list-quota">
      <div className="flex items-center gap-[10px] rounded-[13px] border border-line bg-elev px-[14px] py-[9px]">
        <Icon name="ticket" size={16} stroke="rgba(255,255,255,0.40)" />
        <span className="min-w-0 flex-1 text-[13px] text-text">
          {fmt(t.guests.add.quotaBar, { n: quota.remaining, m: quota.quota })}
        </span>
        {!open && !request.isSuccess && (
          <Btn sm kind="ghost" icon="plus" className="min-h-[44px]" onClick={() => setOpen(true)}>
            {t.guests.add.requestMoreSpots}
          </Btn>
        )}
      </div>
      {request.isSuccess ? (
        <div className="mt-[10px] flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
          <Icon name="check" size={16} stroke="#B5A6FF" />
          <span className="flex-1" data-testid="quota-request-sent">
            {t.guests.add.requestSent}
          </span>
        </div>
      ) : open ? (
        <QuotaRequestForm
          spots={spots}
          onSpots={setSpots}
          motivation={motivation}
          onMotivation={setMotivation}
          pending={request.isPending}
          error={request.isError ? request.error?.message ?? t.guests.add.requestSendFailed : null}
          onSend={() => request.mutate({ eventId, requestedExtra: spots, motivation: motivation.trim() }, { onSuccess: close })}
          onCancel={close}
        />
      ) : null}
    </div>
  );
}
