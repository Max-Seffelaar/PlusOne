import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: the requests list without id lists (Snelheid P2 finding 5,
 * z8uq9m2xz2 9-FE), in all four variants.
 *
 *   admin@ on Club Vesper → Requests: a pending request reads "via Flow
 *   Promo"; Declined holds the request that came through a link archived
 *   since ("via Old Promo"), and still the one for an event that ended a
 *   month ago (the history is not windowed: an open product decision, review
 *   #486) → no request_links?id=in.(…) on the wire → More,
 *   opened cold: the Requests row badge comes from the head count, never the
 *   request list.
 *
 * Fixture (fixed ids, stays): two links on the seed launch event (one live,
 * one archived), one pending + one declined request through them, and a past
 * Vesper event with a declined request of its own.
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const ADMIN = 'admin@plusone.test';
const VENUE = 'aa000000-0000-7000-8000-000000000001';
const EVENT = 'ee000000-0000-7000-8000-000000000001';
const PAST_EVENT = 'ee000000-0000-7000-8000-0000000f5e01';
const LIVE_LINK = 'b0000000-0000-7000-8000-0000000f5b01';
const OLD_LINK = 'b0000000-0000-7000-8000-0000000f5b02';
const PAST_LINK = 'b0000000-0000-7000-8000-0000000f5b03';

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  const db = adminClient();
  const must = (what: string, error: { message: string } | null): void => {
    if (error) throw new Error(`requests-list ${what}: ${error.message}`);
  };
  must('profile', (await db.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId)).error);
  const past = Date.now() - 30 * 24 * 3600 * 1000;
  must('past event', (await db.from('events').upsert({
    id: PAST_EVENT, venue_id: VENUE, name: 'Requests Window Past', landing_slug: 'flow-requests-window-past',
    starts_at: new Date(past).toISOString(), ends_at: new Date(past + 6 * 3600 * 1000).toISOString(), status: 'closed',
  }, { onConflict: 'id' })).error);
  must('links', (await db.from('request_links').upsert([
    { id: LIVE_LINK, event_id: EVENT, venue_id: VENUE, slug: 'flow-req-live', label: 'Flow Promo', created_by: adminId },
    { id: OLD_LINK, event_id: EVENT, venue_id: VENUE, slug: 'flow-req-old', label: 'Old Promo', created_by: adminId, archived_at: new Date().toISOString() },
    { id: PAST_LINK, event_id: PAST_EVENT, venue_id: VENUE, slug: 'flow-req-past', label: 'Past Promo', created_by: adminId },
  ] as never, { onConflict: 'id', ignoreDuplicates: true })).error);
  const decided = { decided_by: adminId, decided_at: new Date().toISOString(), decision_message: 'Full tonight.' };
  must('requests', (await db.from('guest_requests').upsert([
    { id: 'f0000000-0000-7000-8000-0000000f5a01', event_id: EVENT, venue_id: VENUE, request_link_id: LIVE_LINK,
      full_name: 'Pending Via Promo', email: 'flow-req-pending@example.test', plus_ones: 1, status: 'pending' },
    { id: 'f0000000-0000-7000-8000-0000000f5a02', event_id: EVENT, venue_id: VENUE, request_link_id: OLD_LINK,
      full_name: 'Declined Via Archived', email: 'flow-req-archived@example.test', plus_ones: 0, status: 'denied', ...decided },
    { id: 'f0000000-0000-7000-8000-0000000f5a03', event_id: PAST_EVENT, venue_id: VENUE, request_link_id: PAST_LINK,
      full_name: 'Declined Long Ago', email: 'flow-req-past@example.test', plus_ones: 0, status: 'denied', ...decided },
  ] as never, { onConflict: 'id', ignoreDuplicates: true })).error);
});

test('requests list: labels from the venue links, full history, head count on More', async ({ page, context, flow, baseURL }) => {
  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  await context.addCookies([{ name: 'po_active_venue', value: VENUE, domain: host, path: '/' }]);
  const rest: { method: string; url: string }[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/')) rest.push({ method: r.method(), url: decodeURIComponent(r.url()) });
  });

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/requests`);
  await page.waitForURL(/\/app\/requests/);
  const pending = page.getByText('Pending Via Promo').first();
  await expect(pending).toBeVisible({ timeout: 20_000 });
  await flow.shot('requests');

  await flow.check(1, 'A pending request names the link it came through ("via Flow Promo")', async () => {
    await expect(page.getByText('via Flow Promo').first()).toBeVisible();
  });

  await page.getByRole('button', { name: /^Declined · \d+/ }).click();
  await expect(page.getByText('Declined Via Archived').first()).toBeVisible();
  await flow.shot('requests-declined');
  await flow.check(2, 'A declined request keeps the label of a link archived since ("via Old Promo")', async () => {
    await expect(page.getByText('via Old Promo').first()).toBeVisible();
  });
  await flow.check(3, 'The declined history still includes a request for an event that ended a month ago, with its label', async () => {
    await expect(page.getByText('Declined Long Ago').first()).toBeVisible();
    await expect(page.getByText('via Past Promo').first()).toBeVisible();
  });
  await flow.check(4, 'No request_links read sends an id list (no id=in.(…))', async () => {
    expect(rest.filter((r) => r.url.includes('/rest/v1/request_links?') && r.url.includes('id=in.'))).toEqual([]);
    expect(rest.some((r) => r.url.includes('/rest/v1/request_links?') && r.url.includes(`venue_id=eq.${VENUE}`))).toBe(true);
  });

  rest.length = 0;
  await page.goto('/app/more');
  await page.waitForURL(/\/app\/more/);
  await page.waitForLoadState('networkidle').catch(() => {});
  await flow.shot('more');
  await flow.check(5, 'More, opened cold, counts open requests with a head count and never downloads the request list', async () => {
    const reqReads = rest.filter((r) => r.url.includes('/rest/v1/guest_requests?'));
    expect(reqReads.filter((r) => r.method === 'GET' && r.url.includes('full_name'))).toEqual([]);
    expect(reqReads.some((r) => r.method === 'HEAD' && r.url.includes('status=eq.pending'))).toBe(true);
  });
  await flow.check(6, 'No sideways scroll and no uncaught page errors', async () => {
    expectNoHorizontalOverflow(flow);
    expect(flow.pageErrors).toEqual([]);
  });
});
