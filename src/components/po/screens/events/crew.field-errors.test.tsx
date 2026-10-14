// @vitest-environment jsdom
/**
 * Crew invite form (z8uq9m5m8g): a refusal about the address or the quota
 * points at that input (marked, message under it, focused, no banner); a
 * refusal without a field (mail cap, rights) stays the line under the button.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { FieldActionError } from '@/lib/field-error';
import { expectFieldError, expectFieldOk, stubScrollIntoView } from '../../../../../tests/unit/helpers/field-error-asserts';

const H = vi.hoisted(() => ({ invite: vi.fn() }));
const stub = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false });

vi.mock('../../app-shell-data', () => ({ useIsDemoVenue: () => false }));
vi.mock('../../context', () => ({ useNav: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('../../shell', () => ({ Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles: ['admin'] }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoCrew: () => ({ data: [], isLoading: false, isError: false }),
  usePoCrewInvites: () => ({ data: [] }),
  usePoAssignableCrew: () => ({ data: [], isLoading: false }),
  usePoEvent: () => ({ event: { name: 'Event' } }),
  usePoEventForEdit: () => ({ data: { defaultMemberQuota: 2 } }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoAssignCrew: stub,
  usePoSetCrewQuota: stub,
  usePoRemoveCrew: stub,
  usePoInviteExternalCrew: () => ({ ...stub(), mutate: H.invite }),
  usePoRevokeCrewInvite: stub,
}));

const { Crew } = await import('./crew');

beforeEach(stubScrollIntoView);
afterEach(() => {
  cleanup();
  H.invite.mockReset();
});

function openAndInvite(): void {
  render(<Crew eventId="e1" />);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(t.events.crew.addHeading) }));
  fireEvent.change(screen.getByPlaceholderText(t.events.crew.invitePlaceholder), { target: { value: 'dj@crew.test' } });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(t.events.crew.inviteCta) }));
}
const failWith = (e: unknown) =>
  H.invite.mockImplementation((_i: unknown, opts: { onError?: (e: unknown) => void }) => opts.onError?.(e));

describe('crew invite field errors', () => {
  it('a refused address is marked under the e-mail input, focused, no banner', () => {
    failWith(new FieldActionError('Enter a valid email address', 'email'));
    openAndInvite();
    const email = screen.getByPlaceholderText(t.events.crew.invitePlaceholder);
    expectFieldError(email, 'Enter a valid email address');
    expectFieldOk(screen.getByPlaceholderText('2'));
  });

  it('a refused quota points at the quota input; typing there clears it', () => {
    failWith(new FieldActionError('Quota is too high', 'quota'));
    openAndInvite();
    const quota = screen.getByPlaceholderText('2');
    expectFieldError(quota, 'Quota is too high');
    fireEvent.change(quota, { target: { value: '3' } });
    expectFieldOk(quota);
  });

  it('a refusal without a field is the line under the button, nothing marked', () => {
    failWith(new Error(t.auth.inviteMailCapReached));
    openAndInvite();
    expect(screen.getByRole('alert')).toHaveTextContent(t.auth.inviteMailCapReached);
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});
