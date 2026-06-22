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

describe('flattenCheckInItems — sections', () => {
  const guests = [
    dg({ id: 'w1', name: 'Wendy Waiting' }), // onderweg
    dg({ id: 'w2', name: 'Wim Wachtend' }), // onderweg
    dg({ id: 'p1', name: 'Piet Partial', plus: 3, inside: true, arrived: 1 }), // deels binnen
    dg({ id: 'f1', name: 'Fenna Full', plus: 0, inside: true, arrived: 0 }), // helemaal binnen
    dg({ id: 'f2', name: 'Floris Full', plus: 2, inside: true, arrived: 2 }), // helemaal binnen
  ];
  const refused = [dg({ id: 'r1', name: 'Rico Refused', refused: true, refusedReason: 'Lijst vol' })];

  it('orders sections Onderweg → DEELS BINNEN → AL BINNEN → GEWEIGERD under Beide', () => {
    const { items } = flattenCheckInItems(guests, refused, 'both', '');
    expect(headers(items)).toEqual(['DEELS BINNEN · 1', 'AL BINNEN · 2', 'GEWEIGERD · 1']);
    // Waiting rows come first (no header), then each section after its divider.
    expect(guestNames(items).slice(0, 2)).toEqual(['Wendy Waiting', 'Wim Wachtend']);
  });

  it('only shows a header when its section is non-empty', () => {
    const onlyWaiting = [dg({ id: 'w1', name: 'Solo' })];
    const { items } = flattenCheckInItems(onlyWaiting, [], 'both', '');
    expect(headers(items)).toEqual([]); // no partial/full/refused → no dividers
    expect(guestNames(items)).toEqual(['Solo']);
  });

  it('filter=wait hides AL BINNEN and GEWEIGERD but keeps DEELS BINNEN', () => {
    const { items, visibleCount } = flattenCheckInItems(guests, refused, 'wait', '');
    expect(headers(items)).toEqual(['DEELS BINNEN · 1']);
    // waiting (2) + partial (1)
    expect(visibleCount).toBe(3);
  });

  it('filter=in hides Onderweg, shows AL BINNEN + DEELS BINNEN + GEWEIGERD', () => {
    const { items, visibleCount } = flattenCheckInItems(guests, refused, 'in', '');
    expect(guestNames(items)).not.toContain('Wendy Waiting');
    expect(headers(items)).toEqual(['DEELS BINNEN · 1', 'AL BINNEN · 2', 'GEWEIGERD · 1']);
    // partial (1) + fullyIn (2)
    expect(visibleCount).toBe(3);
  });

  it('a search term narrows to the right items and surfaces refused on any filter', () => {
    const { items, matchedCount, showRefused } = flattenCheckInItems(guests, refused, 'wait', 'rico');
    expect(showRefused).toBe(true); // refused shows under a query even with filter=wait
    expect(guestNames(items)).toEqual([]); // no active guest matches "rico"
    expect(items.some((i) => i.type === 'refused')).toBe(true);
    expect(matchedCount).toBe(1);
  });
});

describe('flattenCheckInItems — 1500 guests', () => {
  // ~1500 realistic mix: 900 onderweg, 300 deels binnen, 300 helemaal binnen.
  const guests: DoorGuest[] = [];
  for (let i = 0; i < 900; i++) guests.push(dg({ id: `w${i}`, name: `Wachtend Persoon ${i}` }));
  for (let i = 0; i < 299; i++)
    guests.push(dg({ id: `p${i}`, name: `Partial Persoon ${i}`, plus: 4, inside: true, arrived: 1 }));
  // One uniquely-named guest in the DEELS BINNEN section so a search lands on
  // exactly one row (the fuzzy subsequence match would otherwise also catch
  // "…42" inside "…142"/"…242").
  guests.push(dg({ id: 'pUniq', name: 'Zélda Quintano', plus: 4, inside: true, arrived: 1 }));
  for (let i = 0; i < 300; i++)
    guests.push(dg({ id: `f${i}`, name: `Full Persoon ${i}`, plus: 0, inside: true, arrived: 0 }));
  const refused = [dg({ id: 'r', name: 'Refused Person', refused: true })];

  it('produces correct section counts + dividers across 1500 guests', () => {
    const { items, visibleCount } = flattenCheckInItems(guests, refused, 'both', '');
    expect(headers(items)).toEqual(['DEELS BINNEN · 300', 'AL BINNEN · 300', 'GEWEIGERD · 1']);
    // 900 waiting + 300 partial + 300 full = 1500 guest rows (refused not counted).
    expect(visibleCount).toBe(1500);
    expect(guestNames(items)).toHaveLength(1500);
    // 1500 guests + 1 refused + 3 headers = 1504 total items.
    expect(items).toHaveLength(1504);
  });

  it('a specific search term narrows the 1500 down to the matching guest', () => {
    const { items, matchedCount } = flattenCheckInItems(guests, refused, 'both', 'zelda quintano');
    const names = guestNames(items);
    expect(names).toEqual(['Zélda Quintano']);
    expect(matchedCount).toBe(1);
    // Header for the one non-empty section it lands in (DEELS BINNEN).
    expect(headers(items)).toEqual(['DEELS BINNEN · 1']);
  });
});
