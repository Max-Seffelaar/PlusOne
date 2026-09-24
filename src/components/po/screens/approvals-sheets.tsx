'use client';

/**
 * Bottom sheets of the Requests inbox (approvals.tsx) — the event / link scope
 * pickers, the approve sheet and the decline/deny sheet. Split out of
 * approvals.tsx (z8uq9m0hw4) to keep the screen file under the ~800 LOC rule.
 * The approve sheet also takes a partial approval (people stepper, never above
 * the request) and an optional note for the requester's status page
 * (z8uq9m0hw6); approvals.tsx turns its decision into the action input via
 * `buildApproveInput` (src/features/requests/approval.ts).
 */
import { type JSX, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import type { PoGuestRequest } from '@/features/po/adapters';
import { clampApprovedPlusOnes, type ApprovalDecision } from '@/features/requests/approval';
import { DECISION_MESSAGE_MAX } from '@/features/requests/schemas';
import type { PoLinkOption } from '@/features/po/queries';
import type { Tier } from '@/lib/po/types';
import { Icon } from '../icon';
import { Avatar, Btn, Label, Note, Stepper, TextArea, TierPicker, press } from '../kit';
import { Sheet } from '../shell';

export type DenyTarget = { kind: 'landing' | 'quota'; id: string; name: string; eventId: string };

export function ErrLine({ msg }: { msg: string }): JSX.Element {
  return <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{msg}</div>;
}

export function EventPickerSheet({
  events,
  counts,
  total,
  sel,
  onPick,
  onClose,
}: {
  events: { id: string; name: string }[];
  counts: Map<string, number>;
  total: number;
  sel: string;
  onPick: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  const row = (id: string, label: string, count: number, active: boolean): JSX.Element => (
    <button
      key={id || 'all'}
      type="button"
      onClick={() => onPick(id)}
      className={cn('flex items-center gap-[11px] rounded-[12px] border px-[13px] py-[12px] text-left', active ? 'border-transparent bg-acc-dim' : 'border-line bg-elev', press)}
    >
      <span className="min-w-0 flex-1 truncate font-display text-[14.5px] font-bold text-text">{label}</span>
      {count > 0 && (
        <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-acc-dim px-[6px] text-[11px] font-extrabold text-acc">{count}</span>
      )}
      <span className={cn('flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2', active ? 'border-acc bg-acc' : 'border-ghost bg-transparent')}>
        {active && <Icon name="check" size={12} stroke="#16132B" sw={3} />}
      </span>
    </button>
  );
  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-[14px] font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.requests.pickEventTitle}</div>
      <div className="flex flex-col gap-[7px]">
        {row('', t.requests.scopeAll, total, sel === '')}
        {events.map((e) => row(e.id, e.name, counts.get(e.id) ?? 0, sel === e.id))}
      </div>
      <button type="button" onClick={onClose} className={cn('mt-4 cursor-pointer self-center border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
        {t.requests.close}
      </button>
    </Sheet>
  );
}

/** Filter-by-link sheet (F1) — cloned from EventPickerSheet: "All links" + each
 *  link of the current scope (influencer/label; the default link reads
 *  "Standard link"), each with its pending count. */
export function LinkPickerSheet({
  links,
  counts,
  sel,
  onPick,
  onClose,
}: {
  links: PoLinkOption[];
  counts: Map<string, number>;
  sel: string;
  onPick: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  const total = links.reduce((sum, l) => sum + (counts.get(l.id) ?? 0), 0);
  const row = (id: string, label: string, count: number, active: boolean): JSX.Element => (
    <button
      key={id || 'all'}
      type="button"
      onClick={() => onPick(id)}
      className={cn('flex items-center gap-[11px] rounded-[12px] border px-[13px] py-[12px] text-left', active ? 'border-transparent bg-acc-dim' : 'border-line bg-elev', press)}
    >
      <span className="min-w-0 flex-1 truncate font-display text-[14.5px] font-bold text-text">{label}</span>
      {count > 0 && (
        <span className="inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-acc-dim px-[6px] text-[11px] font-extrabold text-acc">{count}</span>
      )}
      <span className={cn('flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2', active ? 'border-acc bg-acc' : 'border-ghost bg-transparent')}>
        {active && <Icon name="check" size={12} stroke="#16132B" sw={3} />}
      </span>
    </button>
  );
  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-[14px] font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">{t.requests.pickLinkTitle}</div>
      <div className="po-scroll flex max-h-[55vh] flex-col gap-[7px] overflow-y-auto">
        {row('', t.requests.linkFilterAll, total, sel === '')}
        {links.map((l) => row(l.id, l.label ?? t.requests.standardLink, counts.get(l.id) ?? 0, sel === l.id))}
      </div>
      <button type="button" onClick={onClose} className={cn('mt-4 cursor-pointer self-center border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
        {t.requests.close}
      </button>
    </Sheet>
  );
}

export function AssignSheet({
  req,
  eventName,
  tiers,
  tiersLoading,
  pending,
  error,
  onClose,
  onConfirm,
  onCreateTier,
}: {
  req: PoGuestRequest;
  eventName: string;
  tiers: Tier[];
  tiersLoading: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (decision: ApprovalDecision) => void;
  onCreateTier: () => void;
}): JSX.Element {
  const [tierId, setTierId] = useState('');
  // Starts at what they asked for; the stepper only goes down from there.
  const [plus, setPlus] = useState(req.plus);
  const [message, setMessage] = useState('');
  // Default to the first tier once they load (the event's tiers fetch on open).
  useEffect(() => {
    if (tierId === '' && tiers.length > 0) setTierId(tiers[0].id);
  }, [tiers, tierId]);

  const tier = tiers.find((row) => row.id === tierId);
  const requestedHeads = 1 + req.plus;
  const heads = 1 + plus;
  const reduced = plus < req.plus;
  const noTiers = !tiersLoading && tiers.length === 0;
  const blocked = pending || tiersLoading || !tierId;
  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-4 flex items-center gap-[12px]">
        <Avatar name={req.name} size={44} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
            {req.name}
            {req.plus > 0 && <span className="text-faint"> +{req.plus}</span>}
          </div>
          <div className="truncate text-[12.5px] text-faint">
            {eventName
              ? fmt(t.requests.assignHeads, { event: eventName, n: requestedHeads })
              : fmt(t.requests.assignHeadsNoEvent, { n: requestedHeads })}
          </div>
        </div>
      </div>
      {/* Approving is the moment the venue commits to reaching this person
          (86eyke279 made both fields required for exactly that). Full values,
          not the card's `•••• 5610` hint — you cannot mail or call a hint. Same
          RLS-scoped roles already see the complete address in Contacts. Rows
          filed before the rule stay NULLable and say so instead of reading as
          an empty box. */}
      <Label className="mb-[8px]">{t.requests.contactHeading}</Label>
      <div className="mb-[16px] flex flex-col gap-[7px] rounded-[13px] bg-elev2 px-[13px] py-[11px]">
        <div className="flex items-center gap-[9px]">
          <Icon name="mail" size={14} stroke="rgba(255,255,255,0.40)" className="shrink-0" />
          <span className={cn('min-w-0 flex-1 break-all text-[13px]', req.email ? 'text-text' : 'text-faint')}>
            {req.email ?? t.requests.contactNoEmail}
          </span>
        </div>
        <div className="flex items-center gap-[9px]">
          <Icon name="phone" size={14} stroke="rgba(255,255,255,0.40)" className="shrink-0" />
          <span className={cn('min-w-0 flex-1 break-all text-[13px] tabular-nums', req.phone ? 'text-text' : 'text-faint')}>
            {req.phone ?? t.requests.contactNoPhone}
          </span>
        </div>
      </div>
      {/* Partial approval: a solo request has nothing to reduce, so no stepper. */}
      {req.plus > 0 && (
        <div className="mb-[16px]">
          <Label className="mb-[10px]">{t.requests.assignPeopleQuestion}</Label>
          <Stepper value={heads} max={requestedHeads} onChange={(v) => setPlus(clampApprovedPlusOnes(v - 1, req.plus))} />
          <div className="mt-[8px] px-0.5 text-[12.5px] leading-[1.4] text-faint">
            {fmt(t.requests.assignPeopleHint, { n: requestedHeads })}
          </div>
        </div>
      )}
      <Label className="mb-[10px]">{t.requests.assignTierQuestion}</Label>
      {tiersLoading ? (
        <div className="mb-[14px] py-[18px] text-center text-[13px] text-faint">{t.requests.assignLoadingTiers}</div>
      ) : noTiers ? (
        <div className="mb-[14px]">
          <Note icon="ticket">{t.requests.assignNoTiers}</Note>
          <Btn kind="primary" full icon="plus" onClick={onCreateTier}>
            {t.requests.assignCreateTier}
          </Btn>
        </div>
      ) : (
        <TierPicker
          className="mb-[14px]"
          tiers={tiers}
          value={tierId}
          onChange={setTierId}
          hint={(row) => (row.max != null ? fmt(t.requests.tierUsedOfMax, { used: row.used, max: row.max }) : t.requests.tierNoMax)}
        />
      )}
      {!noTiers && (
        <div className="mb-[14px]">
          <Label className="mb-[10px]">
            {t.requests.assignMessageLabel}{' '}
            <span className="font-normal normal-case text-faint">{t.requests.assignMessageOptional}</span>
          </Label>
          <TextArea
            value={message}
            onChange={setMessage}
            maxLength={DECISION_MESSAGE_MAX}
            rows={2}
            placeholder={t.requests.assignMessagePlaceholder}
            ariaLabel={t.requests.assignMessageLabel}
            className="min-h-[72px]"
          />
          <div className="mt-[6px] flex items-center justify-between gap-3 px-0.5 text-[12px] text-faint">
            <span>{t.requests.assignMessageHint}</span>
            <span className="tabular-nums">{fmt(t.requests.assignMessageCount, { n: message.length, max: DECISION_MESSAGE_MAX })}</span>
          </div>
        </div>
      )}
      {!noTiers && !tiersLoading && (
        <div className="mb-4 flex items-center gap-[10px] rounded-[13px] bg-acc-dim px-[14px] py-[13px]">
          <Icon name="check2" size={18} stroke="#B5A6FF" sw={2.4} />
          <span className="text-[13.5px] leading-[1.4] text-text">
            {reduced
              ? fmt(t.requests.assignSummaryReduced, { n: heads, requested: requestedHeads })
              : fmt(t.requests.assignSummary, { n: heads })}
            {tier && <>{t.requests.assignSummaryTierConnector}<b>{tier.short}</b></>}.
          </span>
        </div>
      )}
      {error && <ErrLine msg={error} />}
      {!noTiers && (
        <Btn kind="primary" full icon="check" disabled={blocked} onClick={() => onConfirm({ tierId, plusOnes: plus, message })} className={blocked ? 'opacity-50' : ''}>
          {pending ? t.requests.assignBusy : t.requests.assignConfirm}
        </Btn>
      )}
      <button type="button" onClick={onClose} className={cn('mt-3 cursor-pointer self-center border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
        {t.requests.cancel}
      </button>
    </Sheet>
  );
}

export function DenySheet({
  target,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  target: DenyTarget;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  const isLanding = target.kind === 'landing';
  return (
    <Sheet onClose={onClose} center={false}>
      <div className="mb-1 font-display text-[19px] font-extrabold tracking-[-0.01em] text-text">
        {isLanding ? t.requests.declineHeading : t.requests.denyHeading}
      </div>
      <div className="mb-4 text-[13px] text-faint">
        {isLanding
          ? fmt(t.requests.declineFromLanding, { name: target.name })
          : fmt(t.requests.denyFromQuota, { name: target.name })}
      </div>
      <Label className="mb-[10px]">
        {t.requests.reasonLabel} <span className="font-normal normal-case text-faint">{t.requests.reasonRequired}</span>
      </Label>
      <TextArea
        autoFocus
        value={reason}
        onChange={setReason}
        maxLength={500}
        placeholder={t.requests.reasonPlaceholder}
        className="mb-4 min-h-[88px]"
      />
      {error && <ErrLine msg={error} />}
      <Btn kind="primary" full icon="close" disabled={pending || !trimmed} onClick={() => onConfirm(trimmed)} className={pending || !trimmed ? 'opacity-50' : ''}>
        {pending ? t.requests.declineBusy : isLanding ? t.requests.declineConfirm : t.requests.denyConfirm}
      </Btn>
      <button type="button" onClick={onClose} className={cn('mt-3 cursor-pointer self-center border-none bg-transparent font-body text-[13.5px] font-semibold text-faint', press)}>
        {t.requests.cancel}
      </button>
    </Sheet>
  );
}
