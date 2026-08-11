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

// ── fetchTiersWithUsage (86ey9e9wv/#47) ──────────────────────────────────────
// Occupancy now comes from the event_tier_occupancy RPC (a DB-side GROUP BY),
// not a per-guest download summed in JS.

describe('fetchTiersWithUsage (86ey9e9wv/#47)', () => {
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

// ── fetchVenueRequestLinks (86ey9e9wv/#48) ───────────────────────────────────
// Links never archive automatically, so this is now a ranged read (instead of
// one unwindowed select) with the influencer lookup chunked.

describe('fetchVenueRequestLinks (86ey9e9wv/#48)', () => {
  interface Capture {
    ranges: [number, number][];
    inIds: string[][];
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
    in: (col: string, ids: string[]) => Promise<unknown>;
  }

  function makeClient(pages: unknown[], influencersResult: unknown, capture: Capture) {
    let pageIndex = 0;
    const linksChain: LinksChain = {
      select: vi.fn(() => linksChain),
      eq: vi.fn(() => linksChain),
      is: vi.fn(() => linksChain),
      order: vi.fn(() => linksChain),
      range: vi.fn((from: number, to: number) => {
        capture.ranges.push([from, to]);
        const result = pages[pageIndex] ?? { data: [], error: null };
        pageIndex++;
        return Promise.resolve(result);
      }),
    };
    const infChain: InfChain = {
      select: vi.fn(() => infChain),
      in: vi.fn((_col: string, ids: string[]) => {
        capture.inIds.push(ids);
        return Promise.resolve(influencersResult);
      }),
    };
    return {
      from: vi.fn((table: string) => (table === 'request_links' ? linksChain : infChain)),
    } as never;
  }

  it('rejects when the ranged request_links read errors', async () => {
    const capture: Capture = { ranges: [], inIds: [] };
    const client = makeClient([{ data: null, error: { message: 'boom' } }], { data: [], error: null }, capture);
    await expect(fetchVenueRequestLinks(client, 'venue-1')).rejects.toThrow();
  });

  it('pages the request_links read (fetchAllRanged) instead of one unwindowed select', async () => {
    const capture: Capture = { ranges: [], inIds: [] };
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
    expect(rows).toHaveLength(1000);
  });

  it('chunks the influencer lookup and resolves label fallback (resolved name > stored label > null)', async () => {
    const capture: Capture = { ranges: [], inIds: [] };
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

    expect(capture.inIds).toEqual([['inf-1', 'inf-2']]); // deduped, one chunk (<1000 ids)
    expect(rows).toEqual([
      { id: 'l1', eventId: 'e1', isDefault: true, label: null },
      { id: 'l2', eventId: 'e1', isDefault: false, label: 'Jayden Promo' },
      { id: 'l3', eventId: 'e1', isDefault: false, label: null }, // unresolved influencer -> null, not the (absent) stored label
    ]);
  });
});

// ── fetchRequestLinks (86ey9e9wv/#49) ────────────────────────────────────────
// requests/approved now come from the event_request_link_funnel RPC (a DB-side
// GROUP BY), not an unwindowed guest_requests download summed in JS.

describe('fetchRequestLinks (86ey9e9wv/#49)', () => {
  interface SimpleChain {
    select: (...args: unknown[]) => SimpleChain;
    eq: (...args: unknown[]) => SimpleChain;
    is: (...args: unknown[]) => SimpleChain;
    not: (...args: unknown[]) => SimpleChain;
    order: (...args: unknown[]) => SimpleChain | Promise<unknown>;
    in: (...args: unknown[]) => Promise<unknown>;
    range: (...args: unknown[]) => Promise<unknown>;
  }

  function makeClient(
    opts: { links: unknown; influencers?: unknown; pageviews?: unknown; funnel: unknown },
    rpcCalls: Array<{ name: string; args: unknown }> = [],
  ) {
    const linksChain: SimpleChain = {
      select: vi.fn(() => linksChain),
      eq: vi.fn(() => linksChain),
      is: vi.fn(() => linksChain),
      not: vi.fn(() => linksChain),
      order: vi.fn(() => Promise.resolve(opts.links)),
      in: vi.fn(() => Promise.resolve(opts.links)),
      range: vi.fn(() => Promise.resolve(opts.links)),
    };
    const infChain: SimpleChain = {
      select: vi.fn(() => infChain),
      eq: vi.fn(() => infChain),
      is: vi.fn(() => infChain),
      not: vi.fn(() => infChain),
      order: vi.fn(() => infChain),
      in: vi.fn(() => Promise.resolve(opts.influencers ?? { data: [], error: null })),
      range: vi.fn(() => Promise.resolve(opts.influencers ?? { data: [], error: null })),
    };
    const pvChain: SimpleChain = {
      select: vi.fn(() => pvChain),
      eq: vi.fn(() => pvChain),
      is: vi.fn(() => pvChain),
      not: vi.fn(() => pvChain),
      order: vi.fn(() => pvChain),
      in: vi.fn(() => Promise.resolve(opts.pageviews ?? { data: [], error: null })),
      range: vi.fn(() => Promise.resolve(opts.pageviews ?? { data: [], error: null })),
    };
    const guestsChain: SimpleChain = {
      select: vi.fn(() => guestsChain),
      eq: vi.fn(() => guestsChain),
      is: vi.fn(() => guestsChain),
      not: vi.fn(() => guestsChain),
      order: vi.fn(() => guestsChain),
      in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      range: vi.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return {
      from: vi.fn((table: string) => {
        if (table === 'request_links') return linksChain;
        if (table === 'influencers') return infChain;
        if (table === 'request_link_pageviews_daily') return pvChain;
        if (table === 'guests') return guestsChain;
        throw new Error(`unexpected table ${table}`);
      }),
      rpc: vi.fn((name: string, args: unknown) => {
        rpcCalls.push({ name, args });
        return Promise.resolve(opts.funnel);
      }),
    } as never;
  }

  it('returns [] without a funnel read when the event has no links', async () => {
    const rpcCalls: Array<{ name: string; args: unknown }> = [];
    const client = makeClient({ links: { data: [], error: null }, funnel: { data: [], error: null } }, rpcCalls);
    const rows = await fetchRequestLinks(client, 'event-1');
    expect(rows).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it('rejects when the funnel RPC errors, rather than showing every link with zero requests', async () => {
    const client = makeClient({
      links: {
        data: [
          {
            id: 'l1', event_id: 'e1', slug: 's1', is_default: true, active: true, auto_approve: false,
            influencer_id: null, label: null, tier_id: null, max_headcount: null, expires_at: null, created_at: '2026-01-01',
          },
        ],
        error: null,
      },
      funnel: { data: null, error: { message: 'boom' } },
    });
    await expect(fetchRequestLinks(client, 'event-1')).rejects.toThrow();
  });

  it('aggregates requests/approved from the RPC, default link sorted first', async () => {
    const rpcCalls: Array<{ name: string; args: unknown }> = [];
    const client = makeClient(
      {
        links: {
          data: [
            {
              id: 'l1', event_id: 'e1', slug: 's1', is_default: true, active: true, auto_approve: false,
              influencer_id: null, label: null, tier_id: null, max_headcount: null, expires_at: null, created_at: '2026-01-01',
            },
            {
              id: 'l2', event_id: 'e1', slug: 's2', is_default: false, active: true, auto_approve: true,
              influencer_id: null, label: 'Jayden', tier_id: null, max_headcount: null, expires_at: null, created_at: '2026-01-02',
            },
          ],
          error: null,
        },
        funnel: {
          data: [
            { request_link_id: 'l2', requests: 2, approved: 0 },
            { request_link_id: 'l1', requests: 1, approved: 0 },
          ],
          error: null,
        },
      },
      rpcCalls,
    );

    const rows = await fetchRequestLinks(client, 'event-1');

    expect(rpcCalls).toEqual([{ name: 'event_request_link_funnel', args: { p_event_id: 'event-1' } }]);
    expect(rows.map((r) => [r.id, r.requests, r.approved])).toEqual([
      ['l1', 1, 0],
      ['l2', 2, 0],
    ]);
  });
});
