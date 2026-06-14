import { test, expect } from '@playwright/test';
import { otpLogin } from './helpers/login';
import { adminClient } from './helpers/supabase-admin';

// Full public aanvraagflow (#12/#28/#31): an anonymous visitor files a request
// on the per-event landing page, the organizer approves it with a tier, and the
// guest shows up on the event's guest list as a source=landing guest.
//
// Seed: event ee..01 'PLUSONE Launch Night' (open, landing_active) at slug
// 'plusone-launch-night'; Yusuf (organizer@plusone.test) is its organizer and
// has no MFA requirement, so a plain OTP login reaches the approval screen.

const SLUG = 'plusone-launch-night';
const EVENT_ID = 'ee000000-0000-7000-8000-000000000001';
const ORGANIZER = 'organizer@plusone.test';

test.describe('Landing-page aanvraagflow', () => {
  // Unique per run so re-runs never collide (guests are soft-delete only, #21).
  const guestName = `Playwright Gast ${Date.now()}`;

  test.beforeAll(async () => {
    // Reset the per-IP throttle so repeated local runs aren't rate-limited
    // (all localhost requests share one IP bucket).
    await adminClient().from('landing_request_throttle').delete().gte('request_count', 0);
  });

  test.afterAll(async () => {
    const a = adminClient();
    // Soft-remove the created guest (can't hard-delete, #21) and drop the
    // request, so the seeded list stays clean for the next run.
    await a.from('guests').update({ status: 'removed' }).eq('full_name', guestName);
    await a.from('guest_requests').delete().eq('full_name', guestName);
  });

  test('request → approval → guest on the list', async ({ page }) => {
    // Cold Next dev compiles three routes + an OTP round-trip — give it room.
    test.setTimeout(120_000);

    // 1. Anonymous submission on the public landing page.
    await page.goto(`/e/${SLUG}`);
    await expect(page.getByRole('heading', { name: 'PLUSONE Launch Night' })).toBeVisible();

    await page.getByPlaceholder('Voor- en achternaam').fill(guestName);
    await page.getByRole('button', { name: 'Meer' }).click(); // +1 → 2 personen
    await page.getByLabel('Landcode').selectOption('+31'); // NL country code
    await page.getByLabel('Telefoonnummer').fill('06 12 34 56 78');
    await page.getByRole('button', { name: /Houd me op de hoogte/ }).click(); // marketing consent
    await page.getByRole('button', { name: 'Verstuur aanvraag' }).click();

    await expect(
      page.getByRole('heading', { name: 'Je aanvraag is in behandeling' })
    ).toBeVisible();

    // 2. Organizer logs in and opens the approval screen.
    await otpLogin(page, ORGANIZER);
    await page.waitForURL('**/dashboard', { timeout: 20_000 });

    await page.goto(`/events/${EVENT_ID}/requests`);
    const card = page.locator('.card', { hasText: guestName });
    await expect(card).toBeVisible();

    // 3. Approve with an explicit tier → guest with source=landing.
    await card.getByLabel(`Tier voor ${guestName}`).selectOption({ label: 'Regular' });
    await card.getByRole('button', { name: 'Goedkeuren' }).click();

    // The row disappears once the server revalidates.
    await expect(page.locator('.card', { hasText: guestName })).toHaveCount(0);

    // 4. The guest is now on the event's guest list, carrying the +1.
    await page.goto(`/events/${EVENT_ID}/guests`);
    const guestRow = page.locator('summary', { hasText: guestName });
    await expect(guestRow).toBeVisible();
    await expect(guestRow).toContainText('+1');

    // 5. The phone was stored as E.164 (with country code), and the marketing
    //    consent was recorded on the request (AVG).
    const a = adminClient();
    const { data: guest } = await a
      .from('guests')
      .select('phone, source')
      .eq('full_name', guestName)
      .maybeSingle();
    expect(guest?.source).toBe('landing');
    expect(guest?.phone).toBe('+31612345678');

    const { data: req } = await a
      .from('guest_requests')
      .select('marketing_opt_in, phone')
      .eq('full_name', guestName)
      .maybeSingle();
    expect(req?.marketing_opt_in).toBe(true);
    expect(req?.phone).toBe('+31612345678');
  });
});
