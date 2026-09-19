// @vitest-environment jsdom
/**
 * The shared "nothing upcoming" empty state (z8uq9m0hw3, item 1): Home's
 * add-guest picker and the quick-add screen both render it. "New event" shows
 * only for a role that can create one and isn't billing-blocked (#32).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { t } from '@/lib/i18n';

const nav = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), setTab: vi.fn(), openDoor: vi.fn(), canGoBack: true };
let roles: string[] = ['admin'];
let blocked = false;

vi.mock('@/features/po/hooks', () => ({ useBillingBlocked: () => ({ blocked }) }));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles }) }));
vi.mock('@/components/po/context', () => ({ useNav: () => nav }));

import { NoUpcomingEvents } from './no-upcoming-events';

beforeEach(() => {
  roles = ['admin'];
  blocked = false;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('NoUpcomingEvents', () => {
  it('lets an admin start a new event, running onNewEvent first', () => {
    const order: string[] = [];
    nav.push.mockImplementation(() => order.push('push'));
    render(<NoUpcomingEvents text="Nothing coming up." onNewEvent={() => order.push('close')} />);

    expect(screen.getByText('Nothing coming up.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: t.events.newEvent }));
    expect(nav.push).toHaveBeenCalledWith('eventedit', { isNew: true });
    expect(order).toEqual(['close', 'push']);
  });

  it('shows only the text to roles that cannot create events', () => {
    roles = ['staff'];
    render(<NoUpcomingEvents text="Nothing coming up." />);
    expect(screen.getByText('Nothing coming up.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.events.newEvent })).not.toBeInTheDocument();
  });

  it('hides the button while billing blocks new events', () => {
    blocked = true;
    render(<NoUpcomingEvents text="Nothing coming up." />);
    expect(screen.queryByRole('button', { name: t.events.newEvent })).not.toBeInTheDocument();
  });
});
