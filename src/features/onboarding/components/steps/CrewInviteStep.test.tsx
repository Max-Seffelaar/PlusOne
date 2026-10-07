// @vitest-environment jsdom
/**
 * A person with no company and an open crew invite (z8uq9m2yvp, review round 2)
 * accepts on /onboarding instead of being pushed into company setup: Accept
 * calls the explicit accept (accept_my_invites) and refreshes, so the page sends
 * them to /app with their event; setting up a company stays possible.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({ accept: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: H.refresh }) }));
vi.mock('@/features/auth/invite-actions', () => ({ acceptInvitesAction: H.accept }));
vi.mock('@/lib/use-native-shell', () => ({ useIsNativeShell: () => false }));

const { CrewInviteStep } = await import('./CrewInviteStep');
const { OnboardingWizard } = await import('../OnboardingWizard');

afterEach(() => {
  cleanup();
  H.accept.mockReset();
  H.refresh.mockReset();
});

const owner = { name: 'Tom', email: 'tom@crew.test' };

describe('CrewInviteStep', () => {
  it('lists the invites and accepts them, then refreshes', async () => {
    H.accept.mockResolvedValue({ ok: true });
    render(<CrewInviteStep invites={['Crew · Crew Night at De Marktzaal']} onSkip={vi.fn()} />);
    expect(screen.getByText(t.onboarding.crewInvite.headingOne)).toBeInTheDocument();
    expect(screen.getByText('Crew · Crew Night at De Marktzaal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.onboarding.crewInvite.accept }));
    await waitFor(() => expect(H.refresh).toHaveBeenCalled());
    expect(H.accept).toHaveBeenCalledTimes(1);
  });

  it('a failed accept shows the error and does not refresh', async () => {
    H.accept.mockResolvedValue({ ok: false, error: 'x' });
    render(<CrewInviteStep invites={['a', 'b']} onSkip={vi.fn()} />);
    expect(screen.getByText('You have 2 crew invites')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.onboarding.crewInvite.accept }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t.onboarding.crewInvite.error);
    expect(H.refresh).not.toHaveBeenCalled();
  });
});

describe('OnboardingWizard with crew invites', () => {
  it('opens on the crew invite; "own company" goes on to company setup', () => {
    render(<OnboardingWizard initialStep="venue" venueId={null} owner={owner} crewInvites={['Crew · X at Y']} />);
    expect(screen.getByText(t.onboarding.crewInvite.headingOne)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.onboarding.crewInvite.ownCompany }));
    expect(screen.getByText('Let’s set up your company'.replace('’', "'"))).toBeInTheDocument();
  });

  it('without crew invites it starts at the welcome step as before', () => {
    render(<OnboardingWizard initialStep="venue" venueId={null} owner={owner} />);
    expect(screen.queryByText(t.onboarding.crewInvite.headingOne)).toBeNull();
  });
});
