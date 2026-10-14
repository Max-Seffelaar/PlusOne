// @vitest-environment jsdom
/**
 * Profile (z8uq9m5m8g): the name/phone form and the e-mail change point at
 * the field a refusal is about — marked, message under it, focused, no line
 * under the form; a refusal without a field stays that line.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { t } from '@/lib/i18n';
import { FieldActionError } from '@/lib/field-error';
import { expectFieldError, stubScrollIntoView } from '../../../../../tests/unit/helpers/field-error-asserts';

const H = vi.hoisted(() => ({ updateProfile: vi.fn(), updateEmail: vi.fn(), phoneValid: true }));
const stub = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null });

vi.mock('../../app-shell-data', () => ({ useIsDemoAccount: () => false }));
vi.mock('../../context', () => ({ useNav: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('./notification-prefs', () => ({ NotificationPrefsSection: () => null }));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles: ['admin'], venueName: 'Venue A' }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoProfile: () => ({
    isLoading: false,
    data: { firstName: 'A', lastName: 'B', phone: '', email: 'me@example.com', name: 'A B', roleLabel: 'Admin', mfaRequired: false },
  }),
  usePoSessions: () => ({ data: [] }),
  usePoCanManageTemplates: () => false,
}));
vi.mock('@/features/po/mutations', () => ({
  usePoUpdateProfile: () => ({ ...stub(), mutate: H.updateProfile }),
  usePoUpdateEmail: () => ({ ...stub(), mutate: H.updateEmail }),
  usePoRevokeOwnSession: stub,
}));
vi.mock('../../mfa-gate', () => ({ PoMfaSheet: () => null }));
vi.mock('../../push-settings-card', () => ({ PushSettingsRow: () => null }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { mfa: { listFactors: () => Promise.resolve({ data: { all: [] } }) } } }),
}));
vi.mock('../../phone-lazy', () => ({
  PhoneField: (p: { id?: string; value?: string; onChange: (v?: string) => void; invalid?: boolean; describedBy?: string }) => (
    <div data-field-shell>
      <input
        aria-label="phone"
        id={p.id}
        value={p.value ?? ''}
        onChange={(e) => p.onChange(e.target.value || undefined)}
        aria-invalid={p.invalid || undefined}
        aria-describedby={p.describedBy}
      />
    </div>
  ),
  isPhoneValid: async () => H.phoneValid,
  phoneCountryOf: () => Promise.resolve(null),
}));

const { Profile } = await import('./profile');

beforeEach(() => {
  stubScrollIntoView();
  H.phoneValid = true;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const rejectOnError = (fn: ReturnType<typeof vi.fn>, e: unknown) =>
  fn.mockImplementation((_i: unknown, opts: { onError?: (e: unknown) => void }) => opts.onError?.(e));

describe('profile field errors', () => {
  it('a refused last name is marked under it, focused, no line under the form', () => {
    rejectOnError(H.updateProfile, new FieldActionError('That name is reserved.', 'lastName'));
    render(<Profile />);
    fireEvent.change(screen.getByPlaceholderText(t.settings.profile.lastNamePlaceholder), { target: { value: 'Support' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.settings.profile.save}`) }));
    expectFieldError(screen.getByPlaceholderText(t.settings.profile.lastNamePlaceholder), 'That name is reserved.');
  });

  it('a refused phone number points at the phone row', () => {
    rejectOnError(H.updateProfile, new FieldActionError('Invalid phone number', 'phone'));
    render(<Profile />);
    fireEvent.change(screen.getByPlaceholderText(t.settings.profile.firstNamePlaceholder), { target: { value: 'Ann' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.settings.profile.save}`) }));
    expectFieldError(screen.getByRole('textbox', { name: 'phone' }), 'Invalid phone number');
  });

  it('the e-mail change: a refused address points at the e-mail input', () => {
    rejectOnError(H.updateEmail, new FieldActionError('This is already your current email.', 'email'));
    render(<Profile />);
    const email = screen.getByDisplayValue('me@example.com');
    fireEvent.change(email, { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.settings.profile.changeEmail) }));
    expectFieldError(email, 'This is already your current email.');
  });

  it('a refusal without a field stays the line under the form', () => {
    rejectOnError(H.updateProfile, new Error("Couldn't save your profile."));
    render(<Profile />);
    fireEvent.change(screen.getByPlaceholderText(t.settings.profile.firstNamePlaceholder), { target: { value: 'Ann' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.settings.profile.save}`) }));
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save your profile.");
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });

  // Max, testing #506: an emptied name used to disable Save, so nothing ever said why.
  it('Save stays on with an emptied first name; the check marks First name, focused, nothing sent', async () => {
    render(<Profile />);
    const first = screen.getByPlaceholderText(t.settings.profile.firstNamePlaceholder);
    fireEvent.change(first, { target: { value: '' } });
    const save = screen.getByRole('button', { name: new RegExp(`^${t.settings.profile.save}`) });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(first).toHaveAttribute('aria-invalid', 'true'));
    expectFieldError(first, t.settings.profile.firstNameRequired);
    expect(H.updateProfile).not.toHaveBeenCalled();
  });

  it('both names emptied: both marked, focus on First name (form order)', async () => {
    render(<Profile />);
    const first = screen.getByPlaceholderText(t.settings.profile.firstNamePlaceholder);
    const last = screen.getByPlaceholderText(t.settings.profile.lastNamePlaceholder);
    fireEvent.change(first, { target: { value: '  ' } });
    fireEvent.change(last, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.settings.profile.save}`) }));
    await waitFor(() => expect(document.activeElement).toBe(first));
    expectFieldError(first, t.settings.profile.firstNameRequired);
    expectFieldError(last, t.settings.profile.lastNameRequired, { focused: false });
  });

  it('a phone number that cannot be real: the client check marks the phone row, nothing sent', async () => {
    H.phoneValid = false;
    render(<Profile />);
    const phone = screen.getByRole('textbox', { name: 'phone' });
    fireEvent.change(phone, { target: { value: '+3112' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.settings.profile.save}`) }));
    await waitFor(() => expect(phone).toHaveAttribute('aria-invalid', 'true'));
    expectFieldError(phone, t.guests.contacts.phoneInvalid);
    expect(H.updateProfile).not.toHaveBeenCalled();
  });

  it('an empty phone is still fine: the save goes out', async () => {
    render(<Profile />);
    fireEvent.change(screen.getByPlaceholderText(t.settings.profile.firstNamePlaceholder), { target: { value: 'Ann' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.settings.profile.save}`) }));
    await waitFor(() => expect(H.updateProfile).toHaveBeenCalledWith({ firstName: 'Ann', lastName: 'B', phone: '' }, expect.anything()));
  });
});
