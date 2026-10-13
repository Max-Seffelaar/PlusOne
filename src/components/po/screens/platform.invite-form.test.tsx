// @vitest-environment jsdom
/**
 * InviteForm double-submit guard (z8uq9m5enh).
 *
 * `isPending` is read from the render closure, so two clicks inside one tick
 * both saw `false` and sent two invites. The mutation hook is mocked with an
 * `isPending` that NEVER flips — exactly the stale-closure case — so only the
 * synchronous ref can keep the second click out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { t } from '@/lib/i18n';

type MutateOpts = { onSuccess?: () => void; onSettled?: () => void };
const H = vi.hoisted(() => ({
  mutate: vi.fn(),
}));

vi.mock('@/features/po/hooks', () => ({
  usePoIsPlatformAdmin: () => true,
  usePoPlatformInvites: () => ({ data: [], isLoading: false, isError: false }),
  usePoPlatformFunnel: () => ({ data: undefined }),
  usePoPlatformCompanies: () => ({ data: undefined, isError: false }),
}));
vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u1', venueId: 'v1', venueName: 'Venue', roles: ['admin'] }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoInviteBetaCustomer: () => ({ mutate: H.mutate, isPending: false, isError: false, isSuccess: false }),
  usePoResendBetaInvite: () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false }),
  usePoRevokeBetaInvite: () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false }),
}));
vi.mock('../context', () => ({
  useNav: () => ({ canGoBack: false, back: vi.fn(), setTab: vi.fn() }),
  usePo: () => ({ switchToVenue: vi.fn() }),
}));

import { InviteForm } from './platform';

function typeEmail(value: string): void {
  fireEvent.change(screen.getByLabelText(t.platform.emailLabel), { target: { value } });
}
const sendButton = (): HTMLElement => screen.getByRole('button', { name: new RegExp(t.platform.send) });

beforeEach(() => {
  H.mutate.mockReset();
});

describe('InviteForm', () => {
  it('two clicks in one tick send ONE invite', () => {
    render(<InviteForm />);
    typeEmail('klant@venue.test');

    act(() => {
      sendButton().click();
      sendButton().click();
    });

    expect(H.mutate).toHaveBeenCalledTimes(1);
  });

  it('a second click after the first settled sends again', () => {
    render(<InviteForm />);
    typeEmail('klant@venue.test');
    act(() => sendButton().click());
    const opts = H.mutate.mock.calls[0][1] as MutateOpts;
    act(() => opts.onSettled?.());

    typeEmail('klant@venue.test');
    act(() => sendButton().click());

    expect(H.mutate).toHaveBeenCalledTimes(2);
  });

  it('clears the form on success (also on "Already invited. Sent the invite again.")', () => {
    render(<InviteForm />);
    typeEmail('klant@venue.test');
    act(() => sendButton().click());
    const opts = H.mutate.mock.calls[0][1] as MutateOpts;
    act(() => {
      opts.onSuccess?.();
      opts.onSettled?.();
    });

    expect((screen.getByLabelText(t.platform.emailLabel) as HTMLInputElement).value).toBe('');
  });
});
