'use client';

/** Onboarding step 2b — Betaling (design-ready, NOT wired, #32/#40c). The client
 *  reviews the chosen plan and picks a payment method (iDEAL / SEPA-incasso, the
 *  only methods per CLAUDE.md §Billing), but no Stripe call happens yet: the
 *  proefperiode is already running, so "Doorgaan" just advances. Real checkout is
 *  the billing-fase follow-up. */
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from '@/components/po/icon';
import { Btn, Label } from '@/components/po/kit';
import { getPlan, planPriceLabel, type PlanId } from '@/features/billing/plans';
import { WizardShell, WizardPanel } from '../WizardShell';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';

type Method = 'ideal' | 'sepa';
const METHODS: { id: Method; label: string; sub: string; icon: IconName }[] = [
  { id: 'ideal', label: 'iDEAL', sub: 'One-off through your own bank', icon: 'card' },
  { id: 'sepa', label: 'SEPA Direct Debit', sub: 'Charged automatically each month', icon: 'refresh' },
];

export function BetalingStep({
  planId,
  onNext,
}: {
  planId: PlanId;
  onNext: () => void;
}): JSX.Element {
  const plan = getPlan(planId);
  const [method, setMethod] = useState<Method>('ideal');

  return (
    <WizardShell
      current={2}
      panel={
        <WizardPanel
          title="Pay safely"
          sub="Your 14-day trial is already running. You only pay after that, and you can cancel monthly."
          bullets={[
            'Cancel monthly',
            'Pay with iDEAL or SEPA Direct Debit',
            'We never store your IBAN or card details',
          ]}
        />
      }
      heading="Set up your payment"
      sub="Pick how you'll pay later. Nothing is charged during your free trial."
      footer={
        <Btn kind="primary" full icon="arrowR" onClick={onNext}>
          Continue
        </Btn>
      }
    >
      {/* Selected plan summary */}
      <div className="mb-5 rounded-[16px] border border-acc bg-acc-dim p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-display text-[17px] font-extrabold tracking-[-0.01em] text-text">
              {plan.name}
            </div>
            <div className="text-[13px] text-dim">monthly · cancel anytime · 14 days free</div>
          </div>
          <div className="font-display text-[17px] font-bold text-text">{planPriceLabel(plan)}</div>
        </div>
      </div>

      <Label className="mb-2">Payment method</Label>
      <div className="flex flex-col gap-[10px]">
        {METHODS.map((m) => {
          const on = m.id === method;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMethod(m.id)}
              className={cn(
                'flex items-center gap-3 rounded-[14px] border p-[14px] text-left',
                press,
                on ? 'border-acc bg-acc-dim' : 'border-line bg-elev'
              )}
            >
              <span
                className={cn(
                  'flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full border-2',
                  on ? 'border-acc bg-acc' : 'border-line'
                )}
              >
                {on && <Icon name="check" size={12} sw={3} stroke="#16132B" />}
              </span>
              <Icon name={m.icon} size={20} className="shrink-0 text-acc" />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-[15px] font-bold text-text">{m.label}</span>
                <span className="block text-[12.5px] text-faint">{m.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-[12.5px] leading-[1.5] text-faint">
        Payments run securely through our payment provider. The first time you complete it in your
        browser; after that it&apos;s automatic. During the trial you pay nothing.
      </p>
    </WizardShell>
  );
}
