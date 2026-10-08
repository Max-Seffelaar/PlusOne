/**
 * Deep link to an event of another company (z8uq9m2vg7): the card shows only
 * for exactly one OTHER company of the user's that owns the event. A non-member
 * (no match) and an ambiguous name both fall back to "not available", so the
 * screen never guesses and never tells a non-member the event exists.
 */
import { describe, it, expect } from 'vitest';
import { otherCompanyForEvent } from './other-company';

const VESPER = { venueId: 'v-vesper', venueName: 'Club Vesper', roles: ['admin' as const] };
const MARKT = { venueId: 'v-markt', venueName: 'De Marktzaal', roles: ['admin' as const] };

describe('otherCompanyForEvent', () => {
  it('finds the other company the user belongs to', () => {
    expect(otherCompanyForEvent({ eventVenueName: 'De Marktzaal', myVenues: [VESPER, MARKT], activeVenueId: 'v-vesper' })).toEqual(MARKT);
  });

  it('returns null for an event of the active company (a plain missing event)', () => {
    expect(otherCompanyForEvent({ eventVenueName: 'Club Vesper', myVenues: [VESPER, MARKT], activeVenueId: 'v-vesper' })).toBeNull();
  });

  it('returns null when the user is no member of the owning company, or the event was not readable', () => {
    expect(otherCompanyForEvent({ eventVenueName: 'Paradiso', myVenues: [VESPER, MARKT], activeVenueId: 'v-vesper' })).toBeNull();
    expect(otherCompanyForEvent({ eventVenueName: undefined, myVenues: [VESPER, MARKT], activeVenueId: 'v-vesper' })).toBeNull();
    expect(otherCompanyForEvent({ eventVenueName: '', myVenues: [VESPER, MARKT], activeVenueId: 'v-vesper' })).toBeNull();
  });

  it('never guesses between two other companies with the same name', () => {
    const twin = { venueId: 'v-markt-2', venueName: 'De Marktzaal', roles: ['staff' as const] };
    expect(otherCompanyForEvent({ eventVenueName: 'De Marktzaal', myVenues: [VESPER, MARKT, twin], activeVenueId: 'v-vesper' })).toBeNull();
  });
});
