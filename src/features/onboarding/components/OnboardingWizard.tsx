'use client';

/** Client-side onboarding wizard (#40): Welcome → Company → Team, the same in
 *  the browser and in the native shell (Billing G, decision 2026-10-06). There
 *  is no plan or payment step anywhere: create_venue_with_owner starts the
 *  company on a 14-day Pro trial by itself, and payment is set up later from
 *  More → Billing in the browser. The step is seeded from server-derived state
 *  so the flow is resumable; from there it is a local state machine. Welcome
 *  only shows when starting fresh (no venue yet). */
import { type JSX, useState } from 'react';
import { WelkomStep } from './steps/WelkomStep';
import { VenueStep } from './steps/VenueStep';
import { TeamStep } from './steps/TeamStep';

type WizardStep = 'welkom' | 'venue' | 'team';

export function OnboardingWizard({
  initialStep,
  venueId: initialVenueId,
  owner,
  demoAccount = false,
}: {
  initialStep: 'venue' | 'team';
  venueId: string | null;
  owner: { name: string; email: string };
  /** The store-review demo account (86ey6bfug, `isDemoReviewUser` server side):
   *  the venue and team steps show the refusal instead of their form. UX only. */
  demoAccount?: boolean;
}): JSX.Element {
  // The demo account skips the welcome and lands on the step carrying its
  // refusal (86ey6bfug).
  const [step, setStep] = useState<WizardStep>(
    demoAccount ? (initialVenueId ? 'team' : 'venue') : initialStep === 'venue' ? 'welkom' : initialStep
  );
  const [venueId, setVenueId] = useState<string | null>(initialVenueId);

  const venueStep = (
    <VenueStep
      demoAccount={demoAccount}
      onCreated={(id) => {
        setVenueId(id);
        setStep('team');
      }}
    />
  );

  switch (step) {
    case 'welkom':
      return <WelkomStep owner={owner} onNext={() => setStep('venue')} />;
    case 'team':
      return venueId ? <TeamStep venueId={venueId} demoAccount={demoAccount} /> : venueStep;
    case 'venue':
    default:
      return venueStep;
  }
}
