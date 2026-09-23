// @vitest-environment jsdom
//
// 86ey9ea00 #53 — an unknown/uninvited e-mail must be indistinguishable from a
// known one at the login form: same step transition, same message. Before this
// fix, GoTrue's error surfaced as a visibly different "this account doesn't
// exist" banner while a known e-mail moved straight to the code step — that
// difference IS the account-enumeration oracle. The mocked error shape below
// (`code: 'otp_disabled'`, message "Signups not allowed for otp") is GoTrue's
// REAL response, verified against the local Supabase stack directly (PR #243
// review) — an earlier version of this fix matched only `signup_disabled`,
// which GoTrue never actually sends here.
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

  it('moves to the SAME code step, with the SAME message, for an unknown/uninvited e-mail (real GoTrue error shape)', async () => {
    signInWithOtp.mockResolvedValue({
      error: { code: 'otp_disabled', message: 'Signups not allowed for otp' },
    });
    await submitEmail('unknown@venue.com');

    expect(await screen.findByLabelText(/your code/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('We sent a 6-digit code to unknown@venue.com.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('also swallows the legacy signup_disabled spelling (defensive, not what GoTrue actually sends)', async () => {
    signInWithOtp.mockResolvedValue({
      error: { code: 'signup_disabled', message: 'Signups not allowed for otp' },
    });
    await submitEmail('unknown-legacy-code@venue.com');

    expect(await screen.findByLabelText(/your code/i)).toBeInTheDocument();
  });

  it('still surfaces a genuine failure (rate limit) as a distinct error, not a fake code step', async () => {
    signInWithOtp.mockResolvedValue({
      error: { status: 429, message: 'For security purposes, you can only request this after 30 seconds.' },
    });
    await submitEmail('someone@venue.com');

    expect(await screen.findByRole('alert')).toHaveTextContent('30 seconds');
    expect(screen.queryByLabelText(/your code/i)).not.toBeInTheDocument();
  });

  it('shows the "didn\'t get a code?" hint unconditionally on the code step — the invited-but-unconfirmed escape hatch (#53/#54 review)', async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    await submitEmail('known@venue.com');

    expect(await screen.findByText(/didn.t get a code\?/i)).toBeInTheDocument();
  });
});

// P-01 (z8uq9m0tnq): a never-confirmed invitee's 6-digit code lives in the
// confirmation/invite slot, so verifying it only as `type: 'email'` returned
// 403 for every first login. The form now walks the slots in order.
describe('OtpLoginForm — first-login verify fallback', () => {
  async function enterCode(email: string): Promise<void> {
    signInWithOtp.mockResolvedValue({ error: null });
    await submitEmail(email);
    fireEvent.change(await screen.findByLabelText(/your code/i), { target: { value: '123456' } });
    await waitFor(() => expect(verifyOtp).toHaveBeenCalled());
  }

  it('verifies as `email` only, when that works', async () => {
    verifyOtp.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    await enterCode('confirmed@venue.com');

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith(expect.objectContaining({ type: 'email' }));
  });

  it('falls back to `signup` for a never-confirmed invitee', async () => {
    verifyOtp.mockImplementation(async ({ type }: { type: string }) =>
      type === 'signup'
        ? { data: { user: { id: 'u2' } }, error: null }
        : { data: { user: null }, error: { status: 403, message: 'Token has expired or is invalid' } }
    );
    await enterCode('invited@venue.com');

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(2));
    expect(verifyOtp.mock.calls.map((c) => c[0].type)).toEqual(['email', 'signup']);
  });

  it('reaches `invite` and shows one generic error when no slot accepts the code', async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { status: 403, message: 'Token has expired or is invalid' },
    });
    await enterCode('nobody@venue.com');

    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(3));
    expect(verifyOtp.mock.calls.map((c) => c[0].type)).toEqual(['email', 'signup', 'invite']);
    expect(await screen.findByRole('alert')).toHaveTextContent(/didn.t work or has expired/i);
  });
});

describe('OtpLoginForm — bounced-back auth errors (?error=…)', () => {
  it('explains a failed e-mail link and leaves the "send code" step in front of the user', () => {
    render(<OtpLoginForm nextPath="/app" errorKind="link" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/that link didn.t work/i);
    expect(screen.getByRole('button', { name: /send code/i })).toBeInTheDocument();
  });

  it('explains a failed dev login too — every ?error= value has copy', () => {
    render(<OtpLoginForm nextPath="/app" errorKind="devlogin" />);

    expect(screen.getByRole('alert')).toHaveTextContent(/dev login failed/i);
  });

  it('renders no alert at all without an error', () => {
    render(<OtpLoginForm nextPath="/app" />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
