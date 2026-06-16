'use client';

/** Client-side onboarding wizard (#40): Welkom → Venue → Plan → Team. The step is
 *  seeded from server-derived state so the flow is resumable; from there it is a
 *  local state machine. Welkom only shows when starting fresh (no venue yet). */
import { useState } from 'react';
import { DEFAULT_PLAN_ID, type PlanId } from '@/features/billing/plans';
import { WelkomStep } from './steps/WelkomStep';
import { VenueStep } from './steps/VenueStep';
import { PlanStep } from './steps/PlanStep';
import { BetalingStep } from './steps/BetalingStep';
import { TeamStep } from './steps/TeamStep';

type WizardStep = 'welkom' | 'venue' | 'plan' | 'betaling' | 'team';

export function OnboardingWizard({
  initialStep,
  venueId: initialVenueId,
  owner,
}: {
  initialStep: 'venue' | 'plan' | 'team';
  venueId: string | null;
  owner: { name: string; email: string };
}): JSX.Element {
  const [step, setStep] = useState<WizardStep>(initialStep === 'venue' ? 'welkom' : initialStep);
  const [venueId, setVenueId] = useState<string | null>(initialVenueId);
  const [planId, setPlanId] = useState<PlanId>(DEFAULT_PLAN_ID);

  const venueStep = (
    <VenueStep
      onCreated={(id) => {
        setVenueId(id);
        setStep('plan');
      }}
    />
  );

  switch (step) {
    case 'welkom':
      return <WelkomStep owner={owner} onNext={() => setStep('venue')} />;
    case 'venue':
      return venueStep;
    case 'plan':
      return venueId ? (
        <PlanStep
          venueId={venueId}
          onNext={(pid) => {
            setPlanId(pid);
            setStep('betaling');
          }}
        />
      ) : (
        venueStep
      );
    case 'betaling':
      return venueId ? <BetalingStep planId={planId} onNext={() => setStep('team')} /> : venueStep;
    case 'team':
      return venueId ? <TeamStep venueId={venueId} /> : venueStep;
    default:
      return venueStep;
  }
}
