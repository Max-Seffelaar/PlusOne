/**
 * The door snapshot's "added by" / "checked in by" labels follow the one
 * who-did-what rule (spec #62a): they come from venue_actor_names for the
 * event's venue, so a doorhost who has since left is still named and a PlusOne
 * operator reads "PlusOne support" — never an RLS user_profiles read, which
 * hid both.
 */
import { describe, it, expect, vi } from 'vitest';
import { fetchDoorSnapshot } from './queries';

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

function fakeClient() {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const fromTables: string[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'u-me' } } }) },
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === 'can_uncheck_check_in') return Promise.resolve({ data: true, error: null });
      if (name === 'venue_actor_names') {
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

describe('door snapshot actor labels (#62a)', () => {
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
  });
});
