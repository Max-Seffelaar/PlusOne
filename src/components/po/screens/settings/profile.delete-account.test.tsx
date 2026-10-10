// @vitest-environment jsdom
/**
 * Profile → Delete account (86ey6bfyj, Google Play account-deletion policy).
 * Accounts are invite-only, so deletion is by request: the row only opens the
 * request page on the marketing site through the kit's `openExternal` (never
 * target=_blank / window.open in the po surface). Visible for every role.
 */
import '@testing-library/jest-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { t } from '@/lib/i18n';
import { DELETE_ACCOUNT_URL } from '@/lib/legal';

const stub = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null, variables: undefined });

const H = vi.hoisted(() => ({
  roles: ['admin'] as string[],
  openExternal: vi.fn(),
}));

vi.mock('../../kit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../kit')>()),
  openExternal: H.openExternal,
}));
vi.mock('../../app-shell-data', () => ({ useIsDemoAccount: () => false }));
vi.mock('../../context', () => ({ useNav: () => ({ push: vi.fn(), back: vi.fn() }) }));
// Its own section with its own query (6b); covered by notification-prefs tests + the flow.
vi.mock('./notification-prefs', () => ({ NotificationPrefsSection: () => null }));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles: H.roles, venueName: 'Venue A' }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoProfile: () => ({
    isLoading: false,
    data: { firstName: 'A', lastName: 'B', phone: '', email: 'me@example.com', name: 'A B', roleLabel: 'Staff', mfaRequired: false },
  }),
  usePoSessions: () => ({ data: [] }),
  usePoCanManageTemplates: () => false,
}));
vi.mock('@/features/po/mutations', () => ({
  usePoUpdateProfile: stub,
  usePoUpdateEmail: stub,
  usePoRevokeOwnSession: stub,
}));
vi.mock('../../mfa-gate', () => ({ PoMfaSheet: () => null }));
vi.mock('../../push-settings-card', () => ({ PushSettingsRow: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { mfa: { listFactors: () => Promise.resolve({ data: { all: [] } }) } } }),
}));
vi.mock('../../phone-lazy', () => ({
  CountrySelect: () => null,
  PhoneInput: () => null,
  phoneCountryOf: () => Promise.resolve(null),
}));

const { Profile } = await import('./profile');

afterEach(() => {
  cleanup();
  H.openExternal.mockClear();
});

const row = () => screen.getByRole('button', { name: new RegExp(t.settings.profile.deleteAccountTitle) });

describe('Profile → Delete account', () => {
  it.each([['admin'], ['user_manager'], ['finance'], ['staff'], ['doorhost'], []] as const)(
    'renders for roles %j',
    (...roles) => {
      H.roles = [...roles];
      render(<Profile />);
      expect(row()).toBeInTheDocument();
      expect(screen.getByText(t.settings.profile.deleteAccountSub)).toBeInTheDocument();
    },
  );

  it('tapping opens the deletion request page via openExternal, nothing else', () => {
    H.roles = ['staff'];
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<Profile />);
    fireEvent.click(row());
    expect(H.openExternal).toHaveBeenCalledTimes(1);
    expect(H.openExternal).toHaveBeenCalledWith(DELETE_ACCOUNT_URL);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('is a button, not a target=_blank anchor', () => {
    render(<Profile />);
    expect(row().tagName).toBe('BUTTON');
    expect(document.querySelector('[target="_blank"]')).toBeNull();
  });

  it('the profile source opens it only through the kit (no window.open / _blank)', () => {
    const src = readFileSync(join(__dirname, 'profile.tsx'), 'utf8');
    expect(src).not.toMatch(/window\.open|target=["']_blank/);
    expect(src).toMatch(/openExternal\(DELETE_ACCOUNT_URL\)/);
  });
});

describe('DELETE_ACCOUNT_URL', () => {
  it('defaults to the marketing-site deletion page', () => {
    if (!process.env.NEXT_PUBLIC_DELETE_ACCOUNT_URL) {
      expect(DELETE_ACCOUNT_URL).toBe('https://www.plus-one.io/delete-account');
    }
    expect(DELETE_ACCOUNT_URL).toMatch(/^https:\/\//);
  });
});
