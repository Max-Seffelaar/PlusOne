/**
 * SCALE-5 regression guard (K8/FE-3, ClickUp 86ey6bga8-adjacent — see
 * `scale-audit-megaevent-venue-scope-fix` topic memory).
 *
 * The venue-wide guest/tier reads in `src/features/po/queries.ts` used to take a
 * venue-wide scope by building `.in('event_id', <every event id at the venue>)`
 * from a separate `usePoEvents()` list — which 414'd Kong past ~205 events and
 * (for headcounts) shipped megabytes of rows just to sum client-side. The fix
 * (migration `20260708120000` + PR #143) denormalized `venue_id` onto `guests`/
 * `guest_tiers` so a venue-wide read filters by ONE `venue_id` directly. The
 * venue-wide guest read is now the windowed `fetchVenueGuestsWindow` (86ey9e8hz).
 *
 * This test would FAIL if someone reverted to the old shape: it spies on the
 * Supabase query-builder chain (via the shared `createSpyClient` helper — see
 * `tests/unit/helpers/spy-client.ts`) and asserts that a venue-scoped call to
 * either fetcher issues `.eq('venue_id', …)` and NEVER calls `.in('event_id', …)`.
 */
import { describe, expect, it } from 'vitest';
import { fetchTiers, fetchVenueGuestsWindow } from '@/features/po/queries';
import { createSpyClient } from './helpers/spy-client';

const VENUE_ID = '99999999-9999-9999-9999-999999999999';

describe('SCALE-5: venue-wide po reads stay venue_id-scoped', () => {
  it('fetchVenueGuestsWindow filters by venue_id, never an event_id .in() list', async () => {
    const { client, calls } = createSpyClient({ guests: { data: [] } });
    await fetchVenueGuestsWindow(client as never, { venueId: VENUE_ID });

    expect(client.from).toHaveBeenCalledWith('guests');
    expect(calls).toContainEqual({ table: 'guests', method: 'eq', args: ['venue_id', VENUE_ID] });
    expect(calls.some((c) => c.method === 'in' && c.args[0] === 'event_id')).toBe(false);
  });

  it('fetchTiers({venueId}) filters by venue_id, never an event_id .in() list', async () => {
    const { client, calls } = createSpyClient({ guest_tiers: { data: [] } });
    await fetchTiers(client as never, { venueId: VENUE_ID });

    expect(client.from).toHaveBeenCalledWith('guest_tiers');
    expect(calls).toContainEqual({ table: 'guest_tiers', method: 'eq', args: ['venue_id', VENUE_ID] });
    expect(calls.some((c) => c.method === 'in' && c.args[0] === 'event_id')).toBe(false);
  });
});
