import { describe, expect, it } from 'vitest';
import type { DoorGuest } from '../model';
import { flattenCheckInItems, partsLeft, type CheckInItem } from './checkin-items';

function dg(partial: Partial<DoorGuest> & { id: string; name: string }): DoorGuest {
  return {
    id: partial.id,
    name: partial.name,
    plus: partial.plus ?? 0,
    tierId: partial.tierId ?? 't1',
    tierName: partial.tierName ?? 'Gast',
    tierColor: partial.tierColor ?? '#fff',
    tierIcon: partial.tierIcon ?? 'user',
    addedByName: partial.addedByName ?? 'Manager',
    addedAt: partial.addedAt ?? '1 jan',
    last4: partial.last4 ?? null,
    note: partial.note ?? null,
    notePriority: partial.notePriority ?? 'none',
    acknowledged: partial.acknowledged ?? false,
    inside: partial.inside ?? false,
    voided: partial.voided ?? false,
    pay: partial.pay ?? false,
    arrived: partial.arrived,
    refused: partial.refused ?? false,
    refusedReason: partial.refusedReason,
  };
}

const headers = (items: CheckInItem[]): string[] =>
  items.filter((i): i is Extract<CheckInItem, { type: 'header' }> => i.type === 'header').map((i) => i.label);
const guestNames = (items: CheckInItem[]): string[] =>
  items.filter((i): i is Extract<CheckInItem, { type: 'guest' }> => i.type === 'guest').map((i) => i.g.name);

describe('partsLeft', () => {
  it('is 0 while onderweg, and the remainder once (partially) inside', () => {
    expect(partsLeft(dg({ id: '1', name: 'A', plus: 3, inside: false }))).toBe(0);
    expect(partsLeft(dg({ id: '2', name: 'B', plus: 3, inside: true, arrived: 1 }))).toBe(2);
    expect(partsLeft(dg({ id: '3', name: 'C', plus: 3, inside: true, arrived: 3 }))).toBe(0);
  });
});

describe('flattenCheckInItems — one alphabetical list (feedback Joeri)', () => {
  const guests = [
    dg({ id: 'w1', name: 'Wendy Waiting' }), // onderweg
    dg({ id: 'w2', name: 'Wim Wachtend' }), // onderweg
    dg({ id: 'p1', name: 'Piet Partial', plus: 3, inside: true, arrived: 1 }), // deels binnen
    dg({ id: 'f1', name: 'Fenna Full', plus: 0, inside: true, arrived: 0 }), // helemaal binnen
    dg({ id: 'f2', name: 'Floris Full', plus: 2, inside: true, arrived: 2 }), // helemaal binnen
  ];
  const refused = [dg({ id: 'r1', name: 'Rico Refused', refused: true, refusedReason: 'Lijst vol' })];

  it('puts every active guest in ONE alphabetical list — no inside/partly dividers', () => {
    const { items, visibleCount } = flattenCheckInItems(guests, refused, 'both', '');
    // Only the REFUSED group keeps a divider; checked-in guests stay in place.
    expect(headers(items)).toEqual(['REFUSED · 1']);
    expect(guestNames(items)).toEqual([
      'Fenna Full',
      'Floris Full',
      'Piet Partial',
      'Wendy Waiting',
      'Wim Wachtend',
    ]);
    expect(visibleCount).toBe(5);
  });

  it('filter=wait keeps onderweg + partly-inside (alphabetical), hides fully-in + refused', () => {
    const { items, visibleCount } = flattenCheckInItems(guests, refused, 'wait', '');
    expect(headers(items)).toEqual([]);
    expect(guestNames(items)).toEqual(['Piet Partial', 'Wendy Waiting', 'Wim Wachtend']);
    expect(visibleCount).toBe(3);
  });

  it('filter=in shows every inside guest (full + partly) + refused', () => {
    const { items, visibleCount } = flattenCheckInItems(guests, refused, 'in', '');
    expect(guestNames(items)).toEqual(['Fenna Full', 'Floris Full', 'Piet Partial']);
    expect(headers(items)).toEqual(['REFUSED · 1']);
    expect(visibleCount).toBe(3);
  });

  it('a search term narrows active rows and surfaces refused on any filter', () => {
    const { items, matchedCount, showRefused } = flattenCheckInItems(guests, refused, 'wait', 'rico');
    expect(showRefused).toBe(true);
    expect(guestNames(items)).toEqual([]);
    expect(items.some((i) => i.type === 'refused')).toBe(true);
    expect(matchedCount).toBe(1);
  });

  it('a tier filter narrows to the selected tier(s); empty set = all', () => {
    const mixed = [
      dg({ id: 'a', name: 'Vip One', tierId: 'vip' }),
      dg({ id: 'b', name: 'Reg One', tierId: 'reg' }),
      dg({ id: 'c', name: 'Vip Two', tierId: 'vip' }),
    ];
    expect(guestNames(flattenCheckInItems(mixed, [], 'both', '', new Set()).items)).toEqual([
      'Reg One',
      'Vip One',
      'Vip Two',
    ]);
    expect(guestNames(flattenCheckInItems(mixed, [], 'both', '', new Set(['vip'])).items)).toEqual([
      'Vip One',
      'Vip Two',
    ]);
    expect(guestNames(flattenCheckInItems(mixed, [], 'both', '', new Set(['reg'])).items)).toEqual(['Reg One']);
  });
});

describe('flattenCheckInItems — 1500 guests', () => {
  const guests: DoorGuest[] = [];
  for (let i = 0; i < 900; i++) guests.push(dg({ id: `w${i}`, name: `Wachtend Persoon ${i}` }));
  for (let i = 0; i < 299; i++)
    guests.push(dg({ id: `p${i}`, name: `Partial Persoon ${i}`, plus: 4, inside: true, arrived: 1 }));
  guests.push(dg({ id: 'pUniq', name: 'Zélda Quintano', plus: 4, inside: true, arrived: 1 }));
  for (let i = 0; i < 300; i++)
    guests.push(dg({ id: `f${i}`, name: `Full Persoon ${i}`, plus: 0, inside: true, arrived: 0 }));
  const refused = [dg({ id: 'r', name: 'Refused Person', refused: true })];

  it('flattens 1500 active guests into one list + a single refused divider', () => {
    const { items, visibleCount } = flattenCheckInItems(guests, refused, 'both', '');
    expect(headers(items)).toEqual(['REFUSED · 1']);
    expect(visibleCount).toBe(1500);
    expect(guestNames(items)).toHaveLength(1500);
    // 1500 guests + 1 refused + 1 refused-divider = 1502 total items.
    expect(items).toHaveLength(1502);
  });

  it('a specific search term narrows the 1500 down to the matching guest', () => {
    const { items, matchedCount } = flattenCheckInItems(guests, refused, 'both', 'zelda quintano');
    expect(guestNames(items)).toEqual(['Zélda Quintano']);
    expect(matchedCount).toBe(1);
    expect(headers(items)).toEqual([]); // no refused match → no divider
  });
});
