import { describe, expect, it } from 'vitest';
import type { Guest, Tier } from '@/lib/po/types';
import { patchArrivalsFromCheckIn, patchGuestsFromRow } from './realtime-patch';

const g = (id: string, over: Partial<Guest> = {}): Guest =>
  ({ id, name: id, role: 'Guest', tierId: 't1', plus: 0, note: '', flag: null, status: 'wait', ...over }) as Guest;
const tiers = [{ id: 't1', name: 'Regular', color: '#888' }] as Tier[];

describe('patchGuestsFromRow', () => {
  it('does nothing (and asks nothing) when the list is not cached', () => {
    expect(patchGuestsFromRow(undefined, { id: 'x', status: 'approved' }, tiers)).toEqual({ next: undefined, needsRefetch: false });
  });

  const full = (id: string, over: Record<string, unknown> = {}) => ({
    id, full_name: id, plus_ones: 0, status: 'approved', tier_id: 't1', note: null, note_priority: 'none',
    note_acknowledged_at: null, created_at: '2026-10-12T20:00:00Z', contact_id: null, anonymized_at: null,
    source: 'app', ...over,
  }) as never;

  it('rebuilds the row through toPoGuest from the full payload, keeping the cached provenance', () => {
    const prev = [g('a', { addedByName: 'Max', at: '22:10' } as Partial<Guest>), g('b')];
    const { next, needsRefetch } = patchGuestsFromRow(prev, full('a', { status: 'refused', note: 'VIP', note_priority: 'high' }), tiers);
    expect(needsRefetch).toBe(false);
    expect(next?.[0]).toMatchObject({ status: 'refused', flag: 'high', note: 'VIP', addedByName: 'Max', tierName: 'Regular' });
    // A leftover optimistic field (the 'HH:MM' `at`) does not survive: the adapter never sets it.
    expect(next?.[0]).not.toHaveProperty('at', '22:10');
    expect(next?.[1]).toBe(prev[1]);
  });

  it('a partial payload asks for a refetch instead of half-patching', () => {
    const prev = [g('a')];
    expect(patchGuestsFromRow(prev, { id: 'a', status: 'refused' }, tiers)).toEqual({ next: prev, needsRefetch: true });
  });

  it('pending and denied leave the list like removed does; an unseen listed row needs a refetch', () => {
    const prev = [g('a'), g('b')];
    expect(patchGuestsFromRow(prev, { id: 'a', status: 'pending' }, tiers).next?.map((x) => x.id)).toEqual(['b']);
    expect(patchGuestsFromRow(prev, { id: 'zz', status: 'denied' }, tiers)).toEqual({ next: prev, needsRefetch: false });
    expect(patchGuestsFromRow(prev, { id: 'zz', status: 'approved' }, tiers).needsRefetch).toBe(true);
  });
});

describe('patchArrivalsFromCheckIn', () => {
  const row = (id: string, voided: boolean) => ({
    id, guest_id: 'a', plus_ones_arrived: 2, checked_at: '2026-10-12T22:00:00Z', voided_at: voided ? '2026-10-12T23:00:00Z' : null,
  });

  it('sets an active check-in and clears it on its own void', () => {
    const set = patchArrivalsFromCheckIn(new Map(), row('c1', false));
    expect(set?.get('a')).toEqual({ arrived: 2, at: '2026-10-12T22:00:00Z', id: 'c1' });
    expect(patchArrivalsFromCheckIn(set, row('c1', true))?.has('a')).toBe(false);
  });

  it('a void of a different check-in never erases the one the cache holds', () => {
    const set = patchArrivalsFromCheckIn(new Map(), row('c2', false));
    expect(patchArrivalsFromCheckIn(set, row('c1', true))?.get('a')?.id).toBe('c2');
  });

  it('a void never clears an optimistic arrival (no id yet)', () => {
    const optimistic = new Map([['a', { arrived: 0, at: '2026-10-12T22:00:00Z' }]]);
    expect(patchArrivalsFromCheckIn(optimistic, row('c1', true))?.get('a')).toEqual({ arrived: 0, at: '2026-10-12T22:00:00Z' });
  });

  it('leaves an uncached map alone', () => {
    expect(patchArrivalsFromCheckIn(undefined, row('c1', false))).toBeUndefined();
  });
});
