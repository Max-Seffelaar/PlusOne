// @vitest-environment jsdom
/**
 * Venue switcher "Manage" (z8uq9m0hw2): it opens venue settings, which only
 * admin and finance may see. Every other role must not get the button, or they
 * land on a "no rights" page. Other venues keep their "Switch" button.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { VenueRole } from '@/features/auth/roles';
import { t } from '@/lib/i18n';

const A = '018f3a2e-0000-7000-8000-00000000000a';
const B = '018f3a2e-0000-7000-8000-00000000000b';

const H = vi.hoisted(() => ({
  push: vi.fn(),
  myVenues: [] as { venueId: string; venueName: string; roles: VenueRole[] }[],
}));

vi.mock('../../context', () => ({
  useNav: () => ({ push: H.push, back: vi.fn() }),
  usePo: () => ({ myVenues: H.myVenues, activeVenueId: A, switchToVenue: vi.fn() }),
}));
vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ roles: [], venueName: 'Venue A' }),
  usePoIdentityOptional: () => null,
}));
vi.mock('@/features/po/hooks', () => ({ usePoVenueSettings: () => ({ data: null }) }));
vi.mock('@/features/po/mutations', () => ({ usePoUpdateVenueSettings: () => ({}) }));

const { VenueSwitch } = await import('./venue');

afterEach(() => {
  cleanup();
  H.push.mockClear();
});

function renderWith(roles: VenueRole[], second?: VenueRole[]) {
  H.myVenues = [
    { venueId: A, venueName: 'Venue A', roles },
    ...(second ? [{ venueId: B, venueName: 'Venue B', roles: second }] : []),
  ];
  return render(<VenueSwitch />);
}

describe('VenueSwitch "Manage"', () => {
  it.each([[['admin']], [['finance']], [['admin', 'user_manager']]] as VenueRole[][][])(
    'shows Manage on the current venue for %j and opens venue settings',
    (roles) => {
      renderWith(roles);
      fireEvent.click(screen.getByRole('button', { name: new RegExp(t.settings.venueSwitch.manage) }));
      expect(H.push).toHaveBeenCalledWith('venuesettings', { id: A });
    },
  );

  it.each([[['staff']], [['doorhost']], [['doorhost', 'staff']], [['user_manager']], [[]]] as VenueRole[][][])(
    'hides Manage for %j (no venue settings access)',
    (roles) => {
      renderWith(roles);
      expect(screen.queryByRole('button', { name: new RegExp(t.settings.venueSwitch.manage) })).toBeNull();
      // "Add a new venue" stays reachable.
      expect(screen.getByRole('button', { name: new RegExp(t.settings.venueSwitch.addVenue) })).toBeInTheDocument();
    },
  );

  it('keeps Switch on the other venues when Manage is hidden', () => {
    renderWith(['staff'], ['staff']);
    expect(screen.queryByRole('button', { name: new RegExp(t.settings.venueSwitch.manage) })).toBeNull();
    expect(screen.getByRole('button', { name: new RegExp(t.settings.venueSwitch.switch) })).toBeInTheDocument();
  });
});
