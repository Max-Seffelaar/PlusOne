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

  it('patches only the fields the payload carries and keeps the rest', () => {
    const prev = [g('a', { note: 'keep', addedByName: 'Max' } as Partial<Guest>), g('b')];
    const { next, needsRefetch } = patchGuestsFromRow(prev, { id: 'a', status: 'refused', note_priority: 'high' }, tiers);
    expect(needsRefetch).toBe(false);
    expect(next?.[0]).toMatchObject({ status: 'refused', flag: 'high', note: 'keep', addedByName: 'Max' });
    expect(next?.[1]).toBe(prev[1]);
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

  it('leaves an uncached map alone', () => {
    expect(patchArrivalsFromCheckIn(undefined, row('c1', false))).toBeUndefined();
  });
});
