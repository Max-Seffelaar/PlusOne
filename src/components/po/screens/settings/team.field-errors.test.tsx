// @vitest-environment jsdom
/**
 * Team + crew invites point at the field (z8uq9m5m8g; decision Max 2026-10-14):
 * an address on a domain that takes no mail comes back from the action as an
 * `email` field error and lands under the Email input, focused, no line under
 * the form. A refusal without a field (mail cap) stays that line.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { FieldActionError } from '@/lib/field-error';
import { expectFieldError, stubScrollIntoView } from '../../../../../tests/unit/helpers/field-error-asserts';

const H = vi.hoisted(() => ({ inviteUser: vi.fn(), inviteCrew: vi.fn() }));
const stub = () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null });
const NO_MAIL = "That email domain doesn't take mail. Check the part after the @.";

vi.mock('../../app-shell-data', () => ({ useIsDemoVenue: () => false }));
vi.mock('../../context', () => ({ useNav: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('../../shell', () => ({
  BottomBar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('../../mfa-gate', () => ({ useMfaGate: () => ({ guard: () => false, sheet: null }), isAal2Error: () => false }));
vi.mock('./team-crew-sheet', () => ({ CrewManageSheet: () => null }));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles: ['admin'], userId: 'me' }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoTeam: () => ({ data: [], isLoading: false }),
  usePoInvites: () => ({ data: [] }),
  usePoVenueCrew: () => ({ data: [] }),
  usePoEvents: () => ({ data: [{ id: 'ev-1', name: 'Launch Night', date: '12', mon: 'NOV', when: 'upcoming' }], isLoading: false }),
  useBillingBlocked: () => ({ blocked: false, reason: null }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoInviteUser: () => ({ ...stub(), mutate: H.inviteUser }),
  usePoInviteExternalCrew: () => ({ ...stub(), mutate: H.inviteCrew }),
  usePoRevokeInvite: stub,
  usePoResendInvite: stub,
  usePoResendCrewInvite: stub,
  usePoUpdateMemberRoles: stub,
  usePoRemoveMember: stub,
}));

const { TeamInviteForm, Gebruikers } = await import('./team');

beforeEach(stubScrollIntoView);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const rejectOnError = (fn: ReturnType<typeof vi.fn>, e: unknown) =>
  fn.mockImplementation((_i: unknown, opts: { onError?: (e: unknown) => void }) => opts.onError?.(e));

function TeamForm(): JSX.Element {
  return (
    <TeamInviteForm
      email="max@theoperatoirs.nl"
      onEmailChange={vi.fn()}
      roles={['staff']}
      onRolesChange={vi.fn()}
      quota=""
      onQuotaChange={vi.fn()}
      onBack={vi.fn()}
      onSent={vi.fn()}
    />
  );
}

describe('team invite', () => {
  it('a domain that takes no mail: under Email, focused, no line under the form', () => {
    rejectOnError(H.inviteUser, new FieldActionError(NO_MAIL, 'email'));
    render(<TeamForm />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.settings.team.sendInvite) }));
    expectFieldError(screen.getByPlaceholderText(t.settings.team.emailPlaceholder), NO_MAIL);
  });

  it('the action calls the quota defaultQuota: it lands on Quota', () => {
    rejectOnError(H.inviteUser, new FieldActionError('Too high', 'defaultQuota'));
    render(<TeamForm />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.settings.team.sendInvite) }));
    expectFieldError(screen.getByPlaceholderText(t.settings.team.quotaPlaceholder), 'Too high');
  });

  it('no field (mail cap): the line under the form', () => {
    rejectOnError(H.inviteUser, new Error(t.auth.inviteMailCapReached));
    render(<TeamForm />);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.settings.team.sendInvite) }));
    expect(screen.getByRole('alert')).toHaveTextContent(t.auth.inviteMailCapReached);
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});

describe('crew invite from Team', () => {
  it('a domain that takes no mail: under Email, focused', () => {
    rejectOnError(H.inviteCrew, new FieldActionError(NO_MAIL, 'email'));
    render(<Gebruikers />);
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(t.settings.team.inviteCta) })[0]);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.settings.team.chooseCrewTitle) }));
    const email = screen.getByPlaceholderText(t.settings.team.emailPlaceholder);
    fireEvent.change(email, { target: { value: 'max@theoperatoirs.nl' } });
    fireEvent.click(screen.getByRole('button', { name: /Launch Night/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.settings.team.crewSend) }));
    expectFieldError(email, NO_MAIL);
  });
});
