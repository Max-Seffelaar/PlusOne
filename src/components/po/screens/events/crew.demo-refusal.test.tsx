// @vitest-environment jsdom
/**
 * Store-review demo account (86ey6bfug): the event crew screen shows the
 * invite refusal upfront and the add sheet carries the note instead of the
 * e-mail invite form. An admin keeps the form. UX only — the server action
 * still refuses the demo account.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({ demo: false, invite: vi.fn() }));
const stub = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false });

vi.mock('../../app-shell-data', () => ({ useIsDemoAccount: () => H.demo }));
vi.mock('../../context', () => ({ useNav: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('../../shell', () => ({ Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles: ['admin'] }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoCrew: () => ({ data: [], isLoading: false, isError: false }),
  usePoAssignableCrew: () => ({ data: [], isLoading: false }),
  usePoEvent: () => ({ event: { name: 'Event' } }),
  usePoEventForEdit: () => ({ data: { defaultMemberQuota: 2 } }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoAssignCrew: stub,
  usePoSetCrewQuota: stub,
  usePoRemoveCrew: stub,
  usePoInviteExternalCrew: () => ({ ...stub(), mutate: H.invite }),
}));

const { Crew } = await import('./crew');

afterEach(() => {
  cleanup();
  H.invite.mockClear();
});

const openSheet = () => fireEvent.click(screen.getByRole('button', { name: new RegExp(t.events.crew.addHeading) }));

describe('event crew invite', () => {
  it('demo: the note is shown upfront and the sheet has no invite form', () => {
    H.demo = true;
    render(<Crew eventId="e1" />);
    expect(screen.getByText(t.auth.demoNoInvites)).toBeInTheDocument();
    openSheet();
    expect(screen.queryByPlaceholderText(t.events.crew.invitePlaceholder)).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(t.events.crew.inviteCta) })).toBeNull();
    expect(screen.getAllByText(t.auth.demoNoInvites).length).toBeGreaterThanOrEqual(2);
    expect(H.invite).not.toHaveBeenCalled();
  });

  it('admin: no note, the invite form is there', () => {
    H.demo = false;
    render(<Crew eventId="e1" />);
    expect(screen.queryByText(t.auth.demoNoInvites)).toBeNull();
    openSheet();
    expect(screen.getByPlaceholderText(t.events.crew.invitePlaceholder)).toBeInTheDocument();
  });
});
