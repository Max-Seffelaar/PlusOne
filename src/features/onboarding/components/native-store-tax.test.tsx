// @vitest-environment jsdom
/**
 * Store-tax seam (#32/#37) in the /onboarding wizard. An invite link opens the
 * native app (it claims /auth/confirm), so a new owner can run this wizard
 * inside the shell. Since Billing G the wizard is Welcome → Company → Team in
 * BOTH the browser and the shell: no plan picker, price or payment step
 * anywhere (Apple 3.1.1/3.1.3, Play payments policy), and no client-side trial
 * start either — create_venue_with_owner starts the Pro trial by itself.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  native: false,
  createVenue: vi.fn(async () => ({ ok: true as const, venueId: 'de300000-0000-7000-8000-000000000001' })),
}));

vi.mock('@/lib/platform', () => ({ isNativeShell: () => H.native }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/features/venues/actions', () => ({ createVenueAction: H.createVenue }));
vi.mock('@/features/auth/invite-actions', () => ({ inviteUserAction: vi.fn() }));
vi.mock('@/features/billing/actions', () => ({
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

describe.each([
  ['native shell', true],
  ['browser', false],
] as const)('onboarding wizard — %s', (_label, native) => {
  it('welcome lists two steps, none about a plan', () => {
    H.native = native;
    render(<OnboardingWizard initialStep="venue" venueId={null} owner={owner} />);
    expect(screen.getByText(/Two quick/)).toBeInTheDocument();
    expect(screen.queryByText(/plan/i)).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(PURCHASE_COPY);
  });

  it('step dots show Company and Team only', () => {
    H.native = native;
    render(<OnboardingWizard initialStep="team" venueId={VENUE} owner={owner} />);
    expect(screen.getAllByText('Company').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Team').length).toBeGreaterThan(0);
    expect(screen.queryByText('Plan')).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(PURCHASE_COPY);
  });

  it('creating the company goes straight to Team, no plan or payment step between', async () => {
    H.native = native;
    render(<OnboardingWizard initialStep="venue" venueId={null} owner={owner} />);
    fireEvent.click(screen.getByRole('button', { name: /Set up account/ }));
    fireEvent.change(screen.getByPlaceholderText(t.onboarding.venueCreate.companyNamePlaceholder), {
      target: { value: 'Club Nova' },
    });
    const consent = document.querySelector('input[type="checkbox"]');
    if (consent) fireEvent.click(consent);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.onboarding.venueCreate.submit) }));
    await waitFor(() => expect(H.createVenue).toHaveBeenCalled());
    await screen.findByRole('button', { name: new RegExp(t.onboarding.teamStep.send) });
    expect(document.body.textContent ?? '').not.toMatch(PURCHASE_COPY);
  });
});
