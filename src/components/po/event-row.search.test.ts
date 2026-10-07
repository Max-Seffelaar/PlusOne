import { describe, expect, it } from 'vitest';
import { matchesBoardQuery } from './event-row';

// Home search (z8uq9m2vqc review): the card shows `location.label`, so the
// search must find an event by the place it shows, not only name + company.
describe('matchesBoardQuery', () => {
  const offsite = {
    name: 'Offsite',
    venue: 'Club Vesper',
    location: { name: 'Paradiso', address: 'Weteringschans 6', label: 'Paradiso', own: true },
  };
  const home = {
    name: 'Home night',
    venue: 'Club Vesper',
    location: { name: 'Club Vesper', address: 'Wibautstraat 150, 1091 GR Amsterdam', label: 'Wibautstraat 150, 1091 GR Amsterdam', own: false },
  };

  it('finds an event by its own location', () => {
    expect(matchesBoardQuery(offsite, 'paradiso')).toBe(true);
    expect(matchesBoardQuery(home, 'paradiso')).toBe(false);
  });

  it('finds an event by the company address it falls back to', () => {
    expect(matchesBoardQuery(home, 'wibautstraat')).toBe(true);
  });

  it('still matches name and company, and an empty query matches all', () => {
    expect(matchesBoardQuery(offsite, 'offsite')).toBe(true);
    expect(matchesBoardQuery(offsite, 'vesper')).toBe(true);
    expect(matchesBoardQuery(offsite, '')).toBe(true);
  });
});
