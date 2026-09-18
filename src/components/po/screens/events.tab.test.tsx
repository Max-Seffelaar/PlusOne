// @vitest-environment jsdom
/**
 * Events tab (z8uq9m0hw3):
 * - item 2: the header search icon opens an inline field that filters the
 *   Upcoming / Past list by event name (client-side, the list isn't windowed).
 * - item 1: "Add guest" is role-hidden like Home's "New guest" (M9, K-7).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { t, fmt } from '@/lib/i18n';

const nav = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), setTab: vi.fn(), openDoor: vi.fn(), canGoBack: false };
let roles: string[] = ['admin'];
let organizes = false;

const ev = (id: string, name: string, when: 'upcoming' | 'past') => ({
  id,
  name,
  venue: 'Club Nova',
  time: '23:00',
  date: '18',
  mon: 'SEP',
  month: 'September 2026',
  guests: 10,
  inside: 0,
  when,
  phase: when,
  cancelled: false,
});
const EVENTS = [
  ev('e1', 'Saturday Sessions', 'upcoming'),
  ev('e2', 'FRENZY', 'upcoming'),
  ev('e3', 'Opening Night', 'past'),
];

vi.mock('@/features/po/hooks', () => ({
  usePoEvents: () => ({ data: EVENTS, isLoading: false, isError: false }),
  usePoCanManageTemplates: () => roles.includes('admin') || organizes,
  useBillingBlocked: () => ({ blocked: false }),
}));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles }) }));
vi.mock('@/components/po/context', () => ({ useNav: () => nav }));

import { Events } from './events';

beforeEach(() => {
  roles = ['admin'];
  organizes = false;
  vi.clearAllMocks();
});
afterEach(cleanup);

const openSearch = (): HTMLElement => {
  fireEvent.click(screen.getByRole('button', { name: t.events.searchOpenAria }));
  return screen.getByRole('textbox', { name: t.events.searchOpenAria });
};

describe('Events tab search (item 2)', () => {
  it('has a labelled search button that opens an inline field', () => {
    render(<Events />);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    const input = openSearch();
    expect(input).toHaveAttribute('placeholder', t.events.searchPlaceholder);
    expect(screen.getByRole('button', { name: t.events.searchCloseAria })).toBeInTheDocument();
  });

  it('filters the current tab by event name, case-insensitively', () => {
    render(<Events />);
    fireEvent.change(openSearch(), { target: { value: 'frenz' } });
    expect(screen.getByText('FRENZY')).toBeInTheDocument();
    expect(screen.queryByText('Saturday Sessions')).not.toBeInTheDocument();
    // Past events stay on their own tab.
    expect(screen.queryByText('Opening Night')).not.toBeInTheDocument();
  });

  it('searches the Past tab too', () => {
    render(<Events />);
    fireEvent.click(screen.getByRole('button', { name: t.events.tabPast }));
    fireEvent.change(openSearch(), { target: { value: 'opening' } });
    expect(screen.getByText('Opening Night')).toBeInTheDocument();
  });

  it('says so when nothing matches', () => {
    render(<Events />);
    fireEvent.change(openSearch(), { target: { value: 'zzz' } });
    expect(screen.getByText(fmt(t.events.searchEmpty, { q: 'zzz' }))).toBeInTheDocument();
  });

  it('closing (button or Escape) clears the filter', () => {
    render(<Events />);
    fireEvent.change(openSearch(), { target: { value: 'frenz' } });
    fireEvent.click(screen.getByRole('button', { name: t.events.searchCloseAria }));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Saturday Sessions')).toBeInTheDocument();

    const input = openSearch();
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'frenz' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Saturday Sessions')).toBeInTheDocument();
  });
});

describe('Events tab Add guest (item 1)', () => {
  it('shows for roles that write guests', () => {
    for (const r of [['admin'], ['staff'], ['doorhost']]) {
      roles = r;
      render(<Events />);
      expect(screen.getByRole('button', { name: t.events.addGuest })).toBeInTheDocument();
      cleanup();
    }
  });

  it('shows for an external organizer (no venue role)', () => {
    roles = [];
    organizes = true;
    render(<Events />);
    expect(screen.getByRole('button', { name: t.events.addGuest })).toBeInTheDocument();
  });

  it('is hidden for roles that cannot add guests', () => {
    for (const r of [['finance'], ['user_manager']]) {
      roles = r;
      render(<Events />);
      expect(screen.queryByRole('button', { name: t.events.addGuest })).not.toBeInTheDocument();
      cleanup();
    }
  });
});
