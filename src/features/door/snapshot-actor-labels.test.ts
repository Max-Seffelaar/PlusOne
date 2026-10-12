/**
 * The door snapshot's "added by" / "checked in by" labels follow the one
 * who-did-what rule (spec #64a): they come from venue_actor_names for the
 * event's venue, so a doorhost who has since left is still named and a PlusOne
 * operator reads "PlusOne support" — never an RLS user_profiles read, which
 * hid both.
 */
import { describe, it, expect, vi } from 'vitest';
import { fetchDoorSnapshot, mergeDoorProfiles, type DoorSnapshot } from './queries';
import { buildDoorView } from './model';

const tables: Record<string, unknown[]> = {
  events: [{ id: 'e1', name: 'Launch', status: 'open', list_locked: false, allow_uncheck: null, venue_id: 'v1', location_name: null, location_address: null }],
  venues: [{ name: 'Club', allow_uncheck: true, address_line: null, postal_code: null, city: null }],
  guests: [
    { id: 'g1', event_id: 'e1', full_name: 'A', phone: null, plus_ones: 0, tier_id: 't1', status: 'checked_in', note: null, note_priority: 'none', note_acknowledged_at: null, note_acknowledged_by: null, added_by: 'u-former', created_at: '2026-10-01T00:00:00Z' },
    { id: 'g2', event_id: 'e1', full_name: 'B', phone: null, plus_ones: 0, tier_id: 't1', status: 'approved', note: null, note_priority: 'none', note_acknowledged_at: null, note_acknowledged_by: null, added_by: null, created_at: '2026-10-01T00:00:00Z' },
  ],
  guest_tiers: [{ id: 't1', event_id: 'e1', name: 'Regular', color: null }],
  check_ins: [{ id: 'c1', guest_id: 'g1', event_id: 'e1', checked_by: 'u-op', checked_at: '2026-10-10T21:00:00Z', voided_at: null, plus_ones_arrived: 0 }],
  refusals: [],
};

function fakeClient(opts: { labelsFail?: boolean } = {}) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const fromTables: string[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'u-me' } } }) },
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === 'can_uncheck_check_in') return Promise.resolve({ data: true, error: null });
      if (name === 'venue_actor_names') {
        if (opts.labelsFail) return Promise.resolve({ data: null, error: { code: '57014', message: 'timeout' } });
        const rows = [
          { user_id: 'u-former', display_name: 'Former Floor', is_support: false },
          { user_id: 'u-op', display_name: null, is_support: true },
          { user_id: 'u-me', display_name: 'Me Myself', is_support: false },
        ].filter((r) => (args.p_ids as string[]).includes(r.user_id));
        return Promise.resolve({ data: rows, error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    }),
    from: vi.fn((table: string) => {
      fromTables.push(table);
      const result = { data: tables[table] ?? [], error: null };
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'order', 'range']) chain[m] = vi.fn(() => chain);
      chain.single = vi.fn(() => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null }));
      chain.maybeSingle = chain.single;
      chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
      return chain;
    }),
  };
  return { client: client as never, rpcCalls, fromTables };
}

describe('door snapshot actor labels (#64a)', () => {
  it('labels adders and checkers via venue_actor_names for the event venue', async () => {
    const { client, rpcCalls, fromTables } = fakeClient();
    const snap = await fetchDoorSnapshot(client, 'e1');

    const lookup = rpcCalls.filter((c) => c.name === 'venue_actor_names');
    expect(lookup).toHaveLength(1);
    expect(lookup[0]!.args.p_venue_id).toBe('v1');
    expect([...(lookup[0]!.args.p_ids as string[])].sort()).toEqual(['u-former', 'u-me', 'u-op']);
    expect(fromTables).not.toContain('user_profiles');

    expect(snap.profiles).toEqual({
      'u-former': 'Former Floor',
      'u-op': 'PlusOne support',
      'u-me': 'Me Myself',
    });
    // The kind rides along (review #466 r3): the door renders support typed.
    expect(snap.profileKinds).toEqual({ 'u-former': 'member', 'u-op': 'support', 'u-me': 'member' });
    const view = buildDoorView(snap);
    const g1 = [...view.guests, ...view.refused].find((g) => g.id === 'g1')!;
    expect(g1.addedByKind).toBe('member');
    expect(g1.inByKind).toBe('support');
    const g2 = [...view.guests, ...view.refused].find((g) => g.id === 'g2')!;
    expect(g2.addedByKind).toBe('system'); // request-link guest: no adder
  });

  it('still loads the door when the label RPC fails (door speed, #25): no labels, no throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client, fromTables } = fakeClient({ labelsFail: true });
    const snap = await fetchDoorSnapshot(client, 'e1');
    expect(snap.guests).toHaveLength(2);
    expect(snap.checkIns).toHaveLength(1);
    expect(snap.profiles).toEqual({});
    // Never a widened fallback read.
    expect(fromTables).not.toContain('user_profiles');
    warn.mockRestore();
  });
});

describe('mergeDoorProfiles (#466 N3): a label-less refetch keeps the names the door had', () => {
  const snap = (eventId: string, profiles: Record<string, string>): DoorSnapshot =>
    ({ event: { id: eventId }, guests: [], tiers: [], checkIns: [], refusals: [], profiles, fetchedAt: 'x' }) as unknown as DoorSnapshot;

  it('keeps the previous labels when the new snapshot has none (label RPC down)', () => {
    const prev = snap('e1', { 'u-former': 'Former Floor', 'u-op': 'PlusOne support' });
    const next = snap('e1', {});
    expect(mergeDoorProfiles(prev, next).profiles).toEqual({ 'u-former': 'Former Floor', 'u-op': 'PlusOne support' });
  });

  it('new labels win, missing ones are kept, nothing else changes', () => {
    const prev = snap('e1', { a: 'Old A', b: 'Kept B' });
    const next = snap('e1', { a: 'New A', c: 'New C' });
    const merged = mergeDoorProfiles(prev, next);
    expect(merged.profiles).toEqual({ a: 'New A', b: 'Kept B', c: 'New C' });
    expect(merged.guests).toBe(next.guests);
    expect(merged.fetchedAt).toBe(next.fetchedAt);
  });

  it('keeps the kinds alongside the labels', () => {
    const prev = { ...snap('e1', { a: 'PlusOne support' }), profileKinds: { a: 'support' as const } };
    const next = snap('e1', {});
    expect(mergeDoorProfiles(prev, next).profileKinds).toEqual({ a: 'support' });
  });

  it('never carries labels across events, and is a no-op without a previous snapshot', () => {
    const next = snap('e2', {});
    expect(mergeDoorProfiles(snap('e1', { a: 'A' }), next)).toBe(next);
    expect(mergeDoorProfiles(undefined, next)).toBe(next);
  });
});
