'use client';

/** Client-side onboarding wizard (#40): Welkom → Venue → Plan → Betaling → Team.
 *  The step is seeded from server-derived state so the flow is resumable; from
 *  there it is a local state machine. Welkom only shows when starting fresh (no
 *  venue yet).
 *
 *  Native shell (store-tax seam, #32/#37): an invite link opens the app (the
 *  shell claims `/auth/confirm`), so a new owner can land here inside it. There
 *  Plan + Betaling are replaced by TrialStartStep — no plan picker, price or
 *  payment step. Until the platform is known (SSR + hydration) those two steps
 *  render a neutral placeholder, so the native shell never paints them. */
import { type JSX, useCallback, useState } from 'react';
import { DEFAULT_PLAN_ID, type PlanId } from '@/features/billing/plans';
import { useIsNativeShell } from '@/lib/use-native-shell';
import { WelkomStep } from './steps/WelkomStep';
import { CrewInviteStep } from './steps/CrewInviteStep';
import { VenueStep } from './steps/VenueStep';
import { PlanStep } from './steps/PlanStep';
import { BetalingStep } from './steps/BetalingStep';
import { TeamStep } from './steps/TeamStep';
import { TrialStartStep } from './steps/TrialStartStep';

type WizardStep = 'crew' | 'welkom' | 'venue' | 'plan' | 'betaling' | 'team';

export function OnboardingWizard({
  initialStep,
  venueId: initialVenueId,
  owner,
  demoAccount = false,
  crewInvites = [],
}: {
  initialStep: 'venue' | 'plan' | 'team';
  venueId: string | null;
  owner: { name: string; email: string };
  /** The store-review demo account (86ey6bfug, `isDemoReviewUser` server side):
   *  the venue and team steps show the refusal instead of their form. UX only. */
  demoAccount?: boolean;
  /** Open crew invites (z8uq9m2yvp), one banner line each. With any, a person
   *  without a company first sees CrewInviteStep instead of company setup. */
  crewInvites?: string[];
}): JSX.Element {
  // The demo account skips straight to the two steps that carry its refusal:
  // no welcome, no plan pick, no payment (86ey6bfug).
  const [step, setStep] = useState<WizardStep>(
    demoAccount
      ? initialVenueId
        ? 'team'
        : 'venue'
      : initialStep === 'venue'
        ? crewInvites.length > 0
          ? 'crew'
          : 'welkom'
        : initialStep
  );
  const [venueId, setVenueId] = useState<string | null>(initialVenueId);
  const [planId, setPlanId] = useState<PlanId>(DEFAULT_PLAN_ID);
  const native = useIsNativeShell();
  const toTeam = useCallback(() => setStep('team'), []);

  const venueStep = (
    <VenueStep
      demoAccount={demoAccount}
      onCreated={(id) => {
        setVenueId(id);
        setStep('plan');
      }}
    />
  );

  switch (step) {
    case 'crew':
      return <CrewInviteStep invites={crewInvites} onSkip={() => setStep('welkom')} />;
    case 'welkom':
      return <WelkomStep owner={owner} onNext={() => setStep('venue')} />;
    case 'venue':
      return venueStep;
    case 'plan':
    case 'betaling':
      if (!venueId) return venueStep;
      if (native === null) return <div className="h-[100dvh] bg-bg" aria-busy="true" />;
      if (native) return <TrialStartStep venueId={venueId} onNext={toTeam} />;
      return step === 'betaling' ? (
        <BetalingStep planId={planId} onNext={toTeam} />
      ) : (
        <PlanStep
          venueId={venueId}
          onNext={(pid) => {
            setPlanId(pid);
            setStep('betaling');
          }}
        />
      );
    case 'team':
      return venueId ? <TeamStep venueId={venueId} demoAccount={demoAccount} /> : venueStep;
    default:
      return venueStep;
  }
}
