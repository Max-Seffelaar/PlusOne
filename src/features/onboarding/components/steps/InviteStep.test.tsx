// @vitest-environment jsdom
/**
 * A person with no company and an open invite, team or crew (z8uq9m2yvp), decides
 * on /onboarding instead of being pushed into company setup: Accept takes ONE
 * invite and refreshes, so the page sends them on to /app; Decline closes that
 * one and says so; setting up a company stays possible.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({ accept: vi.fn(), decline: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: H.refresh }) }));
vi.mock('@/features/auth/invite-actions', () => ({ acceptInviteAction: H.accept, declineInviteAction: H.decline }));
vi.mock('@/lib/use-native-shell', () => ({ useIsNativeShell: () => false }));

const { InviteStep } = await import('./InviteStep');
const { OnboardingWizard } = await import('../OnboardingWizard');

afterEach(() => {
  cleanup();
  H.accept.mockReset();
  H.decline.mockReset();
  H.refresh.mockReset();
});

const owner = { name: 'Tom', email: 'tom@crew.test' };
const c = t.onboarding.invites;
const crew = { id: 'i-crew', label: 'Crew · Crew Night at De Marktzaal', company: 'De Marktzaal' };
const team = { id: 'i-team', label: 'Club Vesper (Staff)', company: 'Club Vesper' };

describe('InviteStep', () => {
  it('accepts exactly the invite you tapped, then refreshes', async () => {
    H.accept.mockResolvedValue({ ok: true });
    render(<InviteStep invites={[crew, team]} onSkip={vi.fn()} />);
    expect(screen.getByText('You have 2 invites')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: c.accept })[1]!);
    await waitFor(() => expect(H.refresh).toHaveBeenCalled());
    expect(H.accept).toHaveBeenCalledTimes(1);
    expect(H.accept).toHaveBeenCalledWith('i-team');
    expect(H.decline).not.toHaveBeenCalled();
  });

  it('a failed accept shows the error and does not refresh', async () => {
    H.accept.mockResolvedValue({ ok: false, error: 'x' });
    render(<InviteStep invites={[crew]} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: c.accept }));
    expect(await screen.findByRole('alert')).toHaveTextContent(c.error);
    expect(H.refresh).not.toHaveBeenCalled();
  });

  it('decline closes that invite, says so, and leaves the other one', async () => {
    H.decline.mockResolvedValue({ ok: true });
    render(<InviteStep invites={[crew, team]} onSkip={vi.fn()} />);
    fireEvent.click(screen.getAllByRole('button', { name: c.decline })[0]!);
    expect(await screen.findByRole('status')).toHaveTextContent('You declined the invite from De Marktzaal.');
    expect(H.decline).toHaveBeenCalledWith('i-crew');
    expect(screen.queryByText(crew.label)).toBeNull();
    expect(screen.getByText(team.label)).toBeInTheDocument();
    expect(H.refresh).not.toHaveBeenCalled();
  });

  it('after the last decline the way on is company setup', async () => {
    H.decline.mockResolvedValue({ ok: true });
    const onSkip = vi.fn();
    render(<InviteStep invites={[crew]} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: c.decline }));
    const next = await screen.findByRole('button', { name: c.ownCompanyAfter });
    fireEvent.click(next);
    expect(onSkip).toHaveBeenCalled();
  });

  it('a failed decline shows its own error', async () => {
    H.decline.mockResolvedValue({ ok: false, error: 'x' });
    render(<InviteStep invites={[crew]} onSkip={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: c.decline }));
    expect(await screen.findByRole('alert')).toHaveTextContent(c.declineError);
    expect(screen.getByText(crew.label)).toBeInTheDocument();
  });
});

describe('OnboardingWizard with invites', () => {
  it('opens on the invites; "own company" goes on to company setup', () => {
    render(<OnboardingWizard initialStep="venue" venueId={null} owner={owner} invites={[crew]} />);
    expect(screen.getByText(c.headingOne)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: c.ownCompany }));
    expect(screen.getByText('Let’s set up your company'.replace('’', "'"))).toBeInTheDocument();
  });

  it('a team invite is offered the same way, never accepted for them', () => {
    render(<OnboardingWizard initialStep="venue" venueId={null} owner={owner} invites={[team]} />);
    expect(screen.getByText(team.label)).toBeInTheDocument();
    expect(H.accept).not.toHaveBeenCalled();
  });

  it('without invites it starts at the welcome step as before', () => {
    render(<OnboardingWizard initialStep="venue" venueId={null} owner={owner} />);
    expect(screen.queryByText(c.headingOne)).toBeNull();
  });
});
