// @vitest-environment jsdom
/**
 * Store-review demo account (86ey6bfug) in the /onboarding wizard. The /app
 * layout never sends the demo account here, but it can still land on a direct
 * visit (it is admin of the demo venue, so it can flip
 * settings.onboarding.completed back to false). Then the venue step and the
 * team step show the refusal UPFRONT (RefusedAction), never a form that only
 * fails on submit. A normal owner sees the unchanged forms. UX only: the server
 * actions and DB guards are the boundary and are covered by their own tests.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  push: vi.fn(),
  createVenue: vi.fn(),
  invite: vi.fn(),
  complete: vi.fn(async () => ({ ok: true })),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: H.push }) }));
vi.mock('@/features/venues/actions', () => ({ createVenueAction: H.createVenue }));
vi.mock('@/features/auth/invite-actions', () => ({ inviteUserAction: H.invite }));
vi.mock('@/features/billing/actions', () => ({ completeOnboardingAction: H.complete }));

import { VenueStep } from './steps/VenueStep';
import { TeamStep } from './steps/TeamStep';
import { OnboardingWizard } from './OnboardingWizard';

const VENUE = 'de300000-0000-7000-8000-000000000001';
const owner = { name: 'App Reviewer', email: 'app-review@demo.plus-one.io' };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const hasForm = (): boolean => document.querySelector('input') !== null;
const refusal = (): Element | null => document.querySelector('[data-refused-action]');

describe('VenueStep', () => {
  it('shows the demo account the refusal and no form', () => {
    render(<VenueStep demoAccount onCreated={vi.fn()} />);
    expect(refusal()).not.toBeNull();
    expect(screen.getByText(t.auth.demoNoVenues)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(t.onboarding.venueCreate.submit) })).toBeDisabled();
    expect(hasForm()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.onboarding.demo.backToApp) }));
    expect(H.push).toHaveBeenCalledWith('/app');
    expect(H.createVenue).not.toHaveBeenCalled();
  });

  it('shows a normal owner the unchanged form', () => {
    render(<VenueStep onCreated={vi.fn()} />);
    expect(refusal()).toBeNull();
    expect(screen.queryByText(t.auth.demoNoVenues)).not.toBeInTheDocument();
    expect(hasForm()).toBe(true);
  });
});

describe('TeamStep', () => {
  it('shows the demo account the refusal and no form, only the skip', async () => {
    render(<TeamStep venueId={VENUE} demoAccount />);
    expect(refusal()).not.toBeNull();
    expect(screen.getByText(t.auth.demoNoInvites)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(t.onboarding.teamStep.send) })).toBeDisabled();
    expect(hasForm()).toBe(false);
    expect(screen.queryByText(t.onboarding.teamStep.addRow)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.onboarding.teamStep.skip }));
    await vi.waitFor(() => expect(H.push).toHaveBeenCalledWith('/app'));
    expect(H.complete).toHaveBeenCalledWith({ venueId: VENUE });
    expect(H.invite).not.toHaveBeenCalled();
  });

  it('shows a normal owner the unchanged form', () => {
    render(<TeamStep venueId={VENUE} />);
    expect(refusal()).toBeNull();
    expect(hasForm()).toBe(true);
    expect(screen.getByText(t.onboarding.teamStep.addRow)).toBeInTheDocument();
  });
});

describe('OnboardingWizard', () => {
  it.each([
    ['venue', null, t.auth.demoNoVenues],
    ['plan', VENUE, t.auth.demoNoInvites],
    ['team', VENUE, t.auth.demoNoInvites],
  ] as const)('opens the demo account on a refusal from step %s, never a form', (initialStep, venueId, reason) => {
    render(<OnboardingWizard initialStep={initialStep} venueId={venueId} owner={owner} demoAccount />);
    expect(refusal()).not.toBeNull();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(hasForm()).toBe(false);
  });

  it('starts a normal owner on the welcome step, as before', () => {
    render(<OnboardingWizard initialStep="venue" venueId={null} owner={owner} />);
    expect(refusal()).toBeNull();
    expect(screen.queryByText(t.auth.demoNoVenues)).not.toBeInTheDocument();
  });
});
