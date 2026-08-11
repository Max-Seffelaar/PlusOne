import { describe, expect, it, vi } from 'vitest';
import {
  fetchEventCrew,
  fetchEventQuota,
  fetchEvents,
  fetchOrganizerEventIds,
  fetchOrganizesAtVenue,
  fetchOwnSessions,
  fetchRequestLinks,
  fetchTiersWithUsage,
  fetchVenueGuestsWindow,
  fetchVenueRequestLinks,
  fetchVenueSettings,
  VENUE_GUESTS_WINDOW,
} from './queries';

// Regression coverage for 86ey9e8e7 (adversarial QU1/QU5): ~23 fetchers used to
// destructure only `{ data }`, discarding the PostgREST/RPC `error` — a real
// DB/network/RLS outage rendered as a plausible empty result instead of
// reaching React Query's isError branch. Mirrors the C25 precedent
// (src/features/stats/data.test.ts) — one rejects-on-error case per query
// shape used across the fixed fetchers, not exhaustive per-function coverage.

function plain(data: unknown, error: unknown = null) {
  return Promise.resolve({ data, error });
}

function single(data: unknown, error: unknown = null) {
  return { maybeSingle: () => Promise.resolve({ data, error }) };
}

describe('fetchEvents (86ey9e8e7)', () => {
  it('rejects when the select errors, rather than rendering "no events yet"', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => plain(null, { message: 'boom' })),
          })),
        })),
      })),
    } as never;

    await expect(fetchEvents(client, 'venue-1')).rejects.toThrow();
  });
});

describe('fetchVenueSettings (86ey9e8e7)', () => {
  it('rejects when the maybeSingle read errors, rather than returning null', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => single(null, { message: 'boom' })),
        })),
      })),
    } as never;

    await expect(fetchVenueSettings(client, 'venue-1')).rejects.toThrow();
  });
});

describe('fetchEventQuota (86ey9e8e7)', () => {
  it('rejects when the RPC errors, rather than returning null (looks like "no quota set")', async () => {
    const client = {
      rpc: vi.fn(() => single(null, { message: 'boom' })),
    } as never;

    await expect(fetchEventQuota(client, 'event-1')).rejects.toThrow();
  });
});

describe('fetchOwnSessions (86ey9e8e7)', () => {
  it('rejects when the RPC errors, rather than rendering "no active sessions"', async () => {
    const client = {
      rpc: vi.fn(() => plain(null, { message: 'boom' })),
    } as never;

    await expect(fetchOwnSessions(client)).rejects.toThrow();
  });
});

describe('fetchEventCrew (86ey9e8e7)', () => {
  it('rejects when either half of the Promise.all errors', async () => {
    const client = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({
          eq: vi.fn(() =>
            table === 'event_quotas' ? plain(null, { message: 'boom' }) : plain([])
          ),
        })),
      })),
    } as never;

    await expect(fetchEventCrew(client, 'event-1')).rejects.toThrow();
  });
});

describe('fetchOrganizesAtVenue (86ey9e8e7)', () => {
  it('rejects on a count-query error, rather than silently deciding "not an organizer"', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ count: null, error: { message: 'boom' } })),
          })),
        })),
      })),
    } as never;

    await expect(fetchOrganizesAtVenue(client, 'venue-1', 'user-1')).rejects.toThrow();
  });
});

describe('fetchOrganizerEventIds (86ey9tkav)', () => {
  it('rejects on a read error, rather than silently deciding "organizes nothing"', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
          })),
        })),
      })),
    } as never;

    await expect(fetchOrganizerEventIds(client, 'venue-1', 'user-1')).rejects.toThrow();
  });

  it('returns the set of event ids the caller organizes at this venue', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() =>
              Promise.resolve({
                data: [{ event_id: 'event-1' }, { event_id: 'event-2' }],
                error: null,
              })
            ),
          })),
        })),
      })),
    } as never;

    const result = await fetchOrganizerEventIds(client, 'venue-1', 'user-1');
    expect(result).toEqual(new Set(['event-1', 'event-2']));
  });

  it('returns an empty set without querying when userId or venueId is missing', async () => {
    const client = { from: vi.fn() } as never;

    await expect(fetchOrganizerEventIds(client, '', 'user-1')).resolves.toEqual(new Set());
    await expect(fetchOrganizerEventIds(client, 'venue-1', '')).resolves.toEqual(new Set());
    expect((client as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });
});

// ── fetchVenueGuestsWindow (86ey9e8hz) ───────────────────────────────────────
// The venue-wide Guests tab is a server-windowed working set: one bounded page
// (newest-first), name search pushed down as `ilike`, tier from the embed, and a
// `count` that backs the "of N" subtitle. Builds a chainable mock that records the
// query it was handed, since the whole point is that it never pages the venue.

interface WindowCapture {
  select?: string;
  opts?: unknown;
  range?: [number, number];
  ilike?: { col: string; pat: string };
}

interface Terminal {
  ilike: (col: string, pat: string) => Promise<unknown>;
  then: (resolve: (v: unknown) => unknown) => Promise<unknown>;
}
interface Chain {
  select: (select: string, opts: unknown) => Chain;
  eq: () => Chain;
  in: () => Chain;
  order: () => Chain;
  range: (from: number, to: number) => Terminal;
}

function makeVenueGuestsClient(result: unknown, capture: WindowCapture) {
  // The object returned by `.range()` is BOTH awaited directly (no search) AND
  // extended with `.ilike()` (search) — so it is a thenable that also has ilike.
  const terminal: Terminal = {
    ilike: vi.fn((col: string, pat: string) => {
      capture.ilike = { col, pat };
      return Promise.resolve(result);
    }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  };
  const chain: Chain = {
    select: vi.fn((select: string, opts: unknown) => {
      capture.select = select;
      capture.opts = opts;
      return chain;
    }),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn((from: number, to: number) => {
      capture.range = [from, to];
      return terminal;
    }),
  };
  return { from: vi.fn(() => chain) } as never;
}

describe('fetchVenueGuestsWindow (86ey9e8hz)', () => {
  it('rejects when the windowed select errors, rather than rendering "no guests"', async () => {
    const capture: WindowCapture = {};
    const client = makeVenueGuestsClient({ data: null, error: { message: 'boom' }, count: null }, capture);
    await expect(fetchVenueGuestsWindow(client, { venueId: 'venue-1' })).rejects.toThrow();
  });

  it('asks for ONE bounded page + exact count, flattens the tier embed, and maps count → total', async () => {
    const capture: WindowCapture = {};
    const client = makeVenueGuestsClient(
      {
        data: [
          {
            id: 'g1',
            full_name: 'Ada',
            plus_ones: 0,
            status: 'approved',
            tier_id: 't1',
            note: null,
            note_priority: null,
            note_acknowledged_at: null,
            created_at: '2026-07-14T00:00:00Z',
            contact_id: null,
            event_id: 'e1',
            guest_tiers: { name: 'VIP', color: '#fff' },
          },
        ],
        error: null,
        count: 4200,
      },
      capture,
    );

    const { rows, total } = await fetchVenueGuestsWindow(client, { venueId: 'venue-1' });

    expect(capture.opts).toEqual({ count: 'exact' });
    expect(capture.range).toEqual([0, VENUE_GUESTS_WINDOW - 1]); // one page, never fetchAllRanged
    expect(capture.ilike).toBeUndefined(); // no search term → no filter
    expect(total).toBe(4200); // the count, not the page length
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'g1', event_id: 'e1', tierName: 'VIP', tierColor: '#fff' });
    // The raw embed is folded away, not leaked onto the row.
    expect('guest_tiers' in rows[0]).toBe(false);
  });

  it('pushes the search term down as an ilike on full_name (not a client filter)', async () => {
    const capture: WindowCapture = {};
    const client = makeVenueGuestsClient({ data: [], error: null, count: 0 }, capture);

    await fetchVenueGuestsWindow(client, { venueId: 'venue-1', search: '  Bob  ' });

    expect(capture.ilike).toEqual({ col: 'full_name', pat: '%Bob%' });
  });

  it('handles the to-many embed shape (array) and a null count', async () => {
    const capture: WindowCapture = {};
    const client = makeVenueGuestsClient(
      {
        data: [
          {
            id: 'g2',
            full_name: 'Grace',
            plus_ones: 2,
            status: 'checked_in',
            tier_id: 't2',
            note: null,
            note_priority: null,
            note_acknowledged_at: null,
            created_at: '2026-07-13T00:00:00Z',
            contact_id: 'c2',
            event_id: 'e2',
            guest_tiers: [{ name: 'Gastenlijst', color: null }],
          },
        ],
        error: null,
        count: null,
      },
      capture,
    );

    const { rows, total } = await fetchVenueGuestsWindow(client, { venueId: 'venue-1' });

    expect(rows[0]).toMatchObject({ tierName: 'Gastenlijst', tierColor: null });
    expect(total).toBe(1); // count null → falls back to the page length
  });
});

// ── fetchTiersWithUsage (86ey9e9wv) ──────────────────────────────────────
// Occupancy now comes from the event_tier_occupancy RPC (a DB-side GROUP BY),
// not a per-guest download summed in JS.

describe('fetchTiersWithUsage (86ey9e9wv)', () => {
  interface RpcCall {
    name: string;
    args: unknown;
  }

  function makeClient(tiersResult: unknown, rpcResult: unknown, rpcCalls: RpcCall[] = []) {
    return {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve(tiersResult)),
          })),
        })),
      })),
      rpc: vi.fn((name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return Promise.resolve(rpcResult);
      }),
    } as never;
  }

  it('rejects when the occupancy RPC errors, rather than showing every tier as empty', async () => {
    const client = makeClient({ data: [{ id: 't1' }], error: null }, { data: null, error: { message: 'boom' } });
    await expect(fetchTiersWithUsage(client, 'event-1')).rejects.toThrow();
  });

  it('rejects when the tiers select errors', async () => {
    const client = makeClient({ data: null, error: { message: 'boom' } }, { data: [], error: null });
    await expect(fetchTiersWithUsage(client, 'event-1')).rejects.toThrow();
  });

  it('maps occupancy from the RPC by tier_id and defaults tiers with no rows to 0', async () => {
    const rpcCalls: RpcCall[] = [];
    const client = makeClient(
      {
        data: [
          { id: 't1', name: 'Regular', color: '#000', max_guests: null, aliases: [], door_price_cents: null, vat_percent: null },
          { id: 't2', name: 'VIP', color: '#fff', max_guests: 10, aliases: [], door_price_cents: null, vat_percent: null },
        ],
        error: null,
      },
      { data: [{ tier_id: 't1', used: 23 }], error: null },
      rpcCalls,
    );

    const rows = await fetchTiersWithUsage(client, 'event-1');

    expect(rpcCalls).toEqual([{ name: 'event_tier_occupancy', args: { p_event_id: 'event-1' } }]);
    expect(rows).toEqual([
      { id: 't1', name: 'Regular', color: '#000', max_guests: null, aliases: [], door_price_cents: null, vat_percent: null, used: 23 },
      { id: 't2', name: 'VIP', color: '#fff', max_guests: 10, aliases: [], door_price_cents: null, vat_percent: null, used: 0 },
    ]);
  });
});

// ── fetchVenueRequestLinks (86ey9e9wv, A2 fix) ───────────────────────────
// Links never archive automatically, so this is now a ranged read (instead of
// one unwindowed select). The influencer lookup filters by venue_id directly
// (never `.in('id', …)` — a ranged read has no bound on the distinct
// influencer count it can surface, matching CLAUDE.md's "never .in() a
// venue-wide list" rule).

describe('fetchVenueRequestLinks (86ey9e9wv, A2)', () => {
  interface Capture {
    ranges: [number, number][];
    orders: unknown[][];
    influencersEq: [string, string][];
  }

  interface LinksChain {
    select: (...args: unknown[]) => LinksChain;
    eq: (...args: unknown[]) => LinksChain;
    is: (...args: unknown[]) => LinksChain;
    order: (...args: unknown[]) => LinksChain;
    range: (from: number, to: number) => Promise<unknown>;
  }
  interface InfChain {
    select: (...args: unknown[]) => InfChain;
    eq: (col: string, value: string) => Promise<unknown>;
  }

  function makeClient(pages: unknown[], influencersResult: unknown, capture: Capture) {
    let pageIndex = 0;
    const linksChain: LinksChain = {
      select: vi.fn(() => linksChain),
      eq: vi.fn(() => linksChain),
      is: vi.fn(() => linksChain),
      order: vi.fn((...args: unknown[]) => {
        capture.orders.push(args);
        return linksChain;
      }),
      range: vi.fn((from: number, to: number) => {
        capture.ranges.push([from, to]);
        const result = pages[pageIndex] ?? { data: [], error: null };
        pageIndex++;
        return Promise.resolve(result);
      }),
    };
    const infChain: InfChain = {
      select: vi.fn(() => infChain),
      eq: vi.fn((col: string, value: string) => {
        capture.influencersEq.push([col, value]);
        return Promise.resolve(influencersResult);
      }),
    };
    return {
      from: vi.fn((table: string) => (table === 'request_links' ? linksChain : infChain)),
    } as never;
  }

  it('rejects when the ranged request_links read errors', async () => {
    const capture: Capture = { ranges: [], orders: [], influencersEq: [] };
    const client = makeClient([{ data: null, error: { message: 'boom' } }], { data: [], error: null }, capture);
    await expect(fetchVenueRequestLinks(client, 'venue-1')).rejects.toThrow();
  });

  it('rejects when the influencers read errors', async () => {
    const capture: Capture = { ranges: [], orders: [], influencersEq: [] };
    const client = makeClient([{ data: [], error: null }], { data: null, error: { message: 'boom' } }, capture);
    await expect(fetchVenueRequestLinks(client, 'venue-1')).rejects.toThrow();
  });

  it('pages the request_links read (fetchAllRanged) with an id tiebreaker, instead of one unwindowed select', async () => {
    const capture: Capture = { ranges: [], orders: [], influencersEq: [] };
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      id: `link-${i}`,
      event_id: 'event-1',
      is_default: false,
      label: `Link ${i}`,
      influencer_id: null,
    }));
    const client = makeClient(
      [
        { data: fullPage, error: null },
        { data: [], error: null },
      ],
      { data: [], error: null },
      capture,
    );

    const rows = await fetchVenueRequestLinks(client, 'venue-1');

    expect(capture.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]); // a full first page forces a second (short) page request
    // B4: `created_at` alone isn't a unique order — every page must also carry
    // the `id` tiebreaker, or ranged paging can skip/repeat tied rows. The page
    // factory reruns per page (fetchAllRanged rebuilds the query each time), so
    // the pair repeats once per page fetched (two pages here).
    expect(capture.orders).toEqual([
      ['created_at', { ascending: true }],
      ['id'],
      ['created_at', { ascending: true }],
      ['id'],
    ]);
    expect(rows).toHaveLength(1000);
  });

  it('filters influencers by venue_id (no .in() id list) and resolves label fallback (resolved name > stored label > null)', async () => {
    const capture: Capture = { ranges: [], orders: [], influencersEq: [] };
    const client = makeClient(
      [
        {
          data: [
            { id: 'l1', event_id: 'e1', is_default: true, label: null, influencer_id: null },
            { id: 'l2', event_id: 'e1', is_default: false, label: 'Fallback label', influencer_id: 'inf-1' },
            { id: 'l3', event_id: 'e1', is_default: false, label: null, influencer_id: 'inf-2' },
          ],
          error: null,
        },
      ],
      { data: [{ id: 'inf-1', name: 'Jayden Promo' }], error: null },
      capture,
    );

    const rows = await fetchVenueRequestLinks(client, 'venue-1');

    expect(capture.influencersEq).toEqual([['venue_id', 'venue-1']]);
    expect(rows).toEqual([
      { id: 'l1', eventId: 'e1', isDefault: true, label: null },
      { id: 'l2', eventId: 'e1', isDefault: false, label: 'Jayden Promo' },
      { id: 'l3', eventId: 'e1', isDefault: false, label: null }, // unresolved influencer -> null, not the (absent) stored label
    ]);
  });
});

// ── fetchRequestLinks (86ey9e9wv/D1) ─────────────────────────────────────────
// Folded onto the existing event_link_funnel RPC (fresh-session /code-review
// D1) — one call replaces the old four batched reads + client-side heads
// loops entirely, so there is nothing left in this fetcher to re-implement
// or get wrong (the RPC's own correctness is exercised by
// supabase/tests/database/promotion_stats.test.sql).

describe('fetchRequestLinks (86ey9e9wv/D1)', () => {
  function makeClient(rpcResult: unknown, rpcCalls: Array<{ name: string; args: unknown }> = []) {
    return {
      rpc: vi.fn((name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return Promise.resolve(rpcResult);
      }),
    } as never;
  }

  it('rejects when the RPC errors, rather than showing every link with zero requests', async () => {
    const client = makeClient({ data: null, error: { message: 'boom' } });
    await expect(fetchRequestLinks(client, 'event-1')).rejects.toThrow();
  });

  it('calls event_link_funnel with the event id and maps every field, including the new tier_id/created_at/approved columns', async () => {
    const rpcCalls: Array<{ name: string; args: unknown }> = [];
    const client = makeClient(
      {
        data: [
          {
            link_id: 'l1',
            slug: 's1',
            is_default: true,
            label: null,
            tier_id: null,
            influencer_id: null,
            influencer_name: null,
            active: true,
            auto_approve: false,
            max_headcount: null,
            expires_at: null,
            created_at: '2026-01-01T00:00:00Z',
            views: 10,
            requests: 3,
            approved: 1,
            approved_heads: 2,
            checked_in_heads: 1,
          },
          {
            link_id: 'l2',
            slug: 's2',
            is_default: false,
            label: 'Jayden',
            tier_id: 't1',
            influencer_id: 'inf-1',
            influencer_name: 'Jayden Promo',
            active: true,
            auto_approve: true,
            max_headcount: 25,
            expires_at: '2026-02-01T00:00:00Z',
            created_at: '2026-01-02T00:00:00Z',
            views: 40,
            requests: 2,
            approved: 2,
            approved_heads: 4,
            checked_in_heads: 3,
          },
        ],
        error: null,
      },
      rpcCalls,
    );

    const rows = await fetchRequestLinks(client, 'event-1');

    expect(rpcCalls).toEqual([{ name: 'event_link_funnel', args: { p_event_id: 'event-1' } }]);
    expect(rows).toEqual([
      {
        id: 'l1',
        eventId: 'event-1',
        slug: 's1',
        isDefault: true,
        active: true,
        autoApprove: false,
        influencerId: null,
        influencerName: null,
        label: null,
        tierId: null,
        maxHeadcount: null,
        expiresAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        views: 10,
        requests: 3,
        approved: 1, // requests (3) and approved (1) are DISTINCT counts — B4
        approvedHeads: 2,
        checkedInHeads: 1,
      },
      {
        id: 'l2',
        eventId: 'event-1',
        slug: 's2',
        isDefault: false,
        active: true,
        autoApprove: true,
        influencerId: 'inf-1',
        influencerName: 'Jayden Promo',
        label: 'Jayden',
        tierId: 't1',
        maxHeadcount: 25,
        expiresAt: '2026-02-01T00:00:00Z',
        createdAt: '2026-01-02T00:00:00Z',
        views: 40,
        requests: 2,
        approved: 2,
        approvedHeads: 4,
        checkedInHeads: 3,
      },
    ]);
  });
});
