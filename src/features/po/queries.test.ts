import { describe, expect, it, vi } from 'vitest';
import {
  fetchEventCrew,
  fetchEventQuota,
  fetchEvents,
  fetchOrganizesAtVenue,
  fetchOwnSessions,
  fetchVenueSettings,
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
