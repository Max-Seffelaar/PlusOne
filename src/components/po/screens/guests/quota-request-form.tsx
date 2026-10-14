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

/** Visibility rule for the no-guest request entry points (z8uq9m5kux):
 *  someone who adds guests under a personal quota, never a quota-exempt role
 *  or one that cannot add guests. */
function useCanRequestSpots(eventId: string): { quota: { remaining: number; quota: number } | null } {
  const { data: quota } = usePoQuota(eventId);
  const { roles } = usePoIdentity();
  const { canManage } = usePoEventForEdit(eventId);
  if (!quota || quota.exempt || quota.remaining === null) return { quota: null };
  if (!(canManageGuests(roles) || canManage)) return { quota: null };
  return { quota: { remaining: quota.remaining, quota: quota.quota } };
}

/**
 * A request for spots without a guest (z8uq9m5kux). Owns its own state, so a
 * fresh mount is an empty form: the parent unmounts it after a send or a
 * cancel, and the next "Request more spots" starts clean (Max's retest: the
 * previous motivation stayed in the field).
 */
export function QuotaRequestPanel({
  eventId,
  onSent,
  onCancel,
}: {
  eventId: string;
  onSent: () => void;
  onCancel: () => void;
}): JSX.Element {
  const request = usePoRequestExtraSlots(eventId);
  const [spots, setSpots] = useState(1);
  const [motivation, setMotivation] = useState('');
  return (
    <QuotaRequestForm
      spots={spots}
      onSpots={setSpots}
      motivation={motivation}
      onMotivation={setMotivation}
      pending={request.isPending}
      error={request.isError ? request.error?.message ?? t.guests.add.requestSendFailed : null}
      onSend={() => request.mutate({ eventId, requestedExtra: spots, motivation: motivation.trim() }, { onSuccess: onSent })}
      onCancel={onCancel}
    />
  );
}

/** "Request sent" line shown after a no-guest request, until the next one. */
function SentLine(): JSX.Element {
  return (
    <div className="mt-[10px] flex items-center gap-[9px] rounded-[13px] border border-acc bg-acc-dim px-[14px] py-[11px] text-[13px] text-text">
      <Icon name="check" size={16} stroke="#B5A6FF" />
      <span className="flex-1" data-testid="quota-request-sent">
        {t.guests.add.requestSent}
      </span>
    </div>
  );
}

/** Open / sent state shared by both entry points. */
function useRequestToggle(): { open: boolean; sent: boolean; start: () => void; sentNow: () => void; close: () => void } {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  return {
    open,
    sent,
    start: () => {
      setSent(false);
      setOpen(true);
    },
    sentNow: () => {
      setOpen(false);
      setSent(true);
    },
    close: () => setOpen(false),
  };
}

/**
 * The event guest list's quota row (z8uq9m5kux): "Your quota · n of m left" and
 * "Request more spots", which opens the panel above without a guest. Online-
 * only write via the shared server action (not door-adjacent).
 */
export function GuestListQuotaBar({ eventId }: { eventId: string }): JSX.Element | null {
  const { quota } = useCanRequestSpots(eventId);
  const toggle = useRequestToggle();
  if (!quota) return null;
  return (
    <div className="flex-none px-4 pb-3" data-testid="guest-list-quota">
      <div className="flex items-center gap-[10px] rounded-[13px] border border-line bg-elev px-[14px] py-[9px]">
        <Icon name="ticket" size={16} stroke="rgba(255,255,255,0.40)" />
        <span className="min-w-0 flex-1 text-[13px] text-text">
          {fmt(t.guests.add.quotaBar, { n: quota.remaining, m: quota.quota })}
        </span>
        {!toggle.open && (
          <Btn sm kind="ghost" icon="plus" className="min-h-[44px]" onClick={toggle.start}>
            {t.guests.add.requestMoreSpots}
          </Btn>
        )}
      </div>
      {toggle.open ? (
        <QuotaRequestPanel eventId={eventId} onSent={toggle.sentNow} onCancel={toggle.close} />
      ) : toggle.sent ? (
        <SentLine />
      ) : null}
    </div>
  );
}

/**
 * The same entry point next to the quota counter in the Add guest header
 * (z8uq9m5kux, Max's retest: that counter is where people look). `button` goes
 * in the header's right slot, `panel` right under the header.
 */
export function useQuotaRequestEntry(eventId: string): { button: JSX.Element | null; panel: JSX.Element | null } {
  const { quota } = useCanRequestSpots(eventId);
  const toggle = useRequestToggle();
  if (!quota) return { button: null, panel: null };
  return {
    button: toggle.open ? null : (
      <span data-testid="quota-request-more-header">
        <Btn sm kind="ghost" icon="plus" className="min-h-[44px]" onClick={toggle.start}>
          {t.guests.add.requestMoreSpots}
        </Btn>
      </span>
    ),
    panel: toggle.open ? (
      <div className="flex-none px-4 pb-3" data-testid="quota-request-header-panel">
        <QuotaRequestPanel eventId={eventId} onSent={toggle.sentNow} onCancel={toggle.close} />
      </div>
    ) : toggle.sent ? (
      <div className="flex-none px-4 pb-3" data-testid="quota-request-header-panel">
        <SentLine />
      </div>
    ) : null,
  };
}
