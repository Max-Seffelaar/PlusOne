'use client';

/** Native-shell stand-in for Plan + Betaling (store-tax seam, #32/#37). The
 *  native app may show no plan picker, price or payment step — not even one
 *  that defers payment to the browser (Apple 3.1.1/3.1.3, Play payments
 *  policy). The venue still needs a plan for the onboarding state to move past
 *  'plan', so this step quietly starts the default plan's trial (the same
 *  `setVenuePlanAction` the browser's PlanStep calls) and moves on to Team. */
import { type JSX, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Btn } from '@/components/po/kit';
import { setVenuePlanAction } from '@/features/billing/actions';
import { DEFAULT_PLAN_ID } from '@/features/billing/plans';
import { WizardShell, WizardPanel } from '../WizardShell';

export function TrialStartStep({ venueId, onNext }: { venueId: string; onNext: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const started = useRef(false);

  const run = useCallback((): void => {
    setError(null);
    startTransition(async () => {
      const res = await setVenuePlanAction({ venueId, planId: DEFAULT_PLAN_ID });
      if (res.ok) onNext();
      else setError(res.message);
    });
  }, [venueId, onNext]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
  }, [run]);

  return (
    <WizardShell
      current={2}
      panel={<WizardPanel title="Almost there" sub="Your venue is ready. Next up: your team." />}
      heading="Getting your venue ready"
      footer={
        <>
          {error && <div className="mb-3 text-[13.5px] text-[#ff9b9b]">{error}</div>}
          <Btn kind="primary" full icon="arrowR" onClick={run} disabled={pending || !error}>
            {pending || !error ? 'Working…' : 'Try again'}
          </Btn>
        </>
      }
    >
      <p className="text-[15px] leading-[1.5] text-dim">This only takes a moment.</p>
    </WizardShell>
  );
}
