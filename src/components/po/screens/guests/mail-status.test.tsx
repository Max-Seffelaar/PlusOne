// @vitest-environment jsdom
/**
 * The confirmation on the guest profile's event card (z8uq9m49k1, #463): the
 * state line is always there, "Resend confirmation" only when the database
 * allows it AND the viewer may edit the guest, the bounce hint when a new
 * address is needed. It lives on the card, not behind "Edit".
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { t } from '@/lib/i18n';
import type { GuestConfirmation } from '@/features/po/guest-mail-status';

const H = vi.hoisted(() => ({
  status: new Map<string, GuestConfirmation>(),
  mutate: vi.fn(),
}));
vi.mock('@/features/po/guest-mail-status', () => ({
  usePoGuestMailStatus: () => ({ data: H.status }),
  usePoResendConfirmation: () => ({ mutate: H.mutate, isPending: false, isSuccess: false, isError: false, error: null }),
}));

const { EventCardConfirmation } = await import('./mail-status');
const m = t.guests.mail;
const G = 'g1';

afterEach(() => {
  cleanup();
  H.status.clear();
  H.mutate.mockReset();
});

function card(status: GuestConfirmation, mayEdit = true): void {
  H.status.set(G, status);
  render(<EventCardConfirmation guestId={G} eventId="e1" mayEdit={mayEdit} />);
}

describe('EventCardConfirmation', () => {
  it('sent and resendable: the state and a visible Resend that queues for this guest', () => {
    card({ state: 'sent', canResend: true, needsNewAddress: false });
    expect(screen.getByTestId('guest-mail-status')).toHaveAttribute('data-state', 'sent');
    fireEvent.click(screen.getByRole('button', { name: m.resend }));
    expect(H.mutate).toHaveBeenCalledWith(G);
  });

  it('a viewer who may not edit the guest sees the state but no button', () => {
    card({ state: 'not_sent', canResend: true, needsNewAddress: false }, false);
    expect(screen.getByTestId('guest-mail-status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: m.resend })).toBeNull();
  });

  it('bounced at the current address: the hint inline, no button', () => {
    card({ state: 'bounced', canResend: false, needsNewAddress: true });
    expect(screen.getByText(m.bouncedHint)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: m.resend })).toBeNull();
  });

  it('no address, no state: nothing on the card', () => {
    render(<EventCardConfirmation guestId="other" eventId="e1" mayEdit />);
    expect(screen.queryByTestId('guest-confirmation')).toBeNull();
  });
});
