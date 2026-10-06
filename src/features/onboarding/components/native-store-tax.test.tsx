// @vitest-environment jsdom
/**
 * Store-tax seam (#32/#37) in the /onboarding wizard. An invite link opens the
 * native app (it claims /auth/confirm), so a new owner can run this wizard
 * inside the shell. There it must show NO plan picker, price or payment step
 * (Apple 3.1.1/3.1.3, Play payments policy) — the default plan's trial starts
 * silently and the owner goes straight on to Team. The browser keeps the
 * unchanged Plan → Betaling flow.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { DEFAULT_PLAN_ID } from '@/features/billing/plans';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  native: false,
  setPlan: vi.fn(async () => ({ ok: true }) as { ok: true } | { ok: false; message: string }),
}));

vi.mock('@/lib/platform', () => ({ isNativeShell: () => H.native }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/features/venues/actions', () => ({ createVenueAction: vi.fn() }));
vi.mock('@/features/auth/invite-actions', () => ({ inviteUserAction: vi.fn() }));
vi.mock('@/features/billing/actions', () => ({
  setVenuePlanAction: H.setPlan,
  completeOnboardingAction: vi.fn(async () => ({ ok: true })),
}));

import { OnboardingWizard } from './OnboardingWizard';

const VENUE = 'de300000-0000-7000-8000-000000000001';
const owner = { name: 'New Owner', email: 'owner@venue.test' };

/** Anything a store reviewer would read as a price or a payment call to action. */
const PURCHASE_COPY = /€|\/ ?month|payment|iDEAL|SEPA|pick your plan|pick a plan|checkout|upgrade/i;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  H.native = false;
});

describe('onboarding wizard — native shell', () => {
  it('skips plan + payment: starts the default trial and lands on Team', async () => {
    H.native = true;
    render(<OnboardingWizard initialStep="plan" venueId={VENUE} owner={owner} />);
    await waitFor(() => expect(H.setPlan).toHaveBeenCalledWith({ venueId: VENUE, planId: DEFAULT_PLAN_ID }));
    await screen.findByRole('button', { name: new RegExp(t.onboarding.teamStep.send) });
    expect(screen.queryByText('Plan')).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(PURCHASE_COPY);
  });

  it('never paints a price while starting the trial, and offers a retry on failure', async () => {
    H.native = true;
    H.setPlan.mockResolvedValueOnce({ ok: false, message: 'Something went wrong.' });
    render(<OnboardingWizard initialStep="plan" venueId={VENUE} owner={owner} />);
    await screen.findByText('Something went wrong.');
    expect(screen.getByRole('button', { name: /Try again/ })).toBeEnabled();
    expect(document.body.textContent ?? '').not.toMatch(PURCHASE_COPY);
  });

  it('welcome lists two steps, none about a plan', () => {
    H.native = true;
    render(<OnboardingWizard initialStep="venue" venueId={null} owner={owner} />);
    expect(screen.getByText(/Two quick/)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(PURCHASE_COPY);
  });
});

describe('onboarding wizard — browser', () => {
  it('keeps the plan picker', () => {
    render(<OnboardingWizard initialStep="plan" venueId={VENUE} owner={owner} />);
    expect(screen.getByText('Pick your plan')).toBeInTheDocument();
    expect(H.setPlan).not.toHaveBeenCalled();
  });

  it('welcome lists three steps', () => {
    render(<OnboardingWizard initialStep="venue" venueId={null} owner={owner} />);
    expect(screen.getByText(/Three quick/)).toBeInTheDocument();
  });
});
