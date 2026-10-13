/**
 * fetchGuestRequests (Snelheid P2, perf audit finding 5): the "via" labels come
 * from the venue-scoped links list, never a `request_links.in('id', …)` id list
 * (that 414'd past ~205 events with requests). One ranged, venue-scoped read in
 * server order; the history is not windowed (an open product decision, review
 * #486), and no links read happens when no row references a link.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchGuestRequests, type PoLinkOption } from './queries';

type Call = [string, ...unknown[]];

function row(id: string, status: string, request_link_id: string | null) {
  return {
    id, created_at: '2026-10-01T00:00:00Z', status, request_link_id,
    full_name: id, email: null, phone: null, plus_ones: 0, motivation: null, event_id: 'e1',
    decision_reason: null, decision_message: null, decided_via: status === 'approved' ? 'auto' : 'manual',
    marketing_opt_in: false,
  };
}

function makeClient(rows: unknown[]) {
  const calls: Call[] = [];
  const from = vi.fn((table: string) => {
    if (table !== 'guest_requests') throw new Error(`unexpected table read: ${table}`);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'or', 'order']) {
      chain[m] = vi.fn((...args: unknown[]) => {
        calls.push([m, ...args]);
        return chain;
      });
    }
    chain.in = vi.fn(() => {
      throw new Error('fetchGuestRequests must not send an .in() id list');
    });
    chain.range = vi.fn(() => Promise.resolve({ data: rows, error: null }));
    return chain;
  });
  return { client: { from } as never, calls };
}

const LINKS: PoLinkOption[] = [
  { id: 'l-default', eventId: 'e1', isDefault: true, label: null, archived: false },
  { id: 'l-promo', eventId: 'e1', isDefault: false, label: 'Jayden Promo', archived: false },
  { id: 'l-old', eventId: 'e1', isDefault: false, label: 'Archived Promo', archived: true },
];

describe('fetchGuestRequests — labels without id lists', () => {
  it('labels from the links list (archived links too), default flagged, unknown silent, server order kept', async () => {
    const { client, calls } = makeClient([
      row('p1', 'pending', 'l-default'),
      row('d1', 'denied', 'l-old'),
      row('p2', 'pending', 'l-promo'),
      row('a1', 'approved', 'l-gone'),
    ]);
    const links = vi.fn(async () => LINKS);
    const rows = await fetchGuestRequests(client, 'v1', { links });

    expect(links).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => r.id)).toEqual(['p1', 'd1', 'p2', 'a1']);
    expect(rows.map((r) => [r.viaLabel, r.viaStandard])).toEqual([
      [null, true],
      ['Archived Promo', false],
      ['Jayden Promo', false],
      [null, false],
    ]);
    expect(calls).toContainEqual(['eq', 'venue_id', 'v1']);
    expect(calls).toContainEqual(['is', 'anonymized_at', null]);
    expect(calls).toContainEqual(['or', 'status.in.(pending,denied),and(status.eq.approved,decided_via.eq.auto)']);
  });

  it('asks for no links when no row references one (e.g. a role that sees no requests)', async () => {
    const { client } = makeClient([row('p1', 'pending', null)]);
    const links = vi.fn(async () => LINKS);
    const rows = await fetchGuestRequests(client, 'v1', { links });
    expect(links).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ viaLabel: null, viaStandard: false });
  });
});
