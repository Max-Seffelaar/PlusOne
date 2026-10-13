// @vitest-environment jsdom
/**
 * Guests forms point at the field (z8uq9m5m8g): the inline "Add tier" form,
 * the remove-guest note, and the two contact sheets (promote a guest, edit a
 * contact). A client check and a server `field` land the same way: the input
 * marked, its message under it, focused, no banner. A refusal without a field
 * stays the banner.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { FieldActionError } from '@/lib/field-error';
import { expectFieldError, stubScrollIntoView } from '../../../../../tests/unit/helpers/field-error-asserts';

const H = vi.hoisted(() => ({
  createTier: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  promote: vi.fn(),
  upsert: vi.fn(),
  phoneValid: true,
}));
const stub = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });

vi.mock('../../context', () => ({ useNav: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('../../shell', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ConfirmSheet: ({ children, confirmLabel, onConfirm }: { children: ReactNode; confirmLabel: string; onConfirm: () => void }) => (
    <div>
      {children}
      <button type="button" onClick={onConfirm}>
        {confirmLabel}
      </button>
    </div>
  ),
}));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ venueId: 'v1', roles: ['admin'] }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoTiers: () => ({ data: [] }),
  usePoQuota: () => ({ data: null }),
  usePoEvents: () => ({ data: [] }),
  usePoGuests: () => ({ data: [] }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoCreateTier: () => ({ ...stub(), mutateAsync: H.createTier }),
  usePoRemoveGuest: () => ({ ...stub(), mutate: H.remove }),
  usePoChangeGuestTier: stub,
  usePoUpdateGuest: () => ({ ...stub(), mutate: H.update }),
  usePoPromoteGuestToContact: () => ({ ...stub(), mutate: H.promote }),
  usePoUpsertContact: () => ({ ...stub(), mutate: H.upsert }),
  usePoToggleContactPermanent: stub,
  usePoAddContactToEvent: stub,
  usePoForgetContact: stub,
}));
// The phone row: a plain input that takes the same error props the real one passes on.
vi.mock('../../phone-lazy', () => ({
  PhoneField: (p: { value?: string; onChange: (v?: string) => void; id?: string; invalid?: boolean; describedBy?: string }) => (
    <div data-field-shell>
      <input
        aria-label="phone"
        id={p.id}
        value={p.value ?? ''}
        aria-invalid={p.invalid || undefined}
        aria-describedby={p.describedBy}
        onChange={(e) => p.onChange(e.target.value)}
      />
    </div>
  ),
  isPhoneValid: async () => H.phoneValid,
  useStoredPhoneCountry: () => ['NL', vi.fn()],
}));

const { AddTierInline } = await import('./_shared');
const { RemoveGuestSheet } = await import('./profile-event-actions');
const { PromoteSheet, ContactEditSheet } = await import('./profile-sheets');

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

describe('inline Add tier (guests/_shared)', () => {
  function open(): void {
    render(<AddTierInline eventId="e1" />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.guests.tierCreate.addBtn) }));
    fireEvent.change(screen.getByPlaceholderText(t.guests.tierCreate.namePlaceholder), { target: { value: 'VIP' } });
    fireEvent.click(screen.getByRole('button', { name: t.events.tierKindPaid }));
  }

  it('client check: paid without a price points at the price input', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.guests.tierCreate.createBtn) }));
    expectFieldError(screen.getByPlaceholderText(t.guests.tierCreate.pricePlaceholder), t.events.errPaidNeedsPrice);
    expect(H.createTier).not.toHaveBeenCalled();
  });

  it('server field: a refused VAT is marked under the VAT input', async () => {
    H.createTier.mockRejectedValue(new FieldActionError('VAT is too high', 'vatPercent'));
    open();
    fireEvent.change(screen.getByPlaceholderText(t.guests.tierCreate.pricePlaceholder), { target: { value: '10' } });
    fireEvent.change(screen.getByPlaceholderText(t.events.vatPlaceholder), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.guests.tierCreate.createBtn) }));
    const vat = screen.getByPlaceholderText(t.events.vatPlaceholder);
    await waitFor(() => expect(vat).toHaveAttribute('aria-invalid', 'true'));
    expectFieldError(vat, 'VAT is too high');
  });

  it('no field: the banner', async () => {
    H.createTier.mockRejectedValue(new Error('No rights'));
    open();
    fireEvent.click(screen.getByRole('button', { name: t.events.tierKindFree }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.guests.tierCreate.createBtn) }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No rights'));
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});

describe('remove guest: the note for the guest', () => {
  const event = { eventId: 'e1', guestId: 'g1', name: 'Friday', registeredHeads: 1, presentHeads: null } as never;

  it('the required-note refusal points at the note', () => {
    rejectOnError(H.remove, new FieldActionError(t.guests.mail.removeNoteRequired, 'note'));
    render(<RemoveGuestSheet event={event} guestName="Ann" onClose={vi.fn()} onRemoved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: t.guests.contactProfile.removeConfirm }));
    expectFieldError(screen.getByRole('textbox', { name: t.guests.mail.removeNoteLabel }), t.guests.mail.removeNoteRequired);
  });

  it('a refusal without a field (list locked) is the banner', () => {
    rejectOnError(H.remove, new Error('The list is locked.'));
    render(<RemoveGuestSheet event={event} guestName="Ann" onClose={vi.fn()} onRemoved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: t.guests.contactProfile.removeConfirm }));
    expect(screen.getByRole('alert')).toHaveTextContent('The list is locked.');
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});

describe('promote a guest to a contact', () => {
  const props = { guestId: 'g1', eventId: 'e1', defaultName: 'Ann', defaultEmail: null, defaultPhone: null, onClose: vi.fn(), onSaved: vi.fn() };
  const save = () => fireEvent.click(screen.getByRole('button', { name: new RegExp(t.guests.contactProfile.promoteSave) }));

  it('client check: an invalid phone points at the phone input', async () => {
    H.phoneValid = false;
    render(<PromoteSheet {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'phone' }), { target: { value: '+3112' } });
    save();
    const phone = screen.getByRole('textbox', { name: 'phone' });
    await waitFor(() => expect(phone).toHaveAttribute('aria-invalid', 'true'));
    expectFieldError(phone, t.guests.contacts.phoneInvalid);
  });

  it('server field: a refused e-mail is marked under the e-mail input', async () => {
    rejectOnError(H.update, new FieldActionError('Invalid email', 'email'));
    render(<PromoteSheet {...props} />);
    const email = screen.getByPlaceholderText(t.guests.contacts.emailPlaceholder);
    fireEvent.change(email, { target: { value: 'nope' } });
    save();
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expectFieldError(email, 'Invalid email');
  });
});

describe('edit a contact', () => {
  const contact = { id: 'c1', name: 'Ann', email: 'ann@x.test', phone: null, preferredRole: null, birthdate: null, note: null, events: 2, vast: false } as never;

  it('server field: a refused name (e.g. a reserved label) points at the name input', async () => {
    render(<ContactEditSheet contact={contact} onClose={vi.fn()} onSaved={vi.fn()} onForget={vi.fn()} />);
    const name = screen.getByPlaceholderText(t.guests.contacts.namePlaceholder);
    rejectOnError(H.upsert, new FieldActionError('Enter a name', 'fullName'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.guests.contacts.save}`) }));
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expectFieldError(name, 'Enter a name');
  });

  it('two fields refused: both marked, focus on the first in form order (name before e-mail)', async () => {
    rejectOnError(H.upsert, new FieldActionError('Invalid email', 'email', { email: 'Invalid email', fullName: 'Too long' }));
    render(<ContactEditSheet contact={contact} onClose={vi.fn()} onSaved={vi.fn()} onForget={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.guests.contacts.save}`) }));
    const name = screen.getByPlaceholderText(t.guests.contacts.namePlaceholder);
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expectFieldError(name, 'Too long');
    expectFieldError(screen.getByPlaceholderText(t.guests.contacts.emailPlaceholder), 'Invalid email', { focused: false });
  });
});
