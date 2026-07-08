import { describe, expect, it, vi } from 'vitest';
import { fetchEventStats, fetchVenueEvents, fetchVenueStats } from './data';

// Regression coverage for C25 (2026-07 review P3, ClickUp 86ey6xdkb): a real
// fetch failure must reject, never be coerced into an empty/default shape —
// that would be indistinguishable from the legitimate role-gated empty result
// the SECURITY DEFINER analytics functions return for an out-of-scope id (see
// data.ts's file header). Both cases are covered per fetcher.

function rpcResult(data: unknown, error: unknown = null) {
  return { maybeSingle: () => Promise.resolve({ data, error }) };
}

function plainResult(data: unknown, error: unknown = null) {
  return Promise.resolve({ data, error });
}

describe('fetchEventStats (C25)', () => {
  it('resolves with shaped data when every RPC succeeds', async () => {
    const client = {
      rpc: vi.fn((name: string) => {
        if (name === 'event_stats_summary') return rpcResult({ present: 3 });
        return plainResult([]);
      }),
    } as never;

    const result = await fetchEventStats(client, 'event-1');
    expect(result.summary).toEqual({ present: 3 });
    expect(result.perQuarter).toEqual([]);
  });

  it('rejects (does not fall back to empty) when one RPC errors', async () => {
    const client = {
      rpc: vi.fn((name: string) => {
        if (name === 'event_tier_stats') return plainResult(null, { message: 'boom' });
        if (name === 'event_stats_summary') return rpcResult(null);
        return plainResult([]);
      }),
    } as never;

    await expect(fetchEventStats(client, 'event-1')).rejects.toThrow();
  });
});

describe('fetchVenueStats (C25)', () => {
  it('resolves with shaped data when every RPC succeeds', async () => {
    const client = {
      rpc: vi.fn((name: string) => {
        if (name === 'venue_stats_summary') return rpcResult({ events: 2 });
        return plainResult([]);
      }),
    } as never;

    const result = await fetchVenueStats(client, 'venue-1', null, null);
    expect(result.summary).toEqual({ events: 2 });
    expect(result.rollup).toEqual([]);
  });

  it('rejects when one RPC errors, rather than returning an empty VenueStats', async () => {
    const client = {
      rpc: vi.fn((name: string) => {
        if (name === 'venue_stats_summary') return rpcResult(null, { message: 'boom' });
        return plainResult([]);
      }),
    } as never;

    await expect(fetchVenueStats(client, 'venue-1', null, null)).rejects.toThrow();
  });
});

describe('fetchVenueEvents (C25)', () => {
  it('resolves with the mapped rows on success', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() =>
              Promise.resolve({
                data: [{ id: 'e1', name: 'Event', starts_at: '2026-01-01', status: 'draft' }],
                error: null,
              })
            ),
          })),
        })),
      })),
    } as never;

    const result = await fetchVenueEvents(client, 'venue-1');
    expect(result).toEqual([
      { id: 'e1', name: 'Event', startsAt: '2026-01-01', status: 'draft' },
    ]);
  });

  it('rejects when the select errors, rather than rendering "no events yet"', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
          })),
        })),
      })),
    } as never;

    await expect(fetchVenueEvents(client, 'venue-1')).rejects.toThrow();
  });
});
