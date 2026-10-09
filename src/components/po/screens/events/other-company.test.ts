/**
 * Deep link to an event of another company (z8uq9m2vg7): the card shows only
 * when the event's company (by id, from the RLS-scoped event read) is one of the
 * user's own, non-active companies. A non-member — or an unreadable event —
 * falls back to "not available", so the screen never tells a non-member the
 * event exists.
 */
import { describe, it, expect } from 'vitest';
import { otherCompanyForEvent } from './other-company';

const VESPER = { venueId: 'v-vesper', venueName: 'Club Vesper', roles: ['admin' as const] };
const MARKT = { venueId: 'v-markt', venueName: 'De Marktzaal', roles: ['admin' as const] };

describe('otherCompanyForEvent', () => {
  it('finds the other company the user belongs to', () => {
    expect(otherCompanyForEvent({ eventVenueId: 'v-markt', myVenues: [VESPER, MARKT], activeVenueId: 'v-vesper' })).toEqual(MARKT);
  });

  it('returns null for an event of the active company (a plain missing event)', () => {
    expect(otherCompanyForEvent({ eventVenueId: 'v-vesper', myVenues: [VESPER, MARKT], activeVenueId: 'v-vesper' })).toBeNull();
  });

  it('returns null when the user is no member of the owning company, or the event was not readable', () => {
    expect(otherCompanyForEvent({ eventVenueId: 'v-paradiso', myVenues: [VESPER, MARKT], activeVenueId: 'v-vesper' })).toBeNull();
    expect(otherCompanyForEvent({ eventVenueId: undefined, myVenues: [VESPER, MARKT], activeVenueId: 'v-vesper' })).toBeNull();
    expect(otherCompanyForEvent({ eventVenueId: '', myVenues: [VESPER, MARKT], activeVenueId: 'v-vesper' })).toBeNull();
  });

  it('picks the right company by id when two of the user\'s companies share a name', () => {
    const twin = { venueId: 'v-markt-2', venueName: 'De Marktzaal', roles: ['staff' as const] };
    expect(otherCompanyForEvent({ eventVenueId: 'v-markt-2', myVenues: [VESPER, MARKT, twin], activeVenueId: 'v-vesper' })).toEqual(twin);
    expect(otherCompanyForEvent({ eventVenueId: 'v-markt', myVenues: [VESPER, MARKT, twin], activeVenueId: 'v-vesper' })).toEqual(MARKT);
  });

  it('a same-named company the user is NOT in never matches (no leak through a name)', () => {
    expect(otherCompanyForEvent({ eventVenueId: 'v-other-vesper', myVenues: [VESPER, MARKT], activeVenueId: 'v-markt' })).toBeNull();
  });
});
