import { test, expect, expectNoHorizontalOverflow } from './harness';
import type { Page } from '@playwright/test';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: Gastcommunicatie F, PR 6c (z8uq9m2vpy): a contact address per event,
 * in all four variants.
 *
 *   admin@ → New event: the "Contact email" field is empty (never pre-filled)
 *   and says what guests see → Create without it: refused → a domain that
 *   takes no mail (@….invalid): refused → a real address: the event exists
 *   with it → edit shows it, a change saves → a guest added with an email
 *   gets "You're on the list" with reply-to + footer = the EVENT address.
 *
 * Each variant creates its own event (a stamped name), so the four runs never
 * share one; the company contact is left alone (guest-mail.flow.ts covers the
 * company fallback on the seed event).
 *
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const ADMIN = 'admin@plusone.test';
const VENUE = 'aa000000-0000-7000-8000-000000000001';
const MAILPIT = process.env.INBUCKET_URL || 'http://127.0.0.1:55324';

function typedDate(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

async function fillNameAndStart(page: Page, name: string): Promise<void> {
  await page.getByPlaceholder('e.g. FRENZY').fill(name);
  const date = page.getByLabel('Pick a date').first();
  await date.fill(typedDate(5));
  await date.press('Enter');
  const hour = page.getByLabel('Hour').first();
  await hour.fill('22:00');
  await hour.press('Enter');
}

async function eventIdByName(name: string): Promise<string | null> {
  const { data } = await adminClient().from('events').select('id').eq('venue_id', VENUE).eq('name', name).maybeSingle();
  return data?.id ?? null;
}

/** The newest mail Mailpit caught for `email`, polled (the drain runs after the response). */
async function latestMailTo(email: string): Promise<{ text: string; replyTo: string[] } | null> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=100`);
    const list =
      ((await res.json()) as { messages?: Array<{ ID: string; To?: Array<{ Address: string }> }> }).messages ?? [];
    const hit = list.find((m) => (m.To ?? []).some((t) => t.Address.toLowerCase() === email));
    if (hit) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as {
        Text?: string;
        ReplyTo?: Array<{ Address: string }>;
      };
      return { text: full.Text ?? '', replyTo: (full.ReplyTo ?? []).map((r) => r.Address) };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const id = await getUserIdByEmail(ADMIN);
  const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
  if (error) throw new Error(`event-contact setup: ${error.message}`);
});

test('event contact: required, not pre-filled, domain-checked, used by guest mail', async ({ page, flow }) => {
  const stamp = Date.now().toString(36);
  const eventName = `Contact ${flow.variant.split('-')[0]} ${stamp}`;
  const eventAddress = `night-${flow.variant}-${stamp}@clubvesper.test`;
  const changedAddress = `promo-${flow.variant}-${stamp}@clubvesper.test`;
  const guestEmail = `ec-guest-${flow.variant}-${stamp}@plusone.test`;

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/events/new`);
  await page.waitForURL(/\/app\/events\/new/);
  const field = page.getByRole('textbox', { name: 'Contact email' });
  await expect(field).toBeVisible();
  await field.scrollIntoViewIfNeeded();
  await flow.shot('new-event-contact-field');

  await flow.check(1, 'New event: "Contact email" is empty (never pre-filled) and says guests see it and reply to it', async () => {
    await expect(field).toHaveValue('');
    await expect(page.getByText('Guests see this address in every email about this event. Their replies come here.')).toBeVisible();
  });

  // The form create runs where the date field takes typing (desktop); on touch
  // the date is a picker sheet, so the other variants start from an event made
  // as a fixture (with its own address) and check the rest of the path.
  let eventId: string | null;
  if (flow.variant === 'desktop-browser') {
    await fillNameAndStart(page, eventName);
    await page.getByRole('button', { name: 'Create event' }).click();
    await flow.check(2, 'Create without a contact email: "Add a contact email for guests." and no event', async () => {
      await expect(page.getByText('Add a contact email for guests.')).toBeVisible();
      expect(await eventIdByName(eventName)).toBeNull();
    });

    await field.fill('guests@nomail.invalid');
    await page.getByRole('button', { name: 'Create event' }).click();
    await flow.shot('no-mail-domain');
    await flow.check(3, 'A domain that takes no mail: the domain error, still no event', async () => {
      await expect(page.getByText("That email domain doesn't take mail. Check the part after the @.")).toBeVisible();
      expect(await eventIdByName(eventName)).toBeNull();
    });

    await field.fill(eventAddress);
    await page.getByRole('button', { name: 'Create event' }).click();
    await expect(page.getByRole('button', { name: 'Add your first tier' })).toBeVisible({ timeout: 20_000 });
    eventId = await eventIdByName(eventName);
    await flow.check(4, 'A real address: the event is created with it (DB truth)', async () => {
      expect(eventId).not.toBeNull();
      const { data } = await adminClient().from('events').select('contact_email').eq('id', eventId ?? '').single();
      expect(data?.contact_email).toBe(eventAddress);
    });
  } else {
    const startsAt = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const { data, error } = await adminClient()
      .from('events')
      .insert({ venue_id: VENUE, name: eventName, starts_at: startsAt, contact_email: eventAddress, landing_slug: `ec-${stamp}-${flow.variant}` } as never)
      .select('id')
      .single();
    if (error) throw new Error(`event-contact fixture: ${error.message}`);
    eventId = (data as { id: string }).id;
  }

  // Edit: the field shows the stored address; a change saves.
  await page.goto(`/app/events/${eventId}/edit`);
  const editField = page.getByRole('textbox', { name: 'Contact email' });
  await expect(editField).toHaveValue(eventAddress);
  await editField.scrollIntoViewIfNeeded();
  await flow.shot('edit-event-contact');
  await editField.fill(changedAddress);
  await page.getByRole('button', { name: 'Save event' }).click();
  await flow.check(5, 'Edit shows the stored address, and a changed one saves (DB truth)', async () => {
    await expect
      .poll(async () => (await adminClient().from('events').select('contact_email').eq('id', eventId ?? '').single()).data?.contact_email)
      .toBe(changedAddress);
  });

  // A tier to add a guest on (the tier step itself is another flow's subject).
  const { error: tierError } = await adminClient()
    .from('guest_tiers')
    .insert({ event_id: eventId ?? '', name: 'Regular', color: '#8A8A93', aliases: [] });
  if (tierError) throw new Error(`event-contact tier: ${tierError.message}`);

  await page.goto(`/app/events/${eventId}/add`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.getByPlaceholder('e.g. "John Doe +2 vip"').fill(`Mila ${stamp}`);
  const tierPick = page.getByRole('button', { name: /^Regular/ }).first();
  if (await tierPick.isVisible().catch(() => false)) await tierPick.click();
  await page.getByPlaceholder('Email (optional)').fill(guestEmail);
  await page.getByRole('button', { name: new RegExp(`^Add · Mila ${stamp}`) }).click();
  await expect(page.getByText(/Just added/).first()).toBeVisible();

  const mail = await latestMailTo(guestEmail);
  await flow.check(6, 'The guest mail uses the EVENT address: reply-to and footer', async () => {
    expect(mail).not.toBeNull();
    expect(mail?.replyTo).toEqual([changedAddress]);
    expect(mail?.text).toContain(`at ${changedAddress}, or reply to this email.`);
  });

  await flow.check(7, 'No sideways scroll and no uncaught page errors', async () => {
    await expectNoHorizontalOverflow(flow);
    expect(flow.pageErrors).toEqual([]);
  });
});
