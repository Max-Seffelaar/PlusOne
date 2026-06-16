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
  { id: 'ideal', label: 'iDEAL', sub: 'Eenmalig via je eigen bank', icon: 'card' },
  { id: 'sepa', label: 'SEPA-incasso', sub: 'Maandelijks automatisch afgeschreven', icon: 'refresh' },
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
          title="Veilig betalen"
          sub="Je proefperiode van 14 dagen loopt al — je betaalt pas daarna, en je kunt maandelijks opzeggen."
          bullets={[
            'Maandelijks opzegbaar',
            'Betaal met iDEAL of SEPA-incasso',
            'Wij bewaren nooit je IBAN of kaartgegevens',
          ]}
        />
      }
      heading="Rond je betaling af"
      sub="Kies hoe je straks betaalt. Tijdens je gratis proefperiode wordt er nog niets afgeschreven."
      footer={
        <Btn kind="primary" full icon="arrowR" onClick={onNext}>
          Doorgaan
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
            <div className="text-[13px] text-dim">maandelijks · opzegbaar · 14 dagen gratis</div>
          </div>
          <div className="font-display text-[17px] font-bold text-text">{planPriceLabel(plan)}</div>
        </div>
      </div>

      <Label className="mb-2">Betaalmethode</Label>
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
        Betalen verloopt veilig via onze betaalprovider. De eerste keer rond je het af in je browser;
        daarna gaat het automatisch. Tijdens de proefperiode betaal je niets.
      </p>
    </WizardShell>
  );
}
