// @vitest-environment jsdom
//
// Coverage for the same-device enrollment affordances (code review follow-up
// on PR #187): the otpauth:// deep link and the manual-secret copy button.
// Both read straight off supabase.auth.mfa.enroll()'s response, so the mock
// below stands in for that call.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const ENROLL_DATA = {
  id: 'factor-1',
  totp: {
    qr_code: 'data:image/svg+xml;base64,AAAA',
    secret: 'SECRETABC234',
    uri: 'otpauth://totp/PlusOne:test@example.com?secret=SECRETABC234&issuer=PlusOne',
  },
};

const mfa = {
  listFactors: vi.fn(async () => ({ data: { all: [] } })),
  unenroll: vi.fn(async () => ({ data: {}, error: null })),
  enroll: vi.fn(async () => ({ data: ENROLL_DATA, error: null })),
  challengeAndVerify: vi.fn(async () => ({ data: {}, error: null })),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { mfa } }),
}));

vi.mock('@/features/auth/mfa-actions', () => ({
  snoozeMfaAction: vi.fn(async () => ({ ok: true })),
}));

// Import after the mocks so the component picks up the mocked supabase client.
import { MfaEnrollCard } from './MfaEnrollCard';

afterEach(() => {
  vi.clearAllMocks();
});

describe('MfaEnrollCard — same-device enrollment', () => {
  it('renders an authenticator-app deep link from the enrollment URI', async () => {
    render(<MfaEnrollCard nextPath="/app" />);

    const link = await screen.findByRole('link', { name: /open in authenticator app/i });
    expect(link).toHaveAttribute('href', ENROLL_DATA.totp.uri);
  });

  it('copies the manual secret to the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MfaEnrollCard nextPath="/app" />);
    await waitFor(() => screen.getByTestId('totp-secret'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    });

    expect(writeText).toHaveBeenCalledWith(ENROLL_DATA.totp.secret);
    expect(await screen.findByRole('button', { name: /^copied!$/i })).toBeInTheDocument();
  });

  it('does not throw when the clipboard API is unavailable (webview restriction)', async () => {
    Object.assign(navigator, { clipboard: undefined });

    render(<MfaEnrollCard nextPath="/app" />);
    await waitFor(() => screen.getByTestId('totp-secret'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    });

    // Stays on "Copy" — no crash, no false "Copied!" when the write never happened.
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeInTheDocument();
  });
});
