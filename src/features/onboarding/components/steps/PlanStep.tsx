'use client';

/** Onboarding step 2 — pick a plan (#40c). Billing is stubbed: this only writes
 *  the subscription's plan + trialing status; the real Stripe "Betaling" screen
 *  is deferred. */
import { useState, useTransition } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/po/icon';
import { Btn } from '@/components/po/kit';
import { setVenuePlanAction } from '@/features/billing/actions';
import { PLANS, DEFAULT_PLAN_ID, planPriceLabel, type PlanId } from '@/features/billing/plans';
import { WizardShell, WizardPanel } from '../WizardShell';

const press = 'transition-[filter,transform] hover:brightness-[1.07] active:scale-[0.975]';

export function PlanStep({
  venueId,
  onNext,
}: {
  venueId: string;
  onNext: (planId: PlanId) => void;
}): JSX.Element {
  const [planId, setPlanId] = useState<PlanId>(DEFAULT_PLAN_ID);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(): void {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const res = await setVenuePlanAction({ venueId, planId });
      if (res.ok) {
        onNext(planId);
      } else {
        setError(res.message);
      }
    });
  }

  return (
    <WizardShell
      current={2}
      panel={
        <WizardPanel
          title="Pick what fits"
          sub="Scales with your venue. Cancel monthly, switch whenever you like."
        />
      }
      heading="Pick your plan"
      sub="You'll handle payment later. Your venue starts on a trial right away."
      footer={
        <>
          {error && <div className="mb-3 text-[13.5px] text-[#ff9b9b]">{error}</div>}
          <Btn kind="primary" full icon="arrowR" onClick={submit} disabled={pending}>
            {pending ? 'Working…' : 'Continue to payment'}
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-[11px]">
        {PLANS.map((plan) => {
          const on = plan.id === planId;
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => setPlanId(plan.id)}
              className={cn(
                'rounded-[16px] border p-[16px] text-left',
                press,
                on ? 'border-acc bg-acc-dim' : 'border-line bg-elev'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-[10px]">
                  <span
                    className={cn(
                      'flex h-[20px] w-[20px] items-center justify-center rounded-full border-2',
                      on ? 'border-acc bg-acc' : 'border-line'
                    )}
                  >
                    {on && <Icon name="check" size={12} sw={3} stroke="#16132B" />}
                  </span>
                  <span className="font-display text-[17px] font-extrabold tracking-[-0.01em] text-text">
                    {plan.name}
                  </span>
                  {plan.popular && (
                    <span className="rounded-[7px] bg-acc px-[8px] py-[3px] font-body text-[10.5px] font-bold uppercase tracking-[0.03em] text-on-acc">
                      Popular
                    </span>
                  )}
                </div>
                <span className="font-display text-[15px] font-bold text-text">
                  {planPriceLabel(plan)}
                </span>
              </div>
              <div className="mt-[10px] flex flex-wrap gap-x-4 gap-y-1 pl-[30px]">
                {plan.features.map((f) => (
                  <span
                    key={f}
                    className="flex items-center gap-[6px] text-[13px] text-dim"
                  >
                    <Icon name="check" size={13} sw={2.4} className="text-acc" />
                    {f}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </WizardShell>
  );
}
