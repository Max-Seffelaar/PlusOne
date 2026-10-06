// @vitest-environment jsdom
/**
 * Pinned guest list (Snelheid P1, review of PR #408). `lijst` mounts `GuestsTab`
 * straight from the URL's event id, before the venue's event list has loaded.
 * The pinned event comes from `usePoEvent(pinnedEventId)` now, so:
 *  - while that one event is still loading, "Add guest" / "Paste a list" are
 *    disabled — a fast tap must never fall through to the all-events picker;
 *  - once it has loaded, they go straight to quickadd/bulk for that event,
 *    even though the venue list (`usePoEvents`) is still empty.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  pinnedEvent: null as null | { id: string; name: string },
  push: vi.fn(),
}));

vi.mock('@/components/po/context', () => ({
  useNav: () => ({ push: H.push, back: vi.fn(), canGoBack: true }),
}));
vi.mock('../../context', () => ({
  useNav: () => ({ push: H.push, back: vi.fn(), canGoBack: true }),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

const idle = { data: undefined, isLoading: false, isError: false };
vi.mock('@/features/po/hooks', () => ({
  // The venue list has NOT loaded: the old code derived the pinned event from it.
  usePoEvents: () => ({ data: [], isLoading: true }),
  usePoEvent: () => ({ event: H.pinnedEvent, isLoading: !H.pinnedEvent, isError: false, notFound: false }),
  usePoGuests: () => ({ data: [], isLoading: false, isError: false }),
  useVenueGuests: () => idle,
  usePoTiers: () => ({ data: [] }),
  usePoQuota: () => ({ data: null }),
  usePoPermanentContacts: () => ({ data: [] }),
  usePoCanManageTemplates: () => false,
  usePoContactNameMatches: () => ({ data: undefined }),
}));
vi.mock('@/features/po/mutations', () => {
  const m = () => ({ mutate: vi.fn(), isPending: false });
  return { usePoAddGuestsBulk: m, usePoUpdateGuest: m, usePoChangeGuestsTierBulk: m, usePoMarkGuestsRegular: m };
});

const { GuestsTab } = await import('./index');

beforeEach(() => {
  H.push.mockClear();
  H.pinnedEvent = null;
});

describe('GuestsTab pinned to an event', () => {
  it('pinned + event not loaded yet → add/paste are disabled and never open the all-events picker', () => {
    render(<GuestsTab pinnedEventId="e1" />);
    // Both "Add guest" affordances (header icon + labelled button) and "Paste a list".
    const adds = screen.getAllByRole('button', { name: t.guests.list.addGuest });
    const paste = screen.getByText(t.guests.list.pasteList).closest('button')!;
    for (const b of [...adds, paste]) {
      expect((b as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(b);
    }
    expect(H.push).not.toHaveBeenCalled();
    expect(screen.queryByText(t.guests.list.allScope)).toBeNull();
  });

  it('pinned + event loaded (venue list still empty) → straight to quickadd / bulk for that event', () => {
    H.pinnedEvent = { id: 'e1', name: 'Friday' };
    render(<GuestsTab pinnedEventId="e1" />);
    fireEvent.click(screen.getByText(t.guests.list.pasteList).closest('button')!);
    expect(H.push).toHaveBeenCalledWith('bulk', { id: 'e1' });
    expect(screen.getByText(/Friday/)).toBeTruthy();
  });
});
