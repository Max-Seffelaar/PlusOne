'use client';

/**
 * Approve a landing request (Requests, S5): pick the tier, and since
 * z8uq9m0hw6 optionally approve FEWER people than asked (stepper, never above
 * the request) and leave a plain-text note that shows on the requester's
 * status page (/r/[token]). The deny reason stays internal; this note is the
 * one thing the venue says to the requester.
 *
 * Split out of approvals.tsx to keep that screen under the ~800-line budget.
 * The sheet only collects the decision; approvals.tsx turns it into the action
 * input via `buildApproveInput` (src/features/requests/approval.ts).
 */
import { type JSX, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { fmt, t } from '@/lib/i18n';
import type { PoGuestRequest } from '@/features/po/adapters';
import { clampApprovedPlusOnes, type ApprovalDecision } from '@/features/requests/approval';
import { DECISION_MESSAGE_MAX } from '@/features/requests/schemas';
import type { Tier } from '@/lib/po/types';
import { Icon } from '../../icon';
import { Avatar, Btn, Label, Note, Stepper, TextArea, TierPicker, press } from '../../kit';
import { Sheet } from '../../shell';

function ErrLine({ msg }: { msg: string }): JSX.Element {
  return <div className="mb-3 text-[13px] font-semibold text-[#E89AC0]">{msg}</div>;
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
