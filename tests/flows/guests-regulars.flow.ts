import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: the Regulars filter and the address book read server-side (Snelheid P2
 * finding 6, z8uq9m2xz2 9-FE), in all four variants.
 *
 *   admin@ on Club Vesper → Guests (all events) → Regulars chip: the guest
 *   linked to a starred contact stays, the one linked to an ordinary contact
 *   goes → the network shows the starred-only contacts read and the one
 *   `contact_event_counts` RPC, never a `guests?contact_id=in.(…)` id list →
 *   Contacts: every contact with its "N× on a list" count from that RPC.
 *
 * Seed: Sanne Mulder (c0…01) is starred, Pim Scholten (c0…03) is not and is
 * already on the launch event; the fixture links a Sanne guest there too.
 *
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const ADMIN = 'admin@plusone.test';
const VENUE = 'aa000000-0000-7000-8000-000000000001';
const EVENT = 'ee000000-0000-7000-8000-000000000001';
const TIER = 'dd000000-0000-7000-8000-000000000001';
const SANNE = 'c0000000-0000-7000-8000-000000000001';
const SANNE_GUEST = 'cc000000-0000-7000-8000-00000000f601';

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const adminId = await getUserIdByEmail(ADMIN);
  const db = adminClient();
  const { error: pErr } = await db.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId ?? '');
  if (pErr) throw new Error(`guests-regulars setup: ${pErr.message}`);
  // One live Sanne guest on the launch event (unique per event + contact; a
  // rerun or another variant finds it already there).
  const { data: existing } = await db
    .from('guests')
    .select('id')
    .eq('event_id', EVENT)
    .eq('contact_id', SANNE)
    .neq('status', 'removed');
  if (!existing?.length) {
    const { error } = await db.from('guests').insert({
      id: SANNE_GUEST, event_id: EVENT, tier_id: TIER, full_name: 'Sanne Mulder',
      contact_id: SANNE, added_by: adminId, source: 'app',
    } as never);
    if (error) throw new Error(`guests-regulars fixture: ${error.message}`);
  }
});

test('regulars + contacts: server-side filter, one counts RPC, no id lists', async ({ page, context, flow, baseURL }) => {
  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  await context.addCookies([{ name: 'po_active_venue', value: VENUE, domain: host, path: '/' }]);
  const urls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/')) urls.push(decodeURIComponent(r.url()));
  });

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/guests`);
  await page.waitForURL(/\/app\/guests/);
  const regulars = page.getByRole('button', { name: 'Regulars' });
  await expect(regulars).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Pim Scholten').first()).toBeVisible({ timeout: 20_000 });
  await flow.shot('guests-all');

  await regulars.click();
  await flow.check(1, 'Regulars keeps the guest of a starred contact and hides the guest of an ordinary contact', async () => {
    await expect(regulars).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Sanne Mulder').first()).toBeVisible();
    await expect(page.getByText('Pim Scholten')).toHaveCount(0);
  });
  await flow.shot('guests-regulars');

  await flow.check(2, 'The Regulars read filters on the server: contacts?is_permanent=eq.true + contact_event_counts with p_permanent_only', async () => {
    expect(urls.some((u) => u.includes('/rest/v1/contacts?') && u.includes('is_permanent=eq.true'))).toBe(true);
    expect(urls.some((u) => u.includes('/rest/v1/rpc/contact_event_counts'))).toBe(true);
  });
  await flow.check(3, 'No guests read sends a contact id list (no contact_id=in.(…))', async () => {
    expect(urls.filter((u) => u.includes('/rest/v1/guests?') && u.includes('contact_id=in.'))).toEqual([]);
  });

  urls.length = 0;
  await page.goto('/app/contacts');
  const sanneRow = page.getByText('Sanne Mulder').first();
  await expect(sanneRow).toBeVisible({ timeout: 20_000 });
  await flow.shot('contacts');

  await flow.check(4, 'Contacts shows each contact with an "N× on a list" count', async () => {
    await expect(page.getByText(/\d+× on a list/).first()).toBeVisible();
  });
  await flow.check(5, 'The address book reads its counts with one contact_event_counts call and no guests id list', async () => {
    expect(urls.filter((u) => u.includes('/rest/v1/rpc/contact_event_counts')).length).toBeGreaterThanOrEqual(1);
    expect(urls.filter((u) => u.includes('/rest/v1/guests?') && u.includes('contact_id=in.'))).toEqual([]);
  });
  await flow.check(6, 'No sideways scroll and no uncaught page errors', async () => {
    expectNoHorizontalOverflow(flow);
    expect(flow.pageErrors).toEqual([]);
  });
});
