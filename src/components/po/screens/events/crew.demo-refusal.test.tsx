// @vitest-environment jsdom
/**
 * Store-review demo account (86ey6bfug): the event crew screen shows the
 * refusal upfront and "Add crew" is inert — the add sheet (e-mail invite AND
 * returning crew) never opens. An admin keeps the sheet. UX only — the server
 * actions and the DB triggers still refuse.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({ demo: false, invite: vi.fn(), revoke: vi.fn(), invites: [] as unknown[] }));
const stub = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false });

vi.mock('../../app-shell-data', () => ({ useIsDemoVenue: () => H.demo }));
vi.mock('../../context', () => ({ useNav: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('../../shell', () => ({ Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles: ['admin'] }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoCrew: () => ({ data: [], isLoading: false, isError: false }),
  usePoCrewInvites: (_id: string, enabled: boolean) => ({ data: enabled ? H.invites : undefined }),
  usePoAssignableCrew: () => ({ data: [], isLoading: false }),
  usePoEvent: () => ({ event: { name: 'Event' } }),
  usePoEventForEdit: () => ({ data: { defaultMemberQuota: 2 } }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoAssignCrew: stub,
  usePoSetCrewQuota: stub,
  usePoRemoveCrew: stub,
  usePoInviteExternalCrew: () => ({ ...stub(), mutate: H.invite }),
  usePoRevokeCrewInvite: () => ({ ...stub(), mutate: H.revoke }),
}));

const { Crew } = await import('./crew');

afterEach(() => {
  cleanup();
  H.invite.mockClear();
  H.revoke.mockClear();
  H.invites = [];
});

const openSheet = () => fireEvent.click(screen.getByRole('button', { name: new RegExp(t.events.crew.addHeading) }));

describe('event crew invite', () => {
  it('demo: the note is shown upfront, "Add crew" is inert and no sheet opens', () => {
    H.demo = true;
    render(<Crew eventId="e1" />);
    expect(screen.getByText(t.auth.demoNoInvites)).toBeInTheDocument();
    const add = screen.getByRole('button', { name: new RegExp(t.events.crew.addHeading) });
    expect(add).toBeDisabled();
    openSheet();
    expect(screen.queryByText(t.events.crew.addExplainer)).toBeNull();
    expect(screen.queryByPlaceholderText(t.events.crew.invitePlaceholder)).toBeNull();
    expect(screen.queryByText(t.events.crew.assignLabel)).toBeNull();
    expect(H.invite).not.toHaveBeenCalled();
  });

  it('admin: no note, the invite form is there', () => {
    H.demo = false;
    render(<Crew eventId="e1" />);
    expect(screen.queryByText(t.auth.demoNoInvites)).toBeNull();
    openSheet();
    expect(screen.getByPlaceholderText(t.events.crew.invitePlaceholder)).toBeInTheDocument();
  });

  it('admin: a successful invite shows the one success notice and no error (new or existing account alike, z8uq9m2yvp)', () => {
    H.demo = false;
    H.invite.mockImplementation((_input: unknown, opts: { onSuccess?: () => void }) => opts.onSuccess?.());
    render(<Crew eventId="e1" />);
    openSheet();
    fireEvent.change(screen.getByPlaceholderText(t.events.crew.invitePlaceholder), {
      target: { value: 'staff@plusone.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.events.crew.inviteCta) }));
    expect(H.invite).toHaveBeenCalledWith(
      { email: 'staff@plusone.test', eventIds: ['e1'], quota: 2 },
      expect.anything(),
    );
    expect(screen.getByRole('status')).toHaveTextContent(t.events.crew.inviteDone);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).not.toMatch(/already has an account/i);
  });

  it('admin: open crew invites show under "Waiting to accept" with quota + expiry; Revoke asks first (z8uq9m2yvp)', () => {
    H.demo = false;
    H.invites = [
      { id: 'iv1', email: 'dj@crew.test', quota: 4, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() },
    ];
    render(<Crew eventId="e1" />);
    expect(screen.getByText(t.events.crew.pendingLabel)).toBeInTheDocument();
    expect(screen.getByText('dj@crew.test')).toBeInTheDocument();
    expect(screen.getByText('4 guests · Expires in 7 days')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.events.crew.revoke }));
    expect(H.revoke).not.toHaveBeenCalled();
    expect(screen.getByText(t.events.crew.revokeConfirm)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.events.crew.revokeConfirmCta }));
    expect(H.revoke).toHaveBeenCalledWith({ inviteId: 'iv1' }, expect.anything());
  });

  it('admin: no open invites, no Pending section', () => {
    H.demo = false;
    render(<Crew eventId="e1" />);
    expect(screen.queryByText(t.events.crew.pendingLabel)).toBeNull();
  });
});
