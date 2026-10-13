import pg from 'pg';
import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: info for guests + the live Google Calendar link (z8uq9m4a5n; decision
 * Max 2026-10-11), in all four variants.
 *
 *   admin@ → the event's edit screen: one "For your guests" block with House
 *   rules + "Info for guests" (empty, with hints) → type a location and multi-line info → Save → add a guest with an
 *   email → Mailpit: "Good to know" with the text, the Google link points at
 *   /s/[token]/google → the location changes AFTER the mail → that link
 *   redirects to Google with the NEW location and the details → the status
 *   page shows "Good to know" → editing only the info queues no "New
 *   details" mail → a made-up token gets the bare 404 → Save as template
 *   keeps both texts → a new event from that template starts with both and
 *   (desktop) saves them (z8uq9m4pnk).
 *
 * Each variant creates its own event (stamped name), so the runs never share
 * one.
 *
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const ADMIN = 'admin@plusone.test';
const VENUE = 'aa000000-0000-7000-8000-000000000001';
const MAILPIT = process.env.INBUCKET_URL || 'http://127.0.0.1:55324';
// The queue grants no app role anything (not even service_role): read it as owner, like mail-status.flow.ts.
const PGURL = process.env.PGURL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

async function eventChangedMails(eventId: string): Promise<number> {
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  try {
    const r = await client.query(
      `select count(*)::int as n from public.guest_mail_queue where event_id = $1 and type = 'guest_event_changed'`,
      [eventId],
    );
    return r.rows[0].n as number;
  } finally {
    await client.end();
  }
}
const INFO = 'Park at P2.\nEntrance on the side street.';
// House rules share the block (z8uq9m4a5n follow-up) and follow the info in the calendar.
const RULES = '21+, bring ID.';
const DETAILS = `${INFO}\n\nHouse rules:\n${RULES}`;
const PLACE = 'Club Vesper';
const ADDRESS = 'Keizersgracht 1, Amsterdam';
const MOVED = 'Paradiso, Weteringschans 6';

/** dd-mm-yyyy, `daysAhead` from today: what the date field takes when typed. */
function typedDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

/** The newest mail Mailpit caught for `email`, polled (the drain runs after the response). */
async function latestMailTo(email: string): Promise<{ text: string; html: string } | null> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=100`);
    const list =
      ((await res.json()) as { messages?: Array<{ ID: string; To?: Array<{ Address: string }> }> }).messages ?? [];
    const hit = list.find((m) => (m.To ?? []).some((t) => t.Address.toLowerCase() === email));
    if (hit) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as { Text?: string; HTML?: string };
      // Mailpit keeps the wire format's CRLF line endings.
      return { text: (full.Text ?? '').replace(/\r\n/g, '\n'), html: full.HTML ?? '' };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const id = await getUserIdByEmail(ADMIN);
  const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
  if (error) throw new Error(`guest-info setup: ${error.message}`);
});

// Each variant hits the throttled status read ~8 times from the same local IP
// (st: 30 per 15 min, the budget /s, /r and the .ics share): start each one
// with a fresh budget, as landing-request.spec.ts does for its prefix.
test.beforeEach(async () => {
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  try {
    await client.query(`delete from public.landing_request_throttle where ip_hash like 'st:%'`);
  } finally {
    await client.end();
  }
});

test('guest info: form → mail "Good to know" → live Google link → status page → no extra mail', async ({ page, flow }) => {
  const stamp = Date.now().toString(36);
  const eventName = `Info ${flow.variant.split('-')[0]} ${stamp}`;
  const guestEmail = `gi-guest-${flow.variant}-${stamp}@plusone.test`;

  const startsAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const { data: created, error } = await adminClient()
    .from('events')
    .insert({ venue_id: VENUE, name: eventName, starts_at: startsAt, contact_email: 'guests@clubvesper.test', landing_slug: `gi-${stamp}-${flow.variant}` } as never)
    .select('id')
    .single();
  if (error) throw new Error(`guest-info fixture: ${error.message}`);
  const eventId = (created as { id: string }).id;
  const { error: tierError } = await adminClient()
    .from('guest_tiers')
    .insert({ event_id: eventId, name: 'Regular', color: '#8A8A93', aliases: [] });
  if (tierError) throw new Error(`guest-info tier: ${tierError.message}`);

  // ── Edit: the "For your guests" block ─────────────────────────────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/events/${eventId}/edit`);
  const block = page.getByRole('region', { name: 'For your guests' });
  const rules = block.getByRole('textbox', { name: 'House rules (optional)' });
  const info = block.getByRole('textbox', { name: 'Info for guests (optional)' });
  await expect(info).toBeVisible({ timeout: 20_000 });
  await flow.check(1, 'One "For your guests" block holds House rules and Info for guests, empty, each with its hint, both ≥44px tall', async () => {
    await expect(rules).toHaveValue('');
    await expect(info).toHaveValue('');
    await expect(block.getByText('Rules at the door, like age, ID or dress code.', { exact: false })).toBeVisible();
    await expect(block.getByText('Practical stuff like parking, the entrance or the cloakroom.', { exact: false })).toBeVisible();
    for (const box of [await rules.boundingBox(), await info.boundingBox()]) {
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    // House rules come first, the info under it.
    expect((await rules.boundingBox())!.y).toBeLessThan((await info.boundingBox())!.y);
  });

  await page.getByRole('textbox', { name: 'Location name' }).fill(PLACE);
  await page.getByRole('combobox', { name: 'Location address' }).fill(ADDRESS);
  await page.keyboard.press('Escape');
  await rules.fill(RULES);
  await info.fill(INFO);
  await block.scrollIntoViewIfNeeded();
  await flow.shot('edit-info-for-guests');
  await page.getByRole('button', { name: 'Save event' }).click();
  await flow.check(2, 'One Save stores the house rules, the info (line breaks kept) and the location (DB truth)', async () => {
    await expect
      .poll(async () => (await adminClient().from('events').select('house_rules, guest_info, location_name').eq('id', eventId).single()).data)
      .toEqual({ house_rules: RULES, guest_info: INFO, location_name: PLACE });
  });

  // ── Add a guest with an email ─────────────────────────────────────────────
  await page.goto(`/app/events/${eventId}/add`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByPlaceholder('e.g. "John Doe +2 vip"').fill(`Robin ${stamp}`);
  const tierPick = page.getByRole('button', { name: /^Regular/ }).first();
  if (await tierPick.isVisible().catch(() => false)) await tierPick.click();
  await page.getByPlaceholder('Email (optional)').fill(guestEmail);
  await page.getByRole('button', { name: new RegExp(`^Add · Robin ${stamp}`) }).click();
  await expect(page.getByText(/Just added/).first()).toBeVisible();

  const mail = await latestMailTo(guestEmail);
  await flow.check(3, 'Mailpit: "You\'re on the list" has a "Good to know" block with the text, line by line', async () => {
    expect(mail).not.toBeNull();
    expect(mail?.text).toContain(`Good to know:\n${INFO}`);
    expect(mail?.html).toContain('Park at P2.<br>Entrance on the side street.');
  });
  const google = /https?:\/\/[^\s]+(\/s\/[A-Za-z0-9_-]{43}\/google)(?=\s|$)/.exec(mail?.text ?? '')?.[1] ?? null;
  await flow.check(4, 'The mail\'s Google Calendar link is the live /s/[token]/google route, not a frozen Google URL', async () => {
    expect(google).not.toBeNull();
    expect(mail?.text).not.toContain('calendar.google.com');
    expect(mail?.html).not.toContain('calendar.google.com');
  });

  // The location moves AFTER the mail went out: the link must follow it.
  await adminClient().from('events').update({ location_name: 'Paradiso', location_address: 'Weteringschans 6' }).eq('id', eventId);
  await page.context().clearCookies();
  await flow.check(5, '/s/[token]/google answers 302 to Google with the CURRENT location and details = info + house rules, no token in it', async () => {
    const res = await page.request.get(google ?? '/s/missing/google', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const to = new URL(res.headers()['location'] ?? '');
    expect(to.origin).toBe('https://calendar.google.com');
    expect(to.searchParams.get('location')).toBe(MOVED);
    expect(to.searchParams.get('details')).toBe(DETAILS);
    expect(to.searchParams.get('text')).toBe(eventName);
    expect(to.toString()).not.toContain(google?.split('/')[2] ?? 'x');
    expect(res.headers()['referrer-policy']).toBe('no-referrer');
  });

  // ── Status page ───────────────────────────────────────────────────────────
  const statusPath = google?.replace(/\/google$/, '') ?? '/s/missing';
  await page.goto(statusPath);
  await page.waitForLoadState('networkidle').catch(() => {});
  await flow.shot('status-page-good-to-know');
  await flow.check(6, 'The status page shows "Good to know" with the text and the new location', async () => {
    const block = page.getByTestId('guest-status-info');
    await expect(block).toBeVisible();
    await expect(block).toContainText('Good to know');
    await expect(block).toContainText('Entrance on the side street.');
    await expect(page.getByText(MOVED)).toBeVisible();
  });
  await flow.check(7, 'The .ics DESCRIPTION carries the info, then the house rules (escaped)', async () => {
    const body = (await (await page.request.get(`${statusPath}/calendar.ics`)).text()).replace(/\r\n /g, '');
    expect(body).toContain('DESCRIPTION:Park at P2.\\nEntrance on the side street.\\n\\nHouse rules:\\n21+\\, bring ID.');
  });

  // ── Editing only the info sends no mail ───────────────────────────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/events/${eventId}/edit`);
  const info2 = page.getByRole('textbox', { name: 'Info for guests (optional)' });
  await expect(info2).toHaveValue(INFO, { timeout: 20_000 });
  await info2.fill('Cloakroom by the bar.');
  await page.getByRole('button', { name: 'Save event' }).click();
  await flow.check(8, 'Changing only the info saves, queues no "New details" mail, and the live link picks it up', async () => {
    await expect
      .poll(async () => (await adminClient().from('events').select('guest_info').eq('id', eventId).single()).data?.guest_info)
      .toBe('Cloakroom by the bar.');
    expect(await eventChangedMails(eventId)).toBe(0);
    const res = await page.request.get(google ?? '/s/missing/google', { maxRedirects: 0 });
    expect(new URL(res.headers()['location'] ?? '').searchParams.get('details')).toBe(`Cloakroom by the bar.\n\nHouse rules:\n${RULES}`);
  });

  await flow.check(9, 'A made-up token on /google gets the same bare 404 as the .ics, no redirect', async () => {
    const fake = `/s/${'x'.repeat(43)}`;
    const g = await page.request.get(`${fake}/google`, { maxRedirects: 0 });
    const i = await page.request.get(`${fake}/calendar.ics`, { maxRedirects: 0 });
    expect(g.status()).toBe(404);
    expect(g.headers()['location']).toBeUndefined();
    expect(await g.text()).toBe(await i.text());
  });

  // ── Templates keep both texts (z8uq9m4pnk) ────────────────────────────────
  const TPL = `Info tpl ${flow.variant} ${stamp}`;
  const FROM_TPL = `From tpl ${flow.variant.split('-')[0]} ${stamp}`;
  const INFO2 = 'Cloakroom by the bar.';
  await page.goto(`/app/events/${eventId}/edit`);
  await page.getByRole('button', { name: 'Save as template' }).click();
  await page.getByPlaceholder('Template name, e.g. "Lofi, open air"').fill(TPL);
  await page.getByRole('button', { name: 'Save template' }).click();
  await flow.check(11, 'Save as template keeps the house rules AND the info for guests (DB truth)', async () => {
    await expect(page.getByText(`"${TPL}" is saved.`)).toBeVisible();
    await expect
      .poll(async () => (await adminClient().from('event_templates').select('house_rules, guest_info').eq('name', TPL).maybeSingle()).data)
      .toEqual({ house_rules: RULES, guest_info: INFO2 });
  });

  await page.goto('/app/events/new');
  await page.waitForLoadState('networkidle').catch(() => {});
  // The picker shows 4 templates (name-sorted) until "Show all"; other runs add theirs.
  const chip = page.getByRole('button', { name: TPL });
  await expect(page.getByRole('button', { name: 'Blank event' })).toBeVisible({ timeout: 20_000 });
  if (!(await chip.isVisible())) await page.getByRole('button', { name: /^Show all/ }).click();
  await chip.click();
  const newBlock = page.getByRole('region', { name: 'For your guests' });
  await flow.check(12, 'A new event from that template starts with both texts in the "For your guests" block', async () => {
    await expect(newBlock.getByRole('textbox', { name: 'House rules (optional)' })).toHaveValue(RULES);
    await expect(newBlock.getByRole('textbox', { name: 'Info for guests (optional)' })).toHaveValue(INFO2);
  });
  await newBlock.scrollIntoViewIfNeeded();
  await flow.shot('template-prefills-guest-texts');
  // The create itself goes through the typeable date field, so desktop only
  // (as in event-contact / company-rename); the RPC path is pgTAP-proven.
  if (flow.variant === 'desktop-browser') {
    await flow.check(13, 'Creating it saves both texts on the new event (DB truth)', async () => {
      await page.getByPlaceholder('e.g. FRENZY').fill(FROM_TPL);
      const date = page.getByLabel('Pick a date').first();
      await date.fill(typedDate(6));
      await date.press('Enter');
      const hour = page.getByLabel('Hour').first();
      await hour.fill('22:00');
      await hour.press('Enter');
      await page.getByRole('textbox', { name: 'Contact email' }).fill('guests@clubvesper.test');
      await page.getByRole('button', { name: 'Create event' }).click();
      await page.waitForURL(/\/app\/events\/[^/]+/);
      await expect
        .poll(async () => (await adminClient().from('events').select('house_rules, guest_info').eq('name', FROM_TPL).maybeSingle()).data)
        .toEqual({ house_rules: RULES, guest_info: INFO2 });
    });
  } else {
    flow.skip(13, 'Creating from the template saves both texts — desktop variant only');
  }

  await flow.check(10, 'No sideways scroll and no uncaught page errors', async () => {
    await expectNoHorizontalOverflow(flow);
    expect(flow.pageErrors).toEqual([]);
  });
});
