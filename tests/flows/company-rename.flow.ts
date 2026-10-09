import { test, expect, clickUntilVisible, expectNoHorizontalOverflow } from './harness';
import type { Page } from '@playwright/test';
import { adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: Venue → Company (z8uq9m2vqc), in all four variants. A fresh owner
 * (`/auth/dev-login?create=1`, local stack only) walks the screens the rename
 * touched and the new per-event location:
 *
 *   wizard company step (Type options) → More → Company settings (sets the
 *   company address) → New company → Switch company → New event form (location
 *   placeholders) → Events list cards → event detail → public request page.
 *
 * The seed's manager@ is a user_manager: it can neither open Company settings
 * nor create events, so this flow mints its own owner instead (handoff note in
 * the PR). On the phone/iPad variants the date fields are touch pickers, so the
 * two events are created through the form on the desktop variant only and
 * inserted through the service-role helper elsewhere; every variant then checks
 * what the cards, the detail and /e/[slug] show.
 *
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const COMPANY = 'Club Nova';
const STREET = 'Herengracht 1';
const POSTAL = '1000 AA';
const CITY = 'Amsterdam';
const COMPANY_ADDRESS = `${STREET}, ${POSTAL} ${CITY}`;
const OWN_NAME = 'Paradiso';
const OWN_ADDRESS = 'Weteringschans 6, Amsterdam';
const TYPE_ORDER = ['Club', 'Festival', 'Bar', 'Concert hall', 'Venue', 'Organizer'];

/** Every visible "venue"/"venues", ignoring the "Venue" Type chip itself. */
async function visibleVenueWords(page: Page): Promise<string[]> {
  const text = await page.locator('body').innerText();
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== 'Venue')
    .flatMap((l) => (/\bvenues?\b/i.test(l) ? [l] : []));
}

async function typeOptions(page: Page): Promise<string[]> {
  const re = new RegExp(`^(${TYPE_ORDER.join('|')})$`);
  const texts = await page.getByRole('button', { name: re }).allInnerTexts();
  return texts.map((s) => s.trim());
}

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

test('company rename: wizard → More → Company settings → events with a location → request page', async ({ page, flow, baseURL }) => {
  const email = `flow-co-${flow.variant}-${Date.now().toString(36)}@plusone.test`;
  const tag = Date.now().toString(36);
  const EV_OWN = `Offsite ${tag}`;
  const EV_PLAIN = `Home night ${tag}`;

  // ── Consent → wizard company step ─────────────────────────────────────────
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

  await flow.check(1, 'Wizard company step says "company" (heading, name label, button), never "venue"', async () => {
    await expect(page.getByText('Tell us about your company').first()).toBeVisible();
    await expect(page.getByText('Company name', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create company' })).toBeVisible();
    expect(await visibleVenueWords(page)).toEqual([]);
  });
  await flow.check(2, 'Type (was "Venue type") offers Club, Festival, Bar, Concert hall, Venue, Organizer in that order', async () => {
    await expect(page.getByText('Type', { exact: true }).first()).toBeVisible();
    expect(await typeOptions(page)).toEqual(TYPE_ORDER);
  });
  await page.getByPlaceholder('e.g. LOFI').fill(COMPANY);
  await page.getByRole('button', { name: /^Organizer$/ }).click();
  await agree(page);
  await flow.shot('wizard-company');
  await page.getByRole('button', { name: 'Create company' }).click();

  // Browser: plan + payment; native shell: trial starts silently. Then Team.
  const planHeading = page.getByText(/Pick your plan/i).first();
  const skipTeam = page.getByRole('button', { name: /Skip for now/i }).first();
  await expect(planHeading.or(skipTeam)).toBeVisible();
  if (!flow.native && (await planHeading.isVisible())) {
    await page.getByRole('button', { name: /Continue to payment/i }).click();
    await page.getByRole('button', { name: /^Continue$/i }).click();
  }
  await skipTeam.click();
  await page.waitForURL(/\/app/);

  // ── More → Company settings ───────────────────────────────────────────────
  await goApp(page, '/app/more', baseURL);
  await flow.check(3, 'More shows the "Company settings" row (and on phone the "… · company settings" card), no "venue" anywhere', async () => {
    await expect(page.getByText('Company settings', { exact: true }).first()).toBeVisible();
    if (flow.variant.startsWith('phone')) await expect(page.getByText(/· company settings$/).first()).toBeVisible();
    expect(await visibleVenueWords(page)).toEqual([]);
  });
  await flow.shot('more');

  await goApp(page, '/app/venue', baseURL);
  await flow.check(4, 'Company settings: title, "Company name", "Business details" / "Legal name", no "venue"', async () => {
    await expect(page.getByText('Company settings').first()).toBeVisible();
    await expect(page.getByText('Company name', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Business details').first()).toBeVisible();
    await expect(page.getByText('Legal name', { exact: true }).first()).toBeVisible();
    expect(await visibleVenueWords(page)).toEqual([]);
  });
  // Give the company a street address: the fallback every event without its
  // own location shows.
  await page.getByPlaceholder('Herengracht 1').fill(STREET);
  await page.getByPlaceholder('1000 AA').fill(POSTAL);
  await page.getByPlaceholder('Amsterdam').fill(CITY);
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await flow.shot('company-settings');

  // ── New company + Switch company ──────────────────────────────────────────
  await goApp(page, '/app/venue/new', baseURL);
  await flow.check(5, 'New company: title, "Company name", Type with the six options in order, "Create company"', async () => {
    await expect(page.getByText('New company').first()).toBeVisible();
    await expect(page.getByText('Company name', { exact: true }).first()).toBeVisible();
    expect(await typeOptions(page)).toEqual(TYPE_ORDER);
    await expect(page.getByRole('button', { name: 'Create company' })).toBeVisible();
    expect(await visibleVenueWords(page)).toEqual([]);
  });
  await flow.shot('new-company');

  await goApp(page, '/app/venue/switch', baseURL);
  await flow.check(6, 'Switch company: "Companies", "Your companies · 1", "Add a new company", no "venue"', async () => {
    await expect(page.getByText('Companies').first()).toBeVisible();
    await expect(page.getByText('Your companies · 1').first()).toBeVisible();
    await expect(page.getByText('Add a new company').first()).toBeVisible();
    expect(await visibleVenueWords(page)).toEqual([]);
  });
  await flow.shot('switch-company');

  // ── New event with a location ─────────────────────────────────────────────
  await goApp(page, '/app/events/new', baseURL);
  const locName = page.getByRole('textbox', { name: 'Location name' });
  const locAddress = page.getByRole('combobox', { name: 'Location address' });
  // z8uq9m444c: no saved locations yet, so a new event starts at the company
  // itself (name + address), as a copy the form saves.
  await flow.check(7, 'New event: no "Company" field (always the active company), and the location starts at the company name + address', async () => {
    await expect(page.getByText('Company', { exact: true })).toHaveCount(0);
    await expect(locName).toHaveValue(COMPANY);
    await expect(locAddress).toHaveValue(COMPANY_ADDRESS);
    expect(await visibleVenueWords(page)).toEqual([]);
  });
  await page.getByPlaceholder('e.g. FRENZY').fill(EV_OWN);
  await locName.fill(OWN_NAME);
  await locAddress.fill(OWN_ADDRESS);
  await flow.shot('new-event-location');

  const db = adminClient();
  const userId = await getUserIdByEmail(email);
  const { data: m } = await db.from('venue_memberships').select('venue_id').eq('user_id', userId!).single();
  const venueId = (m as { venue_id: string }).venue_id;

  if (flow.variant === 'desktop-browser') {
    await flow.check(8, 'Saving the form writes the location to the event (DB truth)', async () => {
      const date = page.getByLabel('Pick a date').first();
      await date.fill(typedDate(3));
      await date.press('Enter');
      const hour = page.getByLabel('Hour').first();
      await hour.fill('22:00');
      await hour.press('Enter');
      await page.getByRole('button', { name: 'Create event' }).click();
      await expect(page.getByRole('button', { name: 'Add your first tier' })).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(async () => {
          const { data } = await db.from('events').select('location_name, location_address').eq('name', EV_OWN).maybeSingle();
          return data ? `${data.location_name}|${data.location_address}` : null;
        })
        .toBe(`${OWN_NAME}|${OWN_ADDRESS}`);
    });
    // Created from a TEMPLATE (follow-up fix): the template RPC takes no
    // location, so the form writes it in a second step. Prod showed it lost.
    await flow.check(16, 'An event created from a template keeps a location typed in the form (DB truth)', async () => {
      const TPL = `Tpl ${tag}`;
      const EV_TPL = `Template night ${tag}`;
      // With a tier, like a real template: the form then lands on the event
      // detail instead of the guided tiers step.
      const { data: tpl, error: tplErr } = await db.from('event_templates').insert({ venue_id: venueId, name: TPL }).select('id').single();
      expect(tplErr).toBeNull();
      const { error: tierErr } = await db
        .from('event_template_tiers')
        .insert({ template_id: (tpl as { id: string }).id, venue_id: venueId, name: 'Guest' });
      expect(tierErr).toBeNull();
      await goApp(page, '/app/events/new', baseURL);
      await page.getByRole('button', { name: TPL }).click();
      await page.getByPlaceholder('e.g. FRENZY').fill(EV_TPL);
      await page.getByRole('textbox', { name: 'Location name' }).fill(OWN_NAME);
      await page.getByRole('combobox', { name: 'Location address' }).fill(OWN_ADDRESS);
      const date = page.getByLabel('Pick a date').first();
      await date.fill(typedDate(5));
      await date.press('Enter');
      const hour = page.getByLabel('Hour').first();
      await hour.fill('22:00');
      await hour.press('Enter');
      await page.getByRole('button', { name: 'Create event' }).click();
      await page.waitForURL(/\/app\/events\/[^/]+/);
      await expect
        .poll(async () => {
          const { data } = await db.from('events').select('location_name, location_address').eq('name', EV_TPL).maybeSingle();
          return data ? `${data.location_name}|${data.location_address}` : null;
        })
        .toBe(`${OWN_NAME}|${OWN_ADDRESS}`);
      await expect(page.getByText("the location didn't save")).toHaveCount(0);
      await flow.shot('template-event-location');
    });
  } else {
    flow.skip(8, 'Saving the form writes the location to the event (DB truth) — desktop variant only');
    flow.skip(16, 'An event created from a template keeps a location typed in the form (DB truth) — desktop variant only');
    const startsAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const { error } = await db.from('events').insert({
      venue_id: venueId,
      name: EV_OWN,
      starts_at: startsAt,
      landing_active: true,
      landing_slug: `offsite-${tag}-${flow.variant}`,
      location_name: OWN_NAME,
      location_address: OWN_ADDRESS,
    });
    expect(error).toBeNull();
  }
  {
    const startsAt = new Date(Date.now() + 4 * 86_400_000).toISOString();
    const { error } = await db.from('events').insert({
      venue_id: venueId,
      name: EV_PLAIN,
      starts_at: startsAt,
      landing_active: true,
      landing_slug: `home-${tag}-${flow.variant}`,
    });
    expect(error).toBeNull();
  }
  const { data: evs } = await db.from('events').select('id, name, landing_slug').eq('venue_id', venueId);
  const own = (evs ?? []).find((e) => e.name === EV_OWN)!;
  const plain = (evs ?? []).find((e) => e.name === EV_PLAIN)!;

  // ── Save as template keeps the location (20261007135000) ─────────────────
  if (flow.variant === 'desktop-browser') {
    await flow.check(17, 'Save as template keeps the location: the template prefills it and a new event gets it (DB truth)', async () => {
      const TPL2 = `From offsite ${tag}`;
      const EV_FROM = `From template ${tag}`;
      await goApp(page, `/app/events/${own.id}/edit`, baseURL);
      await page.getByRole('button', { name: 'Save as template' }).click();
      await page.getByPlaceholder('Template name, e.g. "Lofi, open air"').fill(TPL2);
      await page.getByRole('button', { name: 'Save template' }).click();
      await expect(page.getByText(`"${TPL2}" is saved.`)).toBeVisible();
      await expect
        .poll(async () => {
          const { data } = await db.from('event_templates').select('location_name, location_address').eq('name', TPL2).maybeSingle();
          return data ? `${data.location_name}|${data.location_address}` : null;
        })
        .toBe(`${OWN_NAME}|${OWN_ADDRESS}`);

      await goApp(page, '/app/events/new', baseURL);
      await page.getByRole('button', { name: TPL2 }).click();
      await expect(page.getByRole('textbox', { name: 'Location name' })).toHaveValue(OWN_NAME);
      await expect(page.getByRole('combobox', { name: 'Location address' })).toHaveValue(OWN_ADDRESS);
      await flow.shot('template-prefill');
      await page.getByPlaceholder('e.g. FRENZY').fill(EV_FROM);
      const date = page.getByLabel('Pick a date').first();
      await date.fill(typedDate(6));
      await date.press('Enter');
      const hour = page.getByLabel('Hour').first();
      await hour.fill('22:00');
      await hour.press('Enter');
      await page.getByRole('button', { name: 'Create event' }).click();
      await page.waitForURL(/\/app\/events\/[^/]+/);
      await expect
        .poll(async () => {
          const { data } = await db.from('events').select('location_name, location_address').eq('name', EV_FROM).maybeSingle();
          return data ? `${data.location_name}|${data.location_address}` : null;
        })
        .toBe(`${OWN_NAME}|${OWN_ADDRESS}`);
    });
  } else {
    flow.skip(17, 'Save as template keeps the location — desktop variant only');
  }

  // ── Cards, detail ─────────────────────────────────────────────────────────
  await goApp(page, '/app/events', baseURL);
  await flow.check(9, 'Events cards: own location on one, the company address on the other', async () => {
    await expect(page.locator('button', { hasText: EV_OWN }).first()).toContainText(`· ${OWN_NAME}`);
    await expect(page.locator('button', { hasText: EV_PLAIN }).first()).toContainText(`· ${COMPANY_ADDRESS}`);
  });
  await flow.shot('events-cards');

  await goApp(page, `/app/events/${own.id}`, baseURL);
  await flow.check(10, 'Event detail with its own location shows name · address', async () => {
    await expect(page.getByTestId('event-location')).toHaveText(`${OWN_NAME} · ${OWN_ADDRESS}`);
  });
  await flow.shot('event-detail-own');

  await goApp(page, `/app/events/${plain.id}`, baseURL);
  await flow.check(11, 'Event detail without a location shows the company (name · address)', async () => {
    await expect(page.getByTestId('event-location')).toHaveText(`${COMPANY} · ${COMPANY_ADDRESS}`);
  });
  await flow.shot('event-detail-company');

  // ── Public request page ───────────────────────────────────────────────────
  await page.goto(new URL(`/e/${own.landing_slug}`, baseURL).toString());
  await flow.check(12, '/e/[slug] of the event with a location shows that location', async () => {
    await expect(page.getByText(`${OWN_NAME}, ${OWN_ADDRESS}`).first()).toBeVisible();
    expect(await visibleVenueWords(page)).toEqual([]);
  });
  await flow.shot('request-page-own');

  await page.goto(new URL(`/e/${plain.landing_slug}`, baseURL).toString());
  await flow.check(13, '/e/[slug] without a location shows the company name, never the company street (spec #48(c))', async () => {
    await expect(page.getByText(COMPANY).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(STREET);
  });
  await flow.shot('request-page-company');

  await flow.check(14, 'No step scrolls sideways', async () => {
    expectNoHorizontalOverflow(flow);
  });
  await flow.check(15, 'No uncaught page errors during the whole walk', async () => {
    expect(flow.pageErrors).toEqual([]);
  });
});

