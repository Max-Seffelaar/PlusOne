'use client';

/**
 * Billing-mails B1 (z8uq9m2z19) — the billing-mail timeline inside a Platform
 * Companies card: which billing mails a company got (per mail: recipients and
 * delivery status from the Resend webhook), which trial mail comes next, and
 * "Pause billing mails".
 *
 * Collapsed by default: the read (platform_billing_mail_timeline) only fires
 * when a platform admin opens it, so a page of 20 cards costs no extra calls.
 * The RPC re-checks is_platform_admin() (42501 otherwise); the pause goes
 * through set_billing_mails_paused, same check, stamped with the admin's uid.
 * "Next" comes from the same pure schedule the job uses (mail-schedule.ts),
 * so the screen and the sender cannot disagree.
 *
 * Counts only: never an address or a name. Capacitor (#37): plain buttons,
 * client-side read, online-only server action, no browser-only API.
 */
import { type JSX, useState } from 'react';
import { t, fmt } from '@/lib/i18n';
import { usePoPlatformBillingMails } from '@/features/po/hooks';
import { usePoSetBillingMailsPaused } from '@/features/po/mutations';
import type { PlatformBillingMail } from '@/features/po/adapters';
import { formatShortDate } from '@/features/po/format';
import { nextBillingMail, type BillingMailType } from '@/features/billing/mail-schedule';
import { FieldErrorText, ToggleRow } from '../kit';
import { Icon } from '../icon';

export function billingMailLabel(type: BillingMailType): string {
  switch (type) {
    case 'billing_trial_day0':
      return t.platform.billingMailTrialDay0;
    case 'billing_trial_day7':
      return t.platform.billingMailTrialDay7;
    case 'billing_trial_day12':
      return t.platform.billingMailTrialDay12;
    case 'billing_trial_ended':
      return t.platform.billingMailTrialEnded;
    case 'billing_trial_day21':
      return t.platform.billingMailTrialDay21;
    case 'billing_payment_failed':
      return t.platform.billingMailPaymentFailed;
    case 'billing_canceled':
      return t.platform.billingMailCanceled;
  }
}

/** "2 recipients · 1 delivered · 1 sent": recipients, then each non-zero status. */
export function billingMailStatusLine(mail: PlatformBillingMail): string {
  const parts = [
    mail.recipients === 1 ? t.platform.billingMailRecipient : fmt(t.platform.billingMailRecipients, { count: mail.recipients }),
  ];
  if (mail.delivered) parts.push(fmt(t.platform.billingMailDelivered, { count: mail.delivered }));
  if (mail.sending) parts.push(fmt(t.platform.billingMailSending, { count: mail.sending }));
  if (mail.failed) parts.push(fmt(t.platform.billingMailFailed, { count: mail.failed }));
  if (mail.bounced) parts.push(fmt(t.platform.billingMailBounced, { count: mail.bounced }));
  return parts.join(' · ');
}

export function BillingMailTimeline({ venueId, name }: { venueId: string; name: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-[11px] rounded-[14px] border border-line2 px-[12px]">
      <button
        type="button"
        aria-expanded={open}
        aria-label={fmt(t.platform.billingMailsToggleAria, { name })}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] w-full items-center gap-[10px] text-left text-[14px] font-semibold text-text"
      >
        <Icon name="mail" size={16} />
        <span className="flex-1">{t.platform.billingMailsToggle}</span>
        <Icon name={open ? 'chevD' : 'chev'} size={16} />
      </button>
      {open && <TimelineBody venueId={venueId} />}
    </div>
  );
}

function TimelineBody({ venueId }: { venueId: string }): JSX.Element {
  const q = usePoPlatformBillingMails(venueId);
  const pause = usePoSetBillingMailsPaused();

  if (q.isError) {
    return <div className="border-t border-line2 py-[12px] text-[12px] text-faint">{t.platform.billingMailsLoadError}</div>;
  }
  if (!q.data) return <div className="border-t border-line2 py-[12px]" aria-busy="true" />;

  const { paused, subscription, mails } = q.data;
  const sent = new Set(mails.map((m) => m.key));
  const next = subscription ? nextBillingMail({ ...subscription, paused }, new Date(), sent) : null;

  return (
    <div className="border-t border-line2">
      <ToggleRow
        title={t.platform.billingMailsPause}
        sub={t.platform.billingMailsPauseSub}
        on={paused}
        set={(v) => {
          if (pause.isPending) return;
          pause.mutate({ venueId, paused: v });
        }}
      />
      {pause.error && <FieldErrorText className="mt-2">{pause.error.message}</FieldErrorText>}
      <div className="py-[12px]">
        <div className="text-[12.5px] font-semibold text-dim">
          {next
            ? fmt(t.platform.billingMailsNext, {
                mail: billingMailLabel(next.type),
                date: formatShortDate(next.at.toISOString()),
              })
            : t.platform.billingMailsNextNone}
        </div>
        {mails.length === 0 ? (
          <div className="mt-[8px] text-[12px] text-faint">{t.platform.billingMailsNone}</div>
        ) : (
          <ul className="mt-[8px] flex flex-col gap-[8px]">
            {mails.map((m) => (
              <li key={m.key} className="min-w-0">
                <div className="flex min-w-0 items-baseline justify-between gap-[10px]">
                  <span className="truncate text-[13px] font-semibold text-text">{billingMailLabel(m.type)}</span>
                  <span className="shrink-0 text-[12px] text-faint">{formatShortDate(m.firstAt)}</span>
                </div>
                <div className={m.failed || m.bounced ? 'text-[12px] text-red-300' : 'text-[12px] text-faint'}>
                  {billingMailStatusLine(m)}
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-[10px] text-[11.5px] leading-[1.4] text-faint">{t.platform.billingMailsHint}</div>
      </div>
    </div>
  );
}
