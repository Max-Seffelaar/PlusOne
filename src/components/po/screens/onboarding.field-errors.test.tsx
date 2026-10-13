// @vitest-environment jsdom
/**
 * New company form (z8uq9m5m8g): createVenueAction's refusals land on the
 * input they are about — every field it names, focus on the first in form
 * order — and only a refusal without a field stays the line above Submit.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { expectFieldError, stubScrollIntoView } from '../../../../tests/unit/helpers/field-error-asserts';

const H = vi.hoisted(() => ({ create: vi.fn(), switchTo: vi.fn() }));

vi.mock('@/features/venues/actions', () => ({ createVenueAction: H.create, switchActiveVenueAction: H.switchTo }));
vi.mock('../app-shell-data', () => ({ useIsDemoAccount: () => false }));
vi.mock('../context', () => ({ useNav: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('../shell', () => ({ BottomBar: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

const { VenueCreate } = await import('./onboarding');
const vc = t.onboarding.venueCreate;

beforeEach(stubScrollIntoView);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fillAndSubmit(): void {
  render(<VenueCreate />);
  fireEvent.change(screen.getByPlaceholderText(vc.companyNamePlaceholder), { target: { value: 'Club Nine' } });
  fireEvent.change(screen.getByPlaceholderText(vc.kvkPlaceholder), { target: { value: '123' } });
  fireEvent.change(screen.getByPlaceholderText(vc.billingEmailPlaceholder), { target: { value: 'nope' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: new RegExp(vc.submit) }));
}

describe('new company form', () => {
  it('KVK and billing e-mail refused: both marked, focus on KVK (first in form order), no banner', async () => {
    H.create.mockResolvedValue({
      ok: false,
      code: 'invalid',
      message: 'Invalid email',
      field: 'financeEmail',
      fields: { financeEmail: 'Invalid email', kvkNumber: 'KVK number is 8 digits' },
    });
    fillAndSubmit();
    const kvk = screen.getByPlaceholderText(vc.kvkPlaceholder);
    // The refusal arrives inside an async transition: focus follows in the next effect flush.
    await waitFor(() => expect(document.activeElement).toBe(kvk));
    expectFieldError(kvk, 'KVK number is 8 digits');
    expectFieldError(screen.getByPlaceholderText(vc.billingEmailPlaceholder), 'Invalid email', { focused: false });
    expect(H.switchTo).not.toHaveBeenCalled();
  });

  it('a refusal without a field stays the line above Submit', async () => {
    H.create.mockResolvedValue({ ok: false, code: '42501', message: 'Not allowed.' });
    fillAndSubmit();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not allowed.'));
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});
