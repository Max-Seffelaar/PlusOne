/**
 * fetchGuestRequests (Snelheid P2, perf audit finding 5): the "via" labels come
 * from the venue-scoped links list, never a `request_links.in('id', …)` id list
 * (that 414'd past ~205 events with requests); pending requests are always all
 * loaded, the declined / auto-approved history is windowed by event start.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchGuestRequests, type PoLinkOption } from './queries';

type Call = [string, ...unknown[]];

function row(id: string, created_at: string, status: string, request_link_id: string | null, extra = {}) {
  return {
    id, created_at, status, request_link_id,
    full_name: id, email: null, phone: null, plus_ones: 0, motivation: null, event_id: 'e1',
    decision_reason: null, decision_message: null, decided_via: status === 'approved' ? 'auto' : 'manual',
    marketing_opt_in: false, ...extra,
  };
}

function makeClient(pending: unknown[], decided: unknown[]) {
  const queries: Call[][] = [];
  const from = vi.fn((table: string) => {
    if (table !== 'guest_requests') throw new Error(`unexpected table read: ${table}`);
    const calls: Call[] = [];
    queries.push(calls);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'or', 'gte', 'order']) {
      chain[m] = vi.fn((...args: unknown[]) => {
        calls.push([m, ...args]);
        return chain;
      });
    }
    chain.in = vi.fn(() => {
      throw new Error('fetchGuestRequests must not send an .in() id list');
    });
    chain.range = vi.fn(() => {
      const isPending = calls.some(([m, a, b]) => m === 'eq' && a === 'status' && b === 'pending');
      return Promise.resolve({ data: isPending ? pending : decided, error: null });
    });
    return chain;
  });
  return { client: { from } as never, queries };
}

const LINKS: PoLinkOption[] = [
  { id: 'l-default', eventId: 'e1', isDefault: true, label: null, archived: false },
  { id: 'l-promo', eventId: 'e1', isDefault: false, label: 'Jayden Promo', archived: false },
  { id: 'l-old', eventId: 'e1', isDefault: false, label: 'Archived Promo', archived: true },
];

describe('fetchGuestRequests — labels without id lists, windowed history', () => {
  it('labels from the links list (archived links too), default flagged, unknown silent, oldest first', async () => {
    const { client } = makeClient(
      [row('p2', '2026-10-03T00:00:00Z', 'pending', 'l-promo'), row('p1', '2026-10-01T00:00:00Z', 'pending', 'l-default')],
      [row('d1', '2026-10-02T00:00:00Z', 'denied', 'l-old', { events: { starts_at: 'x' } }), row('a1', '2026-10-04T00:00:00Z', 'approved', 'l-gone', { events: { starts_at: 'x' } })],
    );
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
    // The embed only feeds the window filter; it never reaches the row shape.
    expect(rows.every((r) => !('events' in r))).toBe(true);
  });

  it('windows only the declined / auto-approved history, by event start', async () => {
    const { client, queries } = makeClient([], []);
    await fetchGuestRequests(client, 'v1', { decidedSinceIso: '2026-10-05T00:00:00Z', links: async () => [] });

    const pendingQ = queries.find((c) => c.some(([m, a, b]) => m === 'eq' && a === 'status' && b === 'pending'));
    const decidedQ = queries.find((c) => c.some(([m]) => m === 'or'));
    expect(pendingQ?.some(([m]) => m === 'gte')).toBe(false);
    expect(decidedQ).toContainEqual(['gte', 'events.starts_at', '2026-10-05T00:00:00Z']);
    for (const q of queries) {
      expect(q).toContainEqual(['eq', 'venue_id', 'v1']);
      expect(q).toContainEqual(['is', 'anonymized_at', null]);
    }
  });
});
