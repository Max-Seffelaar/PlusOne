// @vitest-environment jsdom
//
// PoMfaSheet (the po Profile "Turn on two-factor" sheet, and the useMfaGate
// step-up sheet) showed the enrolled TOTP secret in a plain read-only box
// with no way to copy it — Max found this testing PR #339, which had only
// fixed the auth-surface MfaEnrollCard (a different component). The secret
// now renders through the kit's `CopyableField`, which goes through
// `useCopyText`/`copyStateLabel` the same way MfaEnrollCard's own copy
// button does (see MfaEnrollCard.test.tsx for the sibling coverage).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { t } from '@/lib/i18n';

const ENROLL_DATA = {
  id: 'factor-1',
  totp: {
    qr_code: 'data:image/svg+xml;base64,AAAA',
    secret: 'SECRETABC234',
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

// Import after the mocks so the component picks up the mocked supabase client.
import { PoMfaSheet } from './mfa-gate';

const origClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const origExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand');

afterEach(() => {
  vi.clearAllMocks();
  if (origClipboard) Object.defineProperty(navigator, 'clipboard', origClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  if (origExecCommand) Object.defineProperty(document, 'execCommand', origExecCommand);
  else delete (document as { execCommand?: unknown }).execCommand;
});

// No verified factor -> the sheet asks first ("Set up now") before enroll()
// fires and the QR/secret step renders.
async function enterEnrollStep(): Promise<void> {
  render(<PoMfaSheet onVerified={() => {}} onClose={() => {}} />);
  await waitFor(() => screen.getByRole('button', { name: t.shared.mfaGate.setupNow }));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: t.shared.mfaGate.setupNow }));
  });
  await waitFor(() => screen.getByText(ENROLL_DATA.totp.secret));
}

describe('PoMfaSheet — secret copy button', () => {
  it('copies the secret to the clipboard and shows the success label', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    await enterEnrollStep();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t.shared.mfaGate.copySecretAria }));
    });

    expect(writeText).toHaveBeenCalledWith(ENROLL_DATA.totp.secret);
    expect(await screen.findByText(t.shared.kit.copyDone)).toBeInTheDocument();
  });

  it('shows the visible failure label when the clipboard is unavailable', async () => {
    Object.assign(navigator, { clipboard: undefined });
    Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true, writable: true });

    await enterEnrollStep();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t.shared.mfaGate.copySecretAria }));
    });

    expect(await screen.findByText(t.shared.kit.copyFailed)).toBeInTheDocument();
  });
});
