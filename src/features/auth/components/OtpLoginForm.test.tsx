// @vitest-environment jsdom
//
// 86ey9ea00 #53 — an unknown/uninvited e-mail must be indistinguishable from a
// known one at the login form: same step transition, same message. Before this
// fix, GoTrue's `signup_disabled` error surfaced as a visibly different "this
// account doesn't exist" banner while a known e-mail moved straight to the
// code step — that difference IS the account-enumeration oracle.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithOtp, verifyOtp } }),
}));

// Import after the mock so the component picks up the mocked supabase client.
import { OtpLoginForm } from './OtpLoginForm';

afterEach(() => {
  vi.clearAllMocks();
});

async function submitEmail(email: string): Promise<void> {
  render(<OtpLoginForm nextPath="/app" />);
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: /send code/i }));
  await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
}

describe('OtpLoginForm — account-enumeration guard', () => {
  it('moves to the code step for a known e-mail (baseline)', async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    await submitEmail('known@venue.com');

    expect(await screen.findByLabelText(/your code/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('We sent a 6-digit code to known@venue.com.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('moves to the SAME code step, with the SAME message, for an unknown/uninvited e-mail', async () => {
    signInWithOtp.mockResolvedValue({
      error: { code: 'signup_disabled', message: 'Signups not allowed for otp' },
    });
    await submitEmail('unknown@venue.com');

    expect(await screen.findByLabelText(/your code/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('We sent a 6-digit code to unknown@venue.com.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still surfaces a genuine failure (rate limit) as a distinct error, not a fake code step', async () => {
    signInWithOtp.mockResolvedValue({
      error: { status: 429, message: 'For security purposes, you can only request this after 30 seconds.' },
    });
    await submitEmail('someone@venue.com');

    expect(await screen.findByRole('alert')).toHaveTextContent('30 seconds');
    expect(screen.queryByLabelText(/your code/i)).not.toBeInTheDocument();
  });
});
