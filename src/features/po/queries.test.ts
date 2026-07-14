import { describe, expect, it, vi } from 'vitest';
import {
  fetchEventCrew,
  fetchEventQuota,
  fetchEvents,
  fetchOrganizesAtVenue,
  fetchOwnSessions,
  fetchVenueGuestsWindow,
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
