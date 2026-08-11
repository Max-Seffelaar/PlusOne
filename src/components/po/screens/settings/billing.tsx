'use client';

import type { JSX } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { usePoSubscription } from '@/features/po/hooks';
import { usePoBillingCheckout, usePoBillingPortal } from '@/features/po/mutations';
import type { PoSubscription } from '@/features/po/adapters';
import { isNativeShell } from '@/lib/platform';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Btn, Empty, Label, MiniChip, Note, Scroll, Top } from '../../kit';
import { col, FormError } from './_shared';

// ── ABONNEMENT & FACTUREN (pushed) — live, with checkout/portal (fase 13 PR 2) ─
// Any member views the entitlement (RLS subscriptions_select_member); an ADMIN
// in the BROWSER additionally gets the Stripe-hosted checkout and portal
// redirects. The native shell stays read-only without even a link — store-tax
// seam (#32/#37, isNativeShell).
const SUB_STATUS: Record<PoSubscription['status'], { label: string; chip: string }> = {
  trialing: { label: t.settings.billing.statusTrialing, chip: 'bg-acc-dim text-acc' },
  active: { label: t.settings.billing.statusActive, chip: 'bg-acc-dim text-acc' },
  comped: { label: t.settings.billing.statusComped, chip: 'bg-acc-dim text-acc' },
  past_due: { label: t.settings.billing.statusPastDue, chip: 'bg-red-300/15 text-red-300' },
  canceled: { label: t.settings.billing.statusCanceled, chip: 'bg-elev2 text-faint' },
};

export function Billing(): JSX.Element {
  const nav = useNav();
  const subQ = usePoSubscription();
  const sub = subQ.data ?? null;
  return (
    <div className={col}>
      <Top onBack={nav.back} title={t.settings.billing.title} />
      <Scroll bottom={28}>
        {subQ.isLoading ? (
          <Empty text={t.settings.billing.loading} />
        ) : subQ.isError ? (
          <Empty text={t.settings.billing.loadError} />
        ) : !sub ? (
          <Empty text={t.settings.billing.empty} />
        ) : (
          <BillingBody sub={sub} />
        )}
      </Scroll>
    </div>
  );
}

/** Whole days until the trial ends; negative = already lapsed. */
function trialDaysLeft(trialEndsAt: string): number {
  return Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function BillingBody({ sub }: { sub: PoSubscription }): JSX.Element {
  const st = SUB_STATUS[sub.status] ?? { label: sub.status.toUpperCase(), chip: 'bg-elev2 text-faint' };
  const { roles } = usePoIdentity();
  const isAdmin = roles.includes('admin');
  const native = isNativeShell();
  const checkout = usePoBillingCheckout();
  const portal = usePoBillingPortal();

  // Checkout applies while no Stripe subscription exists (fresh trial, lapsed
  // trial, canceled). comped is pilot territory — no self-service billing.
  const needsCheckout = !sub.stripeLinked && sub.status !== 'comped';
  const daysLeft = sub.trialEndsAt ? trialDaysLeft(sub.trialEndsAt) : null;

  // The mutation itself already tracks the rejection (mutation.error, read by
  // the FormError below) — the .catch here only stops the redirect and
  // silences the unhandled-rejection warning; it does nothing else.
  const go = (m: { mutateAsync: () => Promise<string> }) => (): void => {
    void m.mutateAsync().then(
      (url) => window.location.assign(url),
      () => {},
    );
  };
  const busy = checkout.isPending || portal.isPending;

  return (
    <>
      <div className="mb-[14px] rounded-[18px] bg-acc-dim p-5">
        <div className="mb-[14px] flex items-center justify-between">
          <div className="flex items-center gap-[10px]">
            <Icon name="spark" size={20} stroke="#B5A6FF" />
            <span className="font-display text-[20px] font-extrabold text-text">{sub.plan}</span>
          </div>
          <MiniChip className={cn('border-transparent', st.chip)}>{st.label}</MiniChip>
        </div>
        <div className="mb-4 flex items-end gap-1.5">
          <span className="font-display text-[36px] font-extrabold leading-none text-text">{sub.priceLabel}</span>
          {sub.priceLabel.startsWith('€') && <span className="pb-[5px] text-[14px] text-dim">/ {sub.period}</span>}
        </div>
        <div className="grid grid-cols-2 gap-[10px]">
          {([[t.settings.billing.fieldEvents, sub.events], [t.settings.billing.fieldVenue, sub.venueLabel], [t.settings.billing.fieldRenews, sub.renews], [t.settings.billing.fieldStatus, st.label]] as const).map(([k, val]) => (
            <div key={k}>
              <div className="text-[11.5px] text-dim">{k}</div>
              <div className="mt-0.5 font-display text-[14px] font-bold text-text">{val}</div>
            </div>
          ))}
        </div>
      </div>

      {sub.status === 'past_due' && (
        <Note icon="warn">{t.settings.billing.pastDueBanner}</Note>
      )}
      {needsCheckout && sub.status === 'trialing' && daysLeft != null && (
        <Note icon={daysLeft >= 0 ? 'clock' : 'warn'}>
          {daysLeft >= 0
            ? fmt(t.settings.billing.trialEndsIn, { days: String(Math.max(daysLeft, 0)) })
            : t.settings.billing.trialEnded}
        </Note>
      )}

      {isAdmin && !native && (
        <div className="mb-[18px] mt-1 flex flex-col gap-2.5">
          {needsCheckout && (
            <Btn kind="primary" full icon="card" disabled={busy} onClick={go(checkout)}>
              {checkout.isPending
                ? t.settings.billing.redirecting
                : sub.status === 'canceled'
                  ? t.settings.billing.reactivate
                  : t.settings.billing.setupPayment}
            </Btn>
          )}
          {sub.stripeLinked && (
            <Btn kind="dark" full icon="note" disabled={busy} onClick={go(portal)}>
              {portal.isPending ? t.settings.billing.redirecting : t.settings.billing.managePortal}
            </Btn>
          )}
          <FormError error={checkout.error ?? portal.error} />
        </div>
      )}
      {native && (
        <div className="mb-[18px] mt-1 flex items-start gap-[7px] pl-0.5 text-[12px] text-faint">
          <Icon name="shield" size={13} className="text-ghost" />
          <span className="leading-[1.45]">{t.settings.billing.manageOnWeb}</span>
        </div>
      )}

      <Label className="mb-[10px]">{t.settings.billing.paymentMethodLabel}</Label>
      <div className="mb-2 flex items-center gap-[13px] rounded-[18px] border border-line bg-elev p-4">
        <span className="flex h-[42px] w-[42px] items-center justify-center rounded-[12px] border border-line bg-elev2 text-acc">
          <Icon name="card" size={20} />
        </span>
        <div className="flex-1">
          <div className="text-[14.5px] font-semibold text-text">{t.settings.billing.paymentMethodTitle}</div>
          <div className="mt-0.5 text-[12.5px] text-faint">{t.settings.billing.paymentMethodSub}</div>
        </div>
      </div>
      <div className="mb-[18px] flex items-start gap-[7px] pl-0.5 text-[12px] text-faint">
        <Icon name="shield" size={13} className="text-ghost" />
        <span className="leading-[1.45]">{t.settings.billing.paymentNote}</span>
      </div>

      <Label className="mb-[10px]">{t.settings.billing.invoicesLabel}</Label>
      <div className="rounded-[18px] border border-dashed border-line bg-elev p-5 text-center">
        <div className="text-[13.5px] leading-[1.5] text-faint">
          {sub.stripeLinked && !native
            ? t.settings.billing.invoicesPortal
            : t.settings.billing.invoicesSoon}
        </div>
      </div>
    </>
  );
}
