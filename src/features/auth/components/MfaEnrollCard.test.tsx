// @vitest-environment jsdom
//
// Coverage for the same-device enrollment affordances (code review follow-up
// on PR #187): the otpauth:// deep link and the manual-secret copy button.
// Both read straight off supabase.auth.mfa.enroll()'s response, so the mock
// below stands in for that call. The copy button goes through the kit's
// `useCopyText`/`copyStateLabel` (Fase 17 N1 leftover) instead of a bare
// `navigator.clipboard` call, so a failed copy now shows a visible
// "Couldn't copy" label instead of silently staying on "Copy".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { t } from '@/lib/i18n';

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

const origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const origExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

afterEach(() => {
  vi.clearAllMocks();
  if (origClipboard) Object.defineProperty(navigator, 'clipboard', origClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  if (origExecCommand) Object.defineProperty(document, 'execCommand', origExecCommand);
  else delete (document as { execCommand?: unknown }).execCommand;
});

// Step 1 is ask-first (no QR yet) — every case here needs "Set up now" clicked
// before enroll() fires and step 2 (QR/secret) renders.
async function enterStep2(): Promise<void> {
  render(<MfaEnrollCard nextPath="/app" />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /set up now/i }));
  });
  await waitFor(() => screen.getByTestId('totp-secret'));
}

describe('MfaEnrollCard — same-device enrollment', () => {
  it('renders an authenticator-app deep link from the enrollment URI', async () => {
    await enterStep2();

    const link = screen.getByRole('link', { name: /open in authenticator app/i });
    expect(link).toHaveAttribute('href', ENROLL_DATA.totp.uri);
  });

  it('copies the manual secret to the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await enterStep2();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    });

    expect(writeText).toHaveBeenCalledWith(ENROLL_DATA.totp.secret);
    expect(await screen.findByRole('button', { name: /^copied!$/i })).toBeInTheDocument();
  });

  it('shows the visible failure label when the clipboard API is unavailable (webview restriction)', async () => {
    Object.assign(navigator, { clipboard: undefined });
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true, writable: true });

    await enterStep2();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    });

    // No crash, no false "Copied!" when the write never happened — the kit's
    // useCopyText surfaces the failure instead of a silent no-op.
    expect(await screen.findByRole('button', { name: t.shared.kit.copyFailed })).toBeInTheDocument();
  });
});
