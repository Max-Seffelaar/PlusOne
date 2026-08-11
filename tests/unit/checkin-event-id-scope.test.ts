/**
 * Regression guard for 86ey9c5d2 (kill stale "check_ins/refusals have no
 * event_id" comment + embeds). `check_ins`/`refusals` carry a denormalized,
 * trigger-filled `event_id` since `20260622140000_checkin_event_scope.sql`
 * (unconditionally server-derived since `20260713190000_checkin_scope_venue_pin`),
 * but three read paths used to filter via a `guests!inner(event_id)` embed
 * as if the column didn't exist — the same false premise that once caused a
 * wrong "fix" to the realtime subscription filter (see `docs/changelog.md`,
 * spec decision #44).
 *
 * Nothing else in the suite pins the exact filter shape of these three reads
 * (`fetchDoorSnapshot`'s `check_ins`/`refusals` reads never had a test that
 * imports them; `fetchCheckinArrivals`/`fetchRecentCheckins` are covered only
 * indirectly, via mocked-away hook tests) — so a revert to the embed-filter
 * pattern would pass every other test in the suite. These tests would FAIL if
 * that happened: they spy on the Supabase query-builder chain (shared
 * `createSpyClient` helper — see `tests/unit/helpers/spy-client.ts`) and
 * assert each read issues `.eq('event_id', …)` directly and NEVER
 * `.eq('guests.event_id', …)`.
 */
import { describe, expect, it } from 'vitest';
import { fetchDoorSnapshot } from '@/features/door/queries';
import { fetchCheckinArrivals, fetchRecentCheckins } from '@/features/po/queries';
import { createSpyClient } from './helpers/spy-client';

const EVENT_ID = '11111111-1111-1111-1111-111111111111';
const VENUE_ID = '22222222-2222-2222-2222-222222222222';

const neverFiltersOnGuestsEventId = (calls: { table: string; method: string; args: unknown[] }[]) => {
  expect(calls.some((c) => c.method === 'eq' && c.args[0] === 'guests.event_id')).toBe(false);
};

describe('fetchDoorSnapshot — check_ins/refusals filter event_id directly', () => {
  it('filters both reads on the denormalized event_id, with no guests embed', async () => {
    const { client, calls } = createSpyClient({
      events: { data: { id: EVENT_ID, name: 'FRENZY', status: 'open', list_locked: false, allow_uncheck: null, venue_id: VENUE_ID } },
      venues: { data: { name: 'De Marktkantine', allow_uncheck: true } },
      guests: { data: [] },
      guest_tiers: { data: [] },
      check_ins: { data: [] },
      refusals: { data: [] },
    });

    await fetchDoorSnapshot(client as never, EVENT_ID);

    expect(calls).toContainEqual({ table: 'check_ins', method: 'eq', args: ['event_id', EVENT_ID] });
    expect(calls).toContainEqual({ table: 'refusals', method: 'eq', args: ['event_id', EVENT_ID] });
    expect(calls).toContainEqual({ table: 'check_ins', method: 'select', args: ['*'] });
    expect(calls).toContainEqual({ table: 'refusals', method: 'select', args: ['*'] });
    neverFiltersOnGuestsEventId(calls);
  });
});

describe('fetchCheckinArrivals — filters event_id directly, voiding server-side', () => {
  it('selects id (row-scoped check-out, #35) with no guests embed', async () => {
    const { client, calls } = createSpyClient({ check_ins: { data: [] } });

    await fetchCheckinArrivals(client as never, EVENT_ID);

    expect(calls).toContainEqual({
      table: 'check_ins',
      method: 'select',
      args: ['id, guest_id, plus_ones_arrived, checked_at'],
    });
    expect(calls).toContainEqual({ table: 'check_ins', method: 'eq', args: ['event_id', EVENT_ID] });
    expect(calls).toContainEqual({ table: 'check_ins', method: 'is', args: ['voided_at', null] });
    neverFiltersOnGuestsEventId(calls);
  });
});

describe('fetchRecentCheckins — filters event_id directly, keeps the guests embed for name/id', () => {
  it('filters check_ins.event_id while the guests!inner embed stays for full_name', async () => {
    const { client, calls } = createSpyClient({ check_ins: { data: [] } });

    await fetchRecentCheckins(client as never, EVENT_ID);

    expect(calls).toContainEqual({
      table: 'check_ins',
      method: 'select',
      args: ['checked_at, plus_ones_arrived, checked_by, guests!inner(id, full_name)'],
    });
    expect(calls).toContainEqual({ table: 'check_ins', method: 'eq', args: ['event_id', EVENT_ID] });
    neverFiltersOnGuestsEventId(calls);
  });
});
