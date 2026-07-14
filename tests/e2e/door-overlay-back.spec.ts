import { test, expect } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { adminClient } from './helpers/supabase-admin';

// Bug 86ey9tq62 — on the mobile /app Deur tab, closing a guest overlay with
// "Back" over-popped straight PAST the check-in list (landing on Home/picker)
// when the door was entered with a frozen `?event=` and used after a
// switch/re-pick. Root cause: the `doorOverride` shadow (which drives the
// overlay) was cleared only by an effect keyed on Next's [pathname,
// searchParams]; those stay frozen through the door's raw-history sub-nav, so a
// Back that pops to the SAME frozen search string never fired the effect — the
// stale overlay override survived, the overlay lingered, and the next Back
// over-popped. The fix (use-door-override.ts) also clears the shadow on any
// popstate. This spec drives the exact flow in a real browser (the Next
// remount/popstate timing this depends on doesn't reproduce in jsdom) and
// asserts a SINGLE Back returns to the check-in list.

const EVENT_A = 'ee000000-0000-7000-8000-000000000001'; // seed "PLUSONE Launch Night"
const EVENT_A_NAME = 'PLUSONE Launch Night';
const REGULAR_TIER = 'dd000000-0000-7000-8000-000000000001';
const VENUE_ID = 'aa000000-0000-7000-8000-000000000001'; // Club Vesper
const DOOR_EMAIL = 'door@plusone.test';
const DOOR_ID = '66666666-6666-4666-8666-666666666666';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111'; // quota-exempt adder (avoids the quota trigger)

test.use({ viewport: { width: 390, height: 844 } });

test('door /app: a single Back closes the guest overlay to the check-in list after a switch/re-pick', async ({
  page,
}) => {
  const db = adminClient();
  test.setTimeout(180_000); // the dev server compiles /app + /app/door on first hit

  // Keep the flow on /app (door has no MFA factor; snooze the enroll nudge too).
  await db.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', DOOR_ID);

  const stamp = Date.now().toString(36);

  // Need ≥2 door candidates so the picker + "Switch" bar appear. Seed a 2nd
  // open/future event for the same venue (its own tier so it's a valid pick).
  const eventB = uuidv7();
  {
    const start = new Date(Date.now() + 3 * 864e5);
    const { error } = await db.from('events').insert({
      id: eventB,
      venue_id: VENUE_ID,
      name: `Second Night ${stamp}`,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 6 * 36e5).toISOString(),
      status: 'open',
      landing_slug: `second-night-${stamp}`,
      landing_active: false,
    });
    if (error) throw new Error(`seed event B failed: ${error.message}`);
    await db.from('guest_tiers').insert({ id: uuidv7(), event_id: eventB, name: 'Regular' });
  }

  // A known guest on event A so we can open the overlay for a stable name.
  const guestName = `Overlaytest ${stamp}`;
  {
    const { error } = await db.from('guests').insert({
      id: uuidv7(),
      event_id: EVENT_A,
      tier_id: REGULAR_TIER,
      full_name: guestName,
      added_by: ADMIN_ID,
      source: 'app',
      status: 'approved',
    });
    if (error) throw new Error(`seed guest failed: ${error.message}`);
  }

  // ── Log in as the doorhost (dev-login), clear the consent gate, land on /app. ──
  await page.goto(`/auth/dev-login?email=${DOOR_EMAIL}&next=/app`);
  await page.waitForURL(/\/(app|consent)/, { timeout: 60_000 });
  if (page.url().includes('/consent')) {
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Agree & continue' }).click();
  }
  await page.waitForURL('**/app', { timeout: 60_000 });

  const searchBox = page.getByPlaceholder('Search a name…');
  const switchBtn = page.getByRole('button', { name: 'Switch', exact: true });
  const backBtn = page.getByRole('button', { name: 'Back', exact: true });
  const picker = page.getByText('Pick an event');

  // ── Enter the door with a FROZEN `?event=` — the entry path that triggers the
  //    bug (useSearchParams freezes at `event=A` for the whole door session). ──
  await page.goto(`/app/door?event=${EVENT_A}`);
  await expect(searchBox).toBeVisible({ timeout: 40_000 });
  await expect(switchBtn).toBeVisible(); // 2 candidates → the Switch bar is shown

  // ── Switch → picker → re-pick event A (the "Switch/re-pick" in the report). ──
  await switchBtn.click();
  await expect(picker).toBeVisible();
  await page.locator('.evcard', { hasText: EVENT_A_NAME }).click();
  await expect(searchBox).toBeVisible({ timeout: 20_000 });
  await expect(picker).toHaveCount(0);

  // ── Open the guest overlay (search first — the list is virtualized). ──
  await searchBox.fill(guestName);
  await page.getByRole('button', { name: new RegExp(guestName) }).click();
  await expect(backBtn).toBeVisible({ timeout: 15_000 }); // GuestDetail is up…
  await expect(searchBox).toHaveCount(0); //  …and the list is gone.

  // ── The regression: ONE Back returns to the check-in list, not past it. ──
  await backBtn.click();
  await expect(searchBox).toBeVisible({ timeout: 15_000 }); // check-in list is back…
  await expect(switchBtn).toBeVisible(); //  …with its event/Switch bar (not Home)…
  await expect(picker).toHaveCount(0); //  …and not the picker.
  await expect(backBtn).toHaveCount(0); // the overlay really closed (no lingering shadow).
  await expect(page).toHaveURL(new RegExp(`/app/door\\?event=${EVENT_A}`));
});
