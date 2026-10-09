// @vitest-environment jsdom
/**
 * "Invite team member" on Quota per event (z8uq9m2vg7): only for who may invite
 * (admin, user manager), opens Team's own invite form (not a second one), sends
 * through the same invite mutation, and lands back on Quota per event. Pending
 * invites show as one line above the list. UX only — inviteUserAction keeps the
 * role check, billing gate and audit (covered by its own tests).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { t, fmt } from '@/lib/i18n';
import { ROLE_LABELS } from '@/features/auth/roles';

const H = vi.hoisted(() => ({
  roles: ['admin'] as string[],
  blocked: false,
  demo: false,
  invites: [] as { id: string; status: string }[],
  invite: vi.fn(),
}));

vi.mock('../../app-shell-data', () => ({ useIsDemoVenue: () => H.demo }));
vi.mock('../../context', () => ({ useNav: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('../../mfa-gate', () => ({ useMfaGate: () => ({ guard: vi.fn(), sheet: null }), isAal2Error: () => false }));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles: H.roles }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoTeam: () => ({ data: [] }),
  usePoEvents: () => ({ data: [{ id: 'ev-1', name: 'Launch Night', when: 'upcoming' }], isLoading: false }),
  usePoEventAllowance: () => ({
    data: [{ userId: 'u1', name: 'Tom Bakker', rolesLabel: 'Staff', quota: 10, override: 12 }],
    isLoading: false,
    isError: false,
  }),
  usePoInvites: () => ({ data: H.invites }),
  useBillingBlocked: () => ({ blocked: H.blocked, reason: H.blocked ? 'trial_expired' : null }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoSetDefaultQuota: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  usePoSetAllowance: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  usePoInviteUser: () => ({ mutate: H.invite, isPending: false, isError: false, error: null }),
}));

import { Allowance } from './quota';

beforeEach(() => {
  H.roles = ['admin'];
  H.blocked = false;
  H.demo = false;
  H.invites = [];
  H.invite.mockReset();
});
afterEach(cleanup);

const cta = (): HTMLElement | null => screen.queryByRole('button', { name: t.settings.quota.inviteCta });

describe('Quota per event — Invite team member (z8uq9m2vg7)', () => {
  it('shows the button to an admin', () => {
    render(<Allowance />);
    expect(cta()).toBeInTheDocument();
  });

  it('hides it from finance (sees quota, may not invite)', () => {
    H.roles = ['finance'];
    render(<Allowance />);
    expect(screen.getByText('Tom Bakker')).toBeInTheDocument();
    expect(cta()).not.toBeInTheDocument();
  });

  it('hides it on a billing-locked company, like Team does', () => {
    H.blocked = true;
    render(<Allowance />);
    expect(cta()).not.toBeInTheDocument();
  });

  it("opens Team's invite form, sends through the invite mutation and returns to Quota per event", () => {
    render(<Allowance />);
    fireEvent.click(cta()!);
    expect(screen.getByText(t.settings.team.inviteTitle)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(t.settings.team.emailPlaceholder), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: ROLE_LABELS.staff }));
    fireEvent.click(screen.getByRole('button', { name: t.settings.team.sendInvite }));
    expect(H.invite).toHaveBeenCalledWith(
      { email: 'new@example.com', roles: ['staff'], defaultQuota: undefined },
      expect.anything(),
    );

    // The mutation's onSuccess closes the form: back on the quota list.
    const opts = H.invite.mock.calls[0]![1] as { onSuccess: () => void };
    act(() => opts.onSuccess());
    expect(screen.queryByText(t.settings.team.inviteTitle)).not.toBeInTheDocument();
    expect(screen.getByText('Tom Bakker')).toBeInTheDocument();
  });

  it('shows open invites as one pending line', () => {
    H.invites = [
      { id: 'i1', status: 'pending' },
      { id: 'i2', status: 'accepted' },
      { id: 'i3', status: 'declined' },
    ];
    render(<Allowance />);
    expect(screen.getByTestId('quota-invites-pending')).toHaveTextContent(fmt(t.settings.quota.invitesPendingOne, { n: 1 }));
  });
});
