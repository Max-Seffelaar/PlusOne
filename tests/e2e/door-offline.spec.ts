import { test, expect } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { otpLogin } from './helpers/login';
import { adminClient } from './helpers/supabase-admin';

// Fase 9 — the door's offline-first contract (spec §4, decisions #11/#25):
//   * a full list loads + caches locally;
//   * an offline check-in is optimistic, the sync bar degrades, and on reconnect
//     the outbox replays so the server check_in + audit_log entry both exist;
//   * a colleague's check-in becomes visible after a sync (delta-sync / force).
// Runs on a 390px phone viewport.
//
// Note on realtime: postgres_changes is wired (publication migration + RLS +
// setAuth-before-subscribe) and verified to deliver, but the local CLI Realtime
// container periodically reconciles the `supabase_realtime` publication, which
// makes push timing non-deterministic in CI. The colleague-propagation step
// therefore asserts via the guaranteed delta-sync path (force-sync button);
// realtime provides the instant path in production.

const EVENT_ID = 'ee000000-0000-7000-8000-000000000001';
const REGULAR_TIER = 'dd000000-0000-7000-8000-000000000001';
const LISA_ID = '66666666-6666-4666-8666-666666666666'; // door@plusone.test
const MAX_ID = '11111111-1111-4111-8111-111111111111'; // admin (quota-exempt) — adds setup guests

test.use({ viewport: { width: 390, height: 844 } });

/** Create a fresh waiting guest via the service-role client (added_by = the
 *  quota-exempt admin, so repeated runs never hit the quota trigger). */
async function seedGuest(name: string): Promise<string> {
  const id = uuidv7();
  const { error } = await adminClient()
    .from('guests')
    .insert({
      id,
      event_id: EVENT_ID,
      tier_id: REGULAR_TIER,
      full_name: name,
      added_by: MAX_ID,
      source: 'app',
      status: 'approved',
    });
  if (error) throw new Error(`seedGuest failed: ${error.message}`);
  return id;
}

test('door: offline check-in replays to server + audit log; colleague check-in shows on sync', async ({
  page,
  context,
}) => {
  const stamp = Date.now();
  // Names deliberately avoid status words ("offline", "binnen") so text locators
  // don't collide with the sync bar / status chips.
  const offlineName = `Doortest A ${stamp}`;
  const colleagueName = `Doortest B ${stamp}`;
  const offlineGuestId = await seedGuest(offlineName);
  const colleagueGuestId = await seedGuest(colleagueName);

  // Log in as the doorhost (no MFA) and open the event's door.
  await otpLogin(page, 'door@plusone.test');
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  await page.goto(`/door/${EVENT_ID}`);

  // The full list is fetched + cached locally; both seed guests are visible.
  await expect(page.getByText(offlineName)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(colleagueName)).toBeVisible();

  // ── Offline check-in (decisions #11/#25). ──────────────────────────────────
  await context.setOffline(true);

  // The permanent status bar must visibly degrade from "live".
  await expect(page.getByText(/Offline ·/)).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder('Typ de naam van de gast…').fill(offlineName);
  await page.getByRole('button', { name: new RegExp(offlineName) }).click();
  await page.getByRole('button', { name: /Check in · 1 persoon/ }).click();

  // Optimistic confirmation (queued in the outbox while offline).
  await expect(page.getByText(/binnen ✓/)).toBeVisible({ timeout: 5_000 });

  // The server has NOT received it yet.
  const beforeReconnect = await adminClient().from('check_ins').select('id').eq('guest_id', offlineGuestId);
  expect(beforeReconnect.data ?? []).toHaveLength(0);

  // ── Reconnect → the outbox replays (idempotent upsert). ────────────────────
  await context.setOffline(false);

  await expect
    .poll(
      async () => {
        const { data } = await adminClient().from('check_ins').select('id').eq('guest_id', offlineGuestId);
        return data?.length ?? 0;
      },
      { timeout: 20_000, intervals: [500, 1000] },
    )
    .toBe(1);

  const { data: checkIns } = await adminClient().from('check_ins').select('*').eq('guest_id', offlineGuestId);
  const checkIn = checkIns![0];
  expect(checkIn.checked_by).toBe(LISA_ID); // RLS pinned the actor to the session user
  expect(checkIn.offline_synced).toBe(true);
  expect(checkIn.device_id).toBeTruthy();

  // The audit log recorded the check-in (trigger-written, #4/#15).
  const { data: audit } = await adminClient()
    .from('audit_log')
    .select('action, event_id')
    .eq('entity_id', checkIn.id)
    .eq('action', 'check_in');
  expect(audit ?? []).toHaveLength(1);
  expect(audit![0].event_id).toBe(EVENT_ID);

  // ── Colleague check-in becomes visible after a sync (point 8/9). ───────────
  const { error: rtErr } = await adminClient().from('check_ins').insert({
    id: uuidv7(),
    guest_id: colleagueGuestId,
    checked_by: MAX_ID,
    plus_ones_arrived: 0,
  });
  expect(rtErr).toBeNull();

  await page.getByRole('button', { name: 'Nu synchroniseren' }).click();
  await page.getByRole('button', { name: 'Ingecheckt', exact: true }).click();
  await expect(page.getByText(colleagueName)).toBeVisible({ timeout: 10_000 });
});
