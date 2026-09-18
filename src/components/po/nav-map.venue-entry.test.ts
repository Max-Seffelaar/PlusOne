/**
 * Where the venue card leads (z8uq9m0hw2): the desktop sidebar header and the
 * mobile More card both call venueEntryScreen with the member's venue count and
 * the settings capability of their roles at the ACTIVE venue.
 */
import { describe, expect, it } from 'vitest';
import type { VenueRole } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import { venueEntryScreen } from './nav-map';

const entryFor = (venueCount: number, roles: VenueRole[]) =>
  venueEntryScreen(venueCount, venueCapabilities(roles).viewSettings);

describe('venueEntryScreen', () => {
  it('opens venue settings for an admin or finance member with exactly one venue', () => {
    expect(entryFor(1, ['admin'])).toBe('venuesettings');
    expect(entryFor(1, ['admin', 'user_manager'])).toBe('venuesettings');
    expect(entryFor(1, ['finance'])).toBe('venuesettings');
  });

  it('keeps the switcher for one venue when the role cannot see venue settings', () => {
    // Venue settings would only say "no rights"; the switcher still shows the
    // venue + roles and holds "Add a new venue".
    for (const roles of [['user_manager'], ['staff'], ['doorhost'], ['doorhost', 'staff'], []] as VenueRole[][]) {
      expect(entryFor(1, roles), roles.join(',') || 'crew').toBe('venueswitch');
    }
  });

  it('keeps the switcher with more than one venue, whatever the role', () => {
    expect(entryFor(2, ['admin'])).toBe('venueswitch');
    expect(entryFor(5, ['finance'])).toBe('venueswitch');
    expect(entryFor(2, ['staff'])).toBe('venueswitch');
  });

  it('keeps the switcher with no venue list at all', () => {
    expect(entryFor(0, ['admin'])).toBe('venueswitch');
  });
});
