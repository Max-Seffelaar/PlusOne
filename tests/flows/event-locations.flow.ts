import { test, expect, clickUntilVisible, expectNoHorizontalOverflow } from './harness';
import type { Page } from '@playwright/test';
import { adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: Event locations L (z8uq9m444c), in all four variants. A fresh owner
 * (`/auth/dev-login?create=1`, local stack only) walks the whole path:
 *
 *   Company settings (company address + two saved locations) → New event
 *   (starts at the first saved location, the chip picks the second) → the
 *   share link /e/[slug] → a guest request through that page → the status page
 *   while pending → the admin approves → the status page approved → archiving
 *   the location leaves the event's copy alone.
 *
 * The share link and the status page must show the EVENT's location, never the
 * company address (spec #48(c) revised). The seed's admin@ is shared across
 * variants, so each variant mints its own owner, like company-rename. On the
 * phone/iPad variants the date fields are touch pickers, so the event is saved
 * through the form on the desktop variant only and inserted through the
 * service-role helper elsewhere (with the copy the form would have saved);
 * every variant then walks /e/[slug] and /r/[token] for real.
 *
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const COMPANY = 'Club Atlas';
const STREET = 'Herengracht 1';
const POSTAL = '1000 AA';
const CITY = 'Amsterdam';
const LOC1 = { name: 'Paradiso', street: 'Weteringschans 6', postal: '1017 SG', city: 'Amsterdam' };
const LOC2 = { name: 'Melkweg', street: 'Lijnbaansgracht 234A', postal: '1017 PH', city: 'Amsterdam' };
const addr = (l: typeof LOC1): string => `${l.street}, ${l.postal} ${l.city}`;

async function agree(page: Page): Promise<void> {
  const box = page.locator('input[type="checkbox"]');
  if (await box.count()) {
    await box.first().check();
    return;
  }
  await page.getByText(/I agree to the/i).first().click();
}

function typedDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

async function goApp(page: Page, path: string, baseURL: string | undefined): Promise<void> {
  await page.goto(new URL(path, baseURL).toString());
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function addLocation(page: Page, l: typeof LOC1): Promise<void> {
  const section = page.getByTestId('company-locations');
  await section.getByRole('button', { name: 'Add location' }).click();
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill(l.name);
  // The sheet renders after the company form: its street field is the last one.
  await page.getByRole('combobox', { name: 'Street and number' }).last().fill(l.street);
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Postal code' }).fill(l.postal);
  await page.getByRole('textbox', { name: 'City' }).fill(l.city);
  await page.getByRole('button', { name: 'Save location' }).click();
  await expect(section.getByTestId('company-location').filter({ hasText: l.name })).toBeVisible();
}

test('event locations: company settings → two saved locations → event at the second → share link → approved status page', async ({
  page,
  flow,
  baseURL,
}) => {
  const email = `flow-loc-${flow.variant}-${Date.now().toString(36)}@plusone.test`;
  const tag = Date.now().toString(36);
  const EVENT = `Offsite ${tag}`;

  // ── Consent → wizard → app (same prelude as company-rename) ───────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(email)}&create=1&next=/onboarding`);
  await page.waitForURL(/\/(consent|onboarding)/);
  if (/\/consent/.test(page.url())) {
    const first = page.getByPlaceholder('First name');
    if (await first.count()) {
      await first.fill('Joeri');
      await page.getByPlaceholder('Last name').fill('Tester');
    }
    await agree(page);
    await page.getByRole('button', { name: /Create account|Agree/i }).first().click();
  }
  await page.waitForURL(/\/onboarding/);
  await clickUntilVisible(page.getByRole('button', { name: /Set up account/i }), page.getByPlaceholder('e.g. LOFI'));
  await page.getByPlaceholder('e.g. LOFI').fill(COMPANY);
  await page.getByRole('button', { name: /^Club$/ }).click();
  await agree(page);
  await page.getByRole('button', { name: 'Create company' }).click();
  const planHeading = page.getByText(/Pick your plan/i).first();
  const skipTeam = page.getByRole('button', { name: /Skip for now/i }).first();
  await expect(planHeading.or(skipTeam)).toBeVisible();
  if (!flow.native && (await planHeading.isVisible())) {
    await page.getByRole('button', { name: /Continue to payment/i }).click();
    await page.getByRole('button', { name: /^Continue$/i }).click();
  }
  await skipTeam.click();
  await page.waitForURL(/\/app/);

  const db = adminClient();
  const userId = (await getUserIdByEmail(email))!;
  const { data: m } = await db.from('venue_memberships').select('venue_id').eq('user_id', userId).single();
  const venueId = (m as { venue_id: string }).venue_id;

  // ── Company settings: company address + two saved locations ──────────────
  await goApp(page, '/app/venue', baseURL);
  await page.getByPlaceholder('Herengracht 1').first().fill(STREET);
  await page.keyboard.press('Escape');
  await page.getByPlaceholder('1000 AA').first().fill(POSTAL);
  await page.getByPlaceholder('Amsterdam').first().fill(CITY);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();

  const section = page.getByTestId('company-locations');
  await flow.check(1, 'Company settings has a Locations section; a new company starts with none', async () => {
    await expect(section.getByText('Locations', { exact: true })).toBeVisible();
    await expect(section.getByText('No saved locations yet.', { exact: false })).toBeVisible();
  });
  await flow.shot('settings-empty');

  await section.getByRole('button', { name: 'Add location' }).click();
  await flow.shot('location-sheet');
  await page.getByRole('button', { name: 'Cancel' }).last().click();
  await addLocation(page, LOC1);
  await addLocation(page, LOC2);

  await flow.check(2, 'Both saved locations are listed with their address, and stored for this company (DB truth)', async () => {
    await expect(section.getByTestId('company-location')).toHaveCount(2);
    await expect(section.getByText(addr(LOC1))).toBeVisible();
    await expect(section.getByText(addr(LOC2))).toBeVisible();
    const { data } = await db
      .from('company_locations')
      .select('name, address_line, postal_code, city')
      .eq('venue_id', venueId)
      .is('archived_at', null)
      .order('created_at');
    expect(data).toEqual([
      { name: LOC1.name, address_line: LOC1.street, postal_code: LOC1.postal, city: LOC1.city },
      { name: LOC2.name, address_line: LOC2.street, postal_code: LOC2.postal, city: LOC2.city },
    ]);
  });
  await flow.shot('settings-two-locations');

  // ── New event: default = first saved location, chip → the second ─────────
  await goApp(page, '/app/events/new', baseURL);
  const locName = page.getByRole('textbox', { name: 'Location name' });
  const locAddress = page.getByRole('combobox', { name: 'Location address' });
  await flow.check(3, 'A new event starts at the first saved location; both are offered as chips', async () => {
    await expect(locName).toHaveValue(LOC1.name);
    await expect(locAddress).toHaveValue(addr(LOC1));
    const chips = page.getByRole('group', { name: 'Saved locations' });
    await expect(chips.getByRole('button', { name: LOC1.name })).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.getByRole('button', { name: LOC2.name })).toBeVisible();
  });
  await page.getByRole('group', { name: 'Saved locations' }).getByRole('button', { name: LOC2.name }).click();
  await flow.check(4, 'Tapping the second location fills its name and address', async () => {
    await expect(locName).toHaveValue(LOC2.name);
    await expect(locAddress).toHaveValue(addr(LOC2));
    await expect(page.getByText('Guests see this on the request link and their status page.')).toBeVisible();
  });
  await page.getByPlaceholder('e.g. FRENZY').fill(EVENT);
  await flow.shot('new-event-second-location');

  if (flow.variant === 'desktop-browser') {
    const date = page.getByLabel('Pick a date').first();
    await date.fill(typedDate(3));
    await date.press('Enter');
    const hour = page.getByLabel('Hour').first();
    await hour.fill('22:00');
    await hour.press('Enter');
    // Guest mail 6c: every event needs its own contact address.
    await page.getByRole('textbox', { name: 'Contact email' }).fill('guests@clubvesper.test');
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page.getByRole('button', { name: 'Add your first tier' })).toBeVisible({ timeout: 20_000 });
  } else {
    const { error } = await db.from('events').insert({
      venue_id: venueId,
      name: EVENT,
      starts_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      landing_active: true,
      landing_slug: `offsite-${tag}-${flow.variant}`,
      location_name: LOC2.name,
      location_address: addr(LOC2),
    });
    expect(error).toBeNull();
  }
  const { data: ev } = await db
    .from('events')
    .select('id, landing_slug, location_name, location_address')
    .eq('venue_id', venueId)
    .eq('name', EVENT)
    .single();
  const event = ev as { id: string; landing_slug: string; location_name: string | null; location_address: string | null };
  await flow.check(5, 'The event stores a copy of the second location (DB truth)', async () => {
    expect([event.location_name, event.location_address]).toEqual([LOC2.name, addr(LOC2)]);
  });

  // ── Share link ─────────────────────────────────────────────────────────────
  await page.goto(new URL(`/e/${event.landing_slug}`, baseURL).toString());
  await flow.check(6, 'The share link shows the event location (name + address), never the company street', async () => {
    await expect(page.getByText(`${LOC2.name}, ${addr(LOC2)}`).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(STREET);
  });
  await flow.shot('share-link');

  await page.getByPlaceholder('First and last name').fill('Guest Gwen');
  await page.getByPlaceholder('you@example.com').fill(`gwen-${tag}-${flow.variant}@example.test`);
  await page.getByPlaceholder('6 12 34 56 78').fill('612345678');
  await page.getByRole('button', { name: 'Request my spot' }).click();
  const statusInput = page.locator('input[readonly][value*="/r/"]');
  await expect(statusInput).toBeVisible({ timeout: 20_000 });
  const statusUrl = await statusInput.inputValue();

  // ── Status page: pending ───────────────────────────────────────────────────
  await page.goto(statusUrl);
  await flow.check(7, 'Status page while pending: the event location, no company address', async () => {
    await expect(page.getByText("You're in the queue.")).toBeVisible();
    await expect(page.getByText(`${LOC2.name}, ${addr(LOC2)}`)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(STREET);
  });
  await flow.shot('status-pending');

  // ── Approve in the app ─────────────────────────────────────────────────────
  // One tier through the helper (the tier screen is not what this flow tests).
  const TIER = `Door list ${tag}`;
  const { error: tierErr } = await db.from('guest_tiers').insert({ event_id: event.id, name: TIER });
  expect(tierErr).toBeNull();
  await goApp(page, `/app/requests?event=${event.id}`, baseURL);
  await page.getByRole('button', { name: /Approve…/ }).first().click();
  // The decision sheet (z8uq9m2vga) starts with the whole request on the
  // event's first tier; this event has only the one, so it is already chosen.
  await expect(page.getByRole('button', { name: `One more on ${TIER}` })).toBeVisible();
  await expect(page.getByTestId('decide-summary')).toHaveText('1 of 1 on the list');
  await flow.shot('approve-sheet');
  await page.getByRole('button', { name: /Add to the list/ }).click();
  await expect
    .poll(async () => {
      const { data } = await db.from('guest_requests').select('status').eq('event_id', event.id).single();
      return (data as { status: string } | null)?.status;
    })
    .toBe('approved');

  // ── Status page: approved ──────────────────────────────────────────────────
  await page.goto(statusUrl);
  await flow.check(8, 'Status page after approval: "You\'re on the list.", the event location, still no company address', async () => {
    await expect(page.getByText("You're on the list.")).toBeVisible();
    await expect(page.getByText(`${LOC2.name}, ${addr(LOC2)}`)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(STREET);
    await expect(page.locator('body')).not.toContainText(POSTAL);
  });
  await flow.shot('status-approved');

  // ── Archive keeps the event's copy ─────────────────────────────────────────
  await goApp(page, '/app/venue', baseURL);
  await page.getByRole('button', { name: `Archive ${LOC2.name}` }).click();
  await flow.shot('archive-confirm');
  await page.getByRole('button', { name: 'Archive location' }).click();
  await flow.check(9, 'Archiving the location removes it from the list, and the event keeps its copy (DB truth)', async () => {
    await expect(section.getByTestId('company-location')).toHaveCount(1);
    const { data } = await db.from('events').select('location_name, location_address').eq('id', event.id).single();
    expect(data).toEqual({ location_name: LOC2.name, location_address: addr(LOC2) });
  });
  await flow.shot('settings-after-archive');

  await flow.check(10, 'No step scrolls sideways', async () => {
    expectNoHorizontalOverflow(flow);
  });
  await flow.check(11, 'No uncaught page errors during the whole walk', async () => {
    expect(flow.pageErrors).toEqual([]);
  });
});
