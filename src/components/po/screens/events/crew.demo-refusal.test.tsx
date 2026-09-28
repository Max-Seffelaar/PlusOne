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

const H = vi.hoisted(() => ({ demo: false, invite: vi.fn() }));
const stub = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false });

vi.mock('../../app-shell-data', () => ({ useIsDemoVenue: () => H.demo }));
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
});
