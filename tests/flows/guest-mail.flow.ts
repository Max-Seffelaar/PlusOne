import { test, expect, expectNoHorizontalOverflow } from './harness';
import type { Page } from '@playwright/test';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: Gastcommunicatie F, PR 6a (z8uq9m2vpy), in all four variants.
 *
 *   admin@ → Company settings → Guest contact (sets the contact email)
 *   → the seed event's Add guest → name +1 with an email, "Send confirmation"
 *     on by default → Mailpit: "You're on the list for …" (copy v3, the +1 in
 *     people, the contact address in the footer)
 *   → the mail's "Check your status" link → /s/[token] (public, no session)
 *     + its .ics → the mail's unsubscribe link → /u/[token]: GET only asks,
 *     the button opts out, the guest stays on the list.
 *
 * Mail arrives through the stub provider's Mailpit hand-off (local stack
 * only), drained in after() by the add action: no cron involved. Each variant
 * adds its own guest, so the four runs never share a mail.
 *
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const ADMIN = 'admin@plusone.test';
const EVENT = 'ee000000-0000-7000-8000-000000000001';
const EVENT_NAME = 'PLUSONE Launch Night';
const CONTACT = 'guests@clubvesper.test';
const MAILPIT = process.env.INBUCKET_URL || 'http://127.0.0.1:55324';

interface CaughtMail {
  subject: string;
  text: string;
  html: string;
  replyTo: string[];
}

/** The newest mail Mailpit caught for `email`, polled (the drain runs after the response). */
async function latestMailTo(email: string): Promise<CaughtMail | null> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=100`);
    const list =
      ((await res.json()) as { messages?: Array<{ ID: string; Subject: string; To?: Array<{ Address: string }> }> })
        .messages ?? [];
    const hit = list.find((m) => (m.To ?? []).some((t) => t.Address.toLowerCase() === email));
    if (hit) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as {
        Text?: string;
        HTML?: string;
        ReplyTo?: Array<{ Address: string }>;
      };
      return {
        subject: hit.Subject,
        text: full.Text ?? '',
        html: full.HTML ?? '',
        replyTo: (full.ReplyTo ?? []).map((r) => r.Address),
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** The path of the first link in `text` that starts with `/prefix/`. */
function linkPath(text: string, prefix: 's' | 'u'): string | null {
  const m = new RegExp(`https?://[^\\s]+(/${prefix}/[A-Za-z0-9_-]{43})(?=[\\s]|$)`).exec(text);
  return m ? m[1] : null;
}

async function goApp(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle').catch(() => {});
}

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const id = await getUserIdByEmail(ADMIN);
  const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
  if (error) throw new Error(`guest-mail setup: ${error.message}`);
  // Start without a contact address, so Q1 really saves one (a rerun would
  // otherwise find the box already filled and the button disabled).
  const reset = await adminClient()
    .from('venues')
    .update({ contact_email: null })
    .eq('id', 'aa000000-0000-7000-8000-000000000001');
  if (reset.error) throw new Error(`guest-mail setup: ${reset.error.message}`);
});

test('guest mail: contact → add with confirmation → mail → status page → .ics → opt-out', async ({ page, flow }) => {
  const tag = `${flow.variant}-${Date.now().toString(36)}`;
  const guestEmail = `flow-guest-${tag}@plusone.test`;
  // Unique per run: a name already on the list hides the email field (the
  // duplicate prompt takes over), so the run stamp goes into the name.
  const guestName = `Lotte ${flow.variant.split('-')[0]} ${Date.now().toString(36)}`;

  // ── Company settings → Guest contact ──────────────────────────────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/venue`);
  await page.waitForURL(/\/app\/venue/);
  const card = page.getByTestId('guest-contact');
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  await flow.shot('company-guest-contact');

  await flow.check(1, 'Company settings → Guest contact saves the contact email', async () => {
    const field = card.getByRole('textbox', { name: 'Contact email' });
    await field.fill(CONTACT);
    await card.getByRole('button', { name: 'Save contact' }).click();
    await expect(card.getByText('Contact saved.')).toBeVisible();
    const { data } = await adminClient().from('venues').select('contact_email').eq('id', 'aa000000-0000-7000-8000-000000000001').single();
    expect(data?.contact_email).toBe(CONTACT);
  });

  // ── Add guest with an email: "Send confirmation" on by default ────────────
  await goApp(page, `/app/events/${EVENT}/add`);
  await page.getByPlaceholder('e.g. "John Doe +2 vip"').fill(`${guestName} +1`);
  const tierPick = page.getByRole('button', { name: /^Regular/ }).first();
  if (await tierPick.isVisible().catch(() => false)) await tierPick.click();
  await page.getByPlaceholder('Email (optional)').fill(guestEmail);
  const box = page.getByTestId('send-confirmation');
  await expect(box).toBeVisible();
  await flow.shot('quick-add-send-confirmation');

  await flow.check(2, '"Send confirmation" shows once an email is filled in, and is on by default', async () => {
    await expect(box.getByRole('switch', { name: 'Send confirmation' })).toHaveAttribute('aria-checked', 'true');
  });
  await page.getByRole('button', { name: new RegExp(`^Add · ${guestName}`) }).click();
  await expect(page.getByText(/Just added/).first()).toBeVisible();

  // ── The mail ──────────────────────────────────────────────────────────────
  const mail = await latestMailTo(guestEmail);
  await flow.check(3, 'Mailpit: "You\'re on the list for {event}", the +1 as people, the door line (copy v3)', async () => {
    expect(mail).not.toBeNull();
    expect(mail?.subject).toBe(`You're on the list for ${EVENT_NAME}`);
    expect(mail?.text).toContain('· You +1 (2 people)');
    expect(mail?.text).toContain("At the door, give your name. You don't need a QR code or a screenshot.");
    expect(mail?.text).not.toContain('+0');
  });
  await flow.check(4, 'Footer names the company contact; reply-to is that address; unsubscribe + support lines present', async () => {
    expect(mail?.text).toContain(`at ${CONTACT}, or reply to this email.`);
    expect(mail?.replyTo).toEqual([CONTACT]);
    expect(mail?.text).toContain('You stay on the list.');
    expect(mail?.text).toContain('Trouble with this email? support@plus-one.io');
  });

  // ── Status page (public: a fresh context has no session) ──────────────────
  const statusPath = linkPath(mail?.text ?? '', 's');
  const unsubPath = linkPath(mail?.text ?? '', 'u');
  await page.context().clearCookies();
  await goApp(page, statusPath ?? '/s/missing');
  await flow.shot('status-page');

  await flow.check(5, 'The mail\'s "Check your status" opens /s/[token] without a login: on the list, +1 as people, calendar links', async () => {
    expect(statusPath).not.toBeNull();
    await expect(page.getByTestId('guest-status')).toHaveAttribute('data-state', 'on_list');
    await expect(page.getByText("You're on the list")).toBeVisible();
    await expect(page.getByText(/Regular · You \+1 \(2 people\)/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Apple or Outlook (.ics)' })).toBeVisible();
    await expect(page.getByText(CONTACT, { exact: false })).toBeVisible();
  });
  await flow.check(6, 'The .ics downloads as text/calendar with the event in it', async () => {
    const res = await page.request.get(`${statusPath}/calendar.ics`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/calendar');
    const body = await res.text();
    expect(body).toContain(`UID:${EVENT}@plus-one.io`);
    expect(body).toContain(`SUMMARY:${EVENT_NAME}`);
  });
  await flow.check(7, 'A made-up status token shows the neutral "Nothing here." and no event', async () => {
    const res = await page.request.get(`/s/${'x'.repeat(43)}`);
    const html = await res.text();
    expect(html).toContain('Nothing here.');
    expect(html).not.toContain(EVENT_NAME);
  });
  await expectNoHorizontalOverflow(flow);

  // ── Opt-out ───────────────────────────────────────────────────────────────
  await goApp(page, unsubPath ?? '/u/missing');
  await flow.shot('unsubscribe-ask');
  await flow.check(8, 'Opening the unsubscribe link only asks (scanners never opt anyone out)', async () => {
    expect(unsubPath).not.toBeNull();
    await expect(page.getByRole('button', { name: 'Stop updates' })).toBeVisible();
    const { count } = await adminClient()
      .from('guests')
      .select('id', { count: 'exact', head: true })
      .eq('email', guestEmail)
      .eq('status', 'approved');
    expect(count).toBe(1);
  });
  await page.getByRole('button', { name: 'Stop updates' }).click();
  await flow.shot('unsubscribe-done');
  await flow.check(9, 'The button opts out and the guest stays on the list', async () => {
    await expect(page.getByText('Updates stopped')).toBeVisible();
    const { count } = await adminClient()
      .from('guests')
      .select('id', { count: 'exact', head: true })
      .eq('email', guestEmail)
      .eq('status', 'approved');
    expect(count).toBe(1);
  });

  await flow.check(10, 'No uncaught page errors', async () => {
    expect(flow.pageErrors).toEqual([]);
  });
});
