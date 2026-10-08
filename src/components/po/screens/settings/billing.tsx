'use client';

import { type JSX, useState } from 'react';
import { cn } from '@/lib/utils';
import { t, fmt } from '@/lib/i18n';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { usePoBillingPrices, usePoSubscription } from '@/features/po/hooks';
import { usePoBillingCheckout, usePoBillingPortal } from '@/features/po/mutations';
import type { PoSubscription } from '@/features/po/adapters';
import { isNativeShell } from '@/lib/platform';
import { useNav } from '../../context';
import { Icon } from '../../icon';
import { Btn, Empty, Label, MiniChip, Note, Scroll, Top, press } from '../../kit';
import { formatPriceAmount, yearlySavingsPercent, type BillingInterval, type BillingPrices } from '@/features/billing/plans';
import { col, FormError } from './_shared';

// ── BILLING (pushed) — live, with checkout/portal (fase 13 PR 2, Billing G) ──
// Any member views the entitlement (RLS subscriptions_select_member). An ADMIN
// or FINANCE member in the BROWSER additionally picks monthly/yearly and gets
// the Stripe-hosted checkout and portal redirects; the two Pro prices come live
// from Stripe (usePoBillingPrices, lookup keys pro_monthly/pro_yearly), never
// from code. The native shell stays read-only without even a link — store-tax
// seam (#32/#37, isNativeShell): plan, status and the trial countdown only, so
// no price, no interval, no payment method, no "set up your payment" nudge and
// no pointer to the web (Apple 3.1.1/3.1.3, Play payments policy). The price
// query is not even enabled there. Guarded by billing.native.test.tsx and the
// native-shell e2e/flow guards.
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

/** True when a checkout rejection is the invoicing soft-gate (server message
 *  matches `invoicingRequiredError` verbatim — no error code crosses the
 *  mutation boundary today, see usePoBillingCheckout). */
function isInvoicingRequiredError(error: unknown): boolean {
  return error instanceof Error && error.message === t.settings.billing.invoicingRequiredError;
}

function BillingBody({ sub }: { sub: PoSubscription }): JSX.Element {
  const st = SUB_STATUS[sub.status] ?? { label: sub.status.toUpperCase(), chip: 'bg-elev2 text-faint' };
  const { roles } = usePoIdentity();
  // Billing rights = admin + finance (decision 2026-10-06); the server action
  // re-checks the same (callerMayManageBilling), this only hides the buttons.
  const canManage = roles.includes('admin') || roles.includes('finance');
  const native = isNativeShell();
  const checkout = usePoBillingCheckout();
  const portal = usePoBillingPortal();
  const pricesQ = usePoBillingPrices({ enabled: !native });
  const prices = native ? null : (pricesQ.data ?? null);
  const [interval, setPickedInterval] = useState<BillingInterval>('month');
  const nav = useNav();

  // Checkout applies while no Stripe subscription exists (fresh trial, lapsed
  // trial, canceled). comped is "always free" — no self-service billing.
  const needsCheckout = !sub.stripeLinked && sub.status !== 'comped';
  const daysLeft = sub.trialEndsAt ? trialDaysLeft(sub.trialEndsAt) : null;
  const current = sub.billingInterval && prices ? prices[sub.billingInterval] : null;

  // The mutation itself already tracks the rejection (mutation.error, read by
  // the FormError below) — the .catch here only stops the redirect and
  // silences the unhandled-rejection warning; it does nothing else.
  const go = (run: () => Promise<string>) => (): void => {
    void run().then(
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
        {!native && current && sub.billingInterval && (
          <div className="mb-4 flex items-end gap-1.5">
            <span className="font-display text-[36px] font-extrabold leading-none text-text">{formatPriceAmount(current)}</span>
            <span className="pb-[5px] text-[14px] text-dim">
              {sub.billingInterval === 'year' ? t.settings.billing.perYear : t.settings.billing.perMonth} · {t.settings.billing.exclVat}
            </span>
          </div>
        )}
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
        <Note icon="warn">{native ? t.settings.billing.nativePastDue : t.settings.billing.pastDueBanner}</Note>
      )}
      {needsCheckout && sub.status === 'trialing' && daysLeft != null && (
        <Note icon={daysLeft >= 0 ? 'clock' : 'warn'}>
          {daysLeft >= 0
            ? fmt(native ? t.settings.billing.nativeTrialEndsIn : t.settings.billing.trialEndsIn, {
                days: String(Math.max(daysLeft, 0)),
              })
            : native
              ? t.settings.billing.nativeTrialEnded
              : t.settings.billing.trialEnded}
        </Note>
      )}

      {canManage && !native && (
        <div className="mb-[18px] mt-1 flex flex-col gap-2.5">
          {needsCheckout && (
            <IntervalPicker value={interval} onChange={setPickedInterval} prices={prices} loading={pricesQ.isLoading} />
          )}
          {needsCheckout && (
            <Btn kind="primary" full icon="card" disabled={busy} onClick={go(() => checkout.mutateAsync(interval))}>
              {checkout.isPending
                ? t.settings.billing.redirecting
                : sub.status === 'canceled'
                  ? t.settings.billing.reactivate
                  : t.settings.billing.setupPayment}
            </Btn>
          )}
          {sub.stripeLinked && (
            <Btn kind="dark" full icon="note" disabled={busy} onClick={go(() => portal.mutateAsync())}>
              {portal.isPending ? t.settings.billing.redirecting : t.settings.billing.managePortal}
            </Btn>
          )}
          {isInvoicingRequiredError(checkout.error) ? (
            <>
              <FormError error={checkout.error} />
              <Btn kind="ghost" full icon="building" onClick={() => nav.push('venuesettings')}>
                {t.settings.billing.invoicingRequiredCta}
              </Btn>
            </>
          ) : (
            <FormError error={checkout.error ?? portal.error} />
          )}
        </div>
      )}
      {native && (
        <div className="mb-[18px] mt-1 flex items-start gap-[7px] pl-0.5 text-[12px] text-faint">
          <Icon name="shield" size={13} className="text-ghost" />
          <span className="leading-[1.45]">{t.settings.billing.nativeNoChanges}</span>
        </div>
      )}

      {!native && (
        <>
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
              {sub.stripeLinked
                ? t.settings.billing.invoicesPortal
                : t.settings.billing.invoicesSoon}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** Monthly / yearly choice before "Set up payment" (Billing G). Prices are
 *  Stripe's; without them (stub, Stripe down) each option says the price is
 *  shown at checkout. The yearly saving is computed from the two prices. */
function IntervalPicker({
  value,
  onChange,
  prices,
  loading,
}: {
  value: BillingInterval;
  onChange: (v: BillingInterval) => void;
  prices: BillingPrices | null;
  loading: boolean;
}): JSX.Element {
  const b = t.settings.billing;
  const save = yearlySavingsPercent(prices);
  const options: { id: BillingInterval; title: string; per: string }[] = [
    { id: 'month', title: b.intervalMonthly, per: b.perMonth },
    { id: 'year', title: b.intervalYearly, per: b.perYear },
  ];
  return (
    <div role="radiogroup" aria-label={b.intervalLabel}>
      <Label className="mb-[10px]">{b.intervalLabel}</Label>
      <div className="grid grid-cols-2 gap-2.5">
        {options.map((o) => {
          const price = prices?.[o.id] ?? null;
          const on = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.id)}
              className={cn(
                'min-h-[44px] rounded-[16px] border p-[14px] text-left',
                press,
                on ? 'border-acc bg-acc-dim' : 'border-line bg-elev'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-[15px] font-bold text-text">{o.title}</span>
                {o.id === 'year' && save !== null && (
                  <MiniChip className="border-transparent bg-acc text-on-acc">{fmt(b.yearlySave, { pct: String(save) })}</MiniChip>
                )}
              </div>
              <div className="mt-1 text-[13px] text-dim">
                {price ? (
                  <>
                    <span className="font-bold text-text">{formatPriceAmount(price)}</span> {o.per} · {b.exclVat}
                  </>
                ) : loading ? (
                  '…'
                ) : (
                  b.priceAtCheckout
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
