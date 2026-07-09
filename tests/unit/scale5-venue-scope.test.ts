/**
 * SCALE-5 regression guard (K8/FE-3, ClickUp 86ey6bga8-adjacent — see
 * `scale-audit-megaevent-venue-scope-fix` topic memory).
 *
 * `fetchGuests`/`fetchTiers` in `src/features/po/queries.ts` used to take a
 * venue-wide scope by building `.in('event_id', <every event id at the venue>)`
 * from a separate `usePoEvents()` list — which 414'd Kong past ~205 events and
 * (for headcounts) shipped megabytes of rows just to sum client-side. The fix
 * (migration `20260708120000` + PR #143) denormalized `venue_id` onto `guests`/
 * `guest_tiers` so a venue-wide read filters by ONE `venue_id` directly.
 *
 * This test would FAIL if someone reverted to the old shape: it spies on the
 * Supabase query-builder chain and asserts that a venue-scoped call to either
 * fetcher issues `.eq('venue_id', …)` and NEVER calls `.in('event_id', …)`.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchGuests, fetchTiers } from '@/features/po/queries';

const VENUE_ID = '99999999-9999-9999-9999-999999999999';

/**
 * A minimal chainable query-builder spy. Every chain method returns `this` so
 * `.from().select().neq().order().order().range()` (fetchGuests) and
 * `.from().select().order().eq()` (fetchTiers) both resolve fine; `.eq()`/
 * `.in()` calls are recorded so the test can assert on exactly what filter the
 * fetcher issued. Thenable so `fetchAllRanged`'s `await makePage(...)` and
 * `fetchTiers`'s bare `await query` both work without a terminal method.
 */
function makeSpyClient(rows: unknown[] = []) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain: Record<string, unknown> = {};
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };

  chain.select = record('select');
  chain.neq = record('neq');
  chain.order = record('order');
  chain.range = record('range');
  chain.eq = record('eq');
  chain.in = record('in');
  chain.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
    resolve({ data: rows, error: null });

  const from = vi.fn(() => chain);
  return { from, calls };
}

describe('SCALE-5: venue-wide po reads stay venue_id-scoped', () => {
  it('fetchGuests({venueId}) filters by venue_id, never an event_id .in() list', async () => {
    const { from, calls } = makeSpyClient([]);
    await fetchGuests({ from } as never, { venueId: VENUE_ID });

    expect(from).toHaveBeenCalledWith('guests');
    expect(calls).toContainEqual({ method: 'eq', args: ['venue_id', VENUE_ID] });
    expect(calls.some((c) => c.method === 'in' && c.args[0] === 'event_id')).toBe(false);
  });

  it('fetchTiers({venueId}) filters by venue_id, never an event_id .in() list', async () => {
    const { from, calls } = makeSpyClient([]);
    await fetchTiers({ from } as never, { venueId: VENUE_ID });

    expect(from).toHaveBeenCalledWith('guest_tiers');
    expect(calls).toContainEqual({ method: 'eq', args: ['venue_id', VENUE_ID] });
    expect(calls.some((c) => c.method === 'in' && c.args[0] === 'event_id')).toBe(false);
  });
});
