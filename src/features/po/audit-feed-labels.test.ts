/**
 * Review #466 N2: when the label RPC fails, the audit feed must not relabel a
 * real person as "System". A former member or a PlusOne operator has a null
 * RLS actor_name in audit_feed, so without labels the only honest word is
 * "Unknown"; "System" stays reserved for a null actor_id.
 */
import { describe, it, expect, vi } from 'vitest';
import { fetchPoAuditFeed, fetchPoGuestHistory } from './queries';

const feedRows = [
  // A former member: RLS hides the name in the view.
  { id: 'a1', actor_id: 'u-former', actor_name: null, venue_id: 'v1', event_id: 'e1', event_name: 'Launch',
    entity_type: 'guests', entity_id: 'g1', action: 'check_in', diff: null, device_id: null,
    created_at: '2026-10-10T21:00:00Z', guest_id: 'g1', guest_name: 'Noor', subject_user_id: null,
    subject_name: null, old_tier_name: null, new_tier_name: null, request_name: null },
  // A database/system action.
  { id: 'a2', actor_id: null, actor_name: null, venue_id: 'v1', event_id: 'e1', event_name: 'Launch',
    entity_type: 'guests', entity_id: 'g1', action: 'update', diff: null, device_id: null,
    created_at: '2026-10-10T21:01:00Z', guest_id: 'g1', guest_name: 'Noor', subject_user_id: null,
    subject_name: null, old_tier_name: null, new_tier_name: null, request_name: null },
];

function client(rpcError: { code: string } | null) {
  const rpc = vi.fn(() => Promise.resolve({ data: rpcError ? null : [], error: rpcError }));
  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'or']) chain[m] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: table === 'guests' ? { id: 'g1', full_name: 'Noor', plus_ones: 0, status: 'checked_in', guest_tiers: null, events: null } : null, error: null }),
    );
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: table === 'audit_feed' ? feedRows : [], error: null }).then(res);
    return chain;
  });
  return { client: { rpc, from } as never, rpc };
}

describe('audit feed when the label RPC fails (#466 N2)', () => {
  it('fetchPoAuditFeed: a real actor reads "Unknown", only a null actor reads "System"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client: c, rpc } = client({ code: '57014' });
    const lines = await fetchPoAuditFeed(c, { venueId: 'v1' });
    expect(rpc).toHaveBeenCalled();
    expect(lines.map((l) => l.actor)).toEqual(['Unknown', 'System']);
    warn.mockRestore();
  });

  it('fetchPoGuestHistory: same rule', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { client: c } = client({ code: '57014' });
    const history = await fetchPoGuestHistory(c, 'g1');
    expect(history.lines.map((l) => l.actor)).toEqual(['Unknown', 'System']);
    warn.mockRestore();
  });
});
