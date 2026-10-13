import pg from 'pg';
import { test, expect, expectNoHorizontalOverflow, pickKitOption } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: guest mail delivery status, resend, the bounce rule, the platform
 * mail log and test mails (ClickUp z8uq9m49k1).
 *
 *   Guest list → each guest with an address shows "Confirmation: …" →
 *   a guest who never got one: open the guest, the event card's "Resend
 *   confirmation" → queued, and
 *   Mailpit gets "You're on the list" → once it has gone out, Resend again
 *   sends a second one (Q12, "they never got it") → a guest whose confirmation bounced:
 *   no resend, the hint says to change the address; after the address
 *   changes, Resend is back → Platform → Mail log: masked addresses, "Show
 *   address" needs a ticket and writes the access log → "Send a test mail"
 *   lands in Mailpit with "[Test]".
 *
 * Plain seed; admin@ is made platform admin for the flow's duration (the
 * billing-mails flow's bootstrap GUC) and back afterwards. Fixture guests get
 * a fresh address per run, so a run never trips over the previous one.
 */

const ADMIN = 'admin@plusone.test';
const ADMIN_ID_EMAIL = ADMIN;
const VENUE = 'aa000000-0000-7000-8000-000000000001';
const EVENT = 'ee000000-0000-7000-8000-000000000001';
const TIER = 'dd000000-0000-7000-8000-000000000001';
const PGURL = process.env.PGURL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
const MAILPIT = process.env.INBUCKET_URL ?? 'http://127.0.0.1:55324';

async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function setPlatformAdmin(on: boolean): Promise<void> {
  await withDb(async (client) => {
    await client.query('begin');
    await client.query("select set_config('plusone.platform_admin_write', 'on', true)");
    await client.query('update public.user_profiles set is_platform_admin = $1 where email = $2', [on, ADMIN]);
    await client.query('commit');
  });
}

/** The newest Mailpit mail to `email` whose subject matches, polled. */
async function mailTo(email: string, subject: RegExp): Promise<{ subject: string } | null> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
    const list =
      ((await res.json()) as { messages?: Array<{ Subject: string; To?: Array<{ Address: string }> }> }).messages ?? [];
    const hit = list.find((m) => subject.test(m.Subject) && (m.To ?? []).some((x) => x.Address.toLowerCase() === email));
    if (hit) return { subject: hit.Subject };
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** How many Mailpit mails to `email` have a matching subject. */
async function countMails(email: string, subject: RegExp): Promise<number> {
  const res = await fetch(`${MAILPIT}/api/v1/messages?limit=500`);
  const list =
    ((await res.json()) as { messages?: Array<{ Subject: string; To?: Array<{ Address: string }> }> }).messages ?? [];
  return list.filter((m) => subject.test(m.Subject) && (m.To ?? []).some((x) => x.Address.toLowerCase() === email)).length;
}

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const id = await getUserIdByEmail(ADMIN);
  const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
  if (error) throw new Error(`mail-status setup: ${error.message}`);
  await setPlatformAdmin(true);
});

test.afterAll(async () => {
  await setPlatformAdmin(false);
});

test('mail status: guest list states, resend, bounce rule, platform mail log, test mail', async ({ page, flow }) => {
  const adminId = await getUserIdByEmail(ADMIN_ID_EMAIL);
  const run = `${flow.variant}-${Date.now().toString(36)}`;
  const fresh = `fresh-${run}@example.test`;
  const bounced = `bounced-${run}@example.test`;
  const freshName = `Fresh ${run}`;
  const bouncedName = `Bounced ${run}`;

  // Two fixture guests: one never got a confirmation, one bounced. The seed
  // event predates 6c and has no contact address; guest mail waits without
  // one, so the event gets one as every new event does.
  const ids = await withDb(async (client) => {
    await client.query(
      "update public.events set contact_email = coalesce(contact_email, 'guestlist@vesper.test') where id = $1",
      [EVENT],
    );
    const g = await client.query(
      `insert into public.guests (event_id, tier_id, full_name, email, plus_ones, added_by, source)
       values ($1, $2, $3, $4, 0, $5, 'app'), ($1, $2, $6, $7, 0, $5, 'app')
       returning id, email`,
      [EVENT, TIER, freshName, fresh, adminId, bouncedName, bounced],
    );
    const byEmail = new Map(g.rows.map((r: { id: string; email: string }) => [r.email, r.id]));
    const log = await client.query(
      `insert into public.mail_log (type, venue_id, recipient_hash, status)
       values ('guest_on_list', $1, public.guest_mail_email_hash($2), 'bounced') returning id`,
      [VENUE, bounced],
    );
    await client.query(
      `insert into public.guest_mail_queue (venue_id, event_id, guest_id, type, status, mail_log_id)
       values ($1, $2, $3, 'guest_on_list', 'sent', $4)`,
      [VENUE, EVENT, byEmail.get(bounced), log.rows[0].id],
    );
    return { fresh: byEmail.get(fresh) as string, bounced: byEmail.get(bounced) as string, bouncedLog: log.rows[0].id as string };
  });

  // ── The guest list ─────────────────────────────────────────────────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=${encodeURIComponent(`/app/events/${EVENT}/guests`)}`);
  await page.waitForURL(/\/guests/);
  // The two fixture guests share this run's tag: search narrows the list to them.
  await page.getByPlaceholder('Search guests…').fill(run);
  await expect(page.getByText(freshName).first()).toBeVisible({ timeout: 20_000 });
  await flow.shot('guest-list');
  await flow.check(1, 'The guest list shows the confirmation per guest: "Not sent" and "Bounced"', async () => {
    await expect(page.locator('[data-testid="guest-mail-status"][data-state="not_sent"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="guest-mail-status"][data-state="bounced"]').first()).toBeVisible();
  });

  // ── Resend for the guest who never got one ─────────────────────────────────
  await page.goto(`/app/guests/${ids.fresh}?event=${EVENT}`);
  // Guests → open guest → event card → Resend confirmation (on the card, not behind Edit).
  const block = page.getByTestId('guest-confirmation');
  await expect(block.getByRole('button', { name: 'Resend confirmation' })).toBeVisible({ timeout: 20_000 });
  await flow.shot('resend');
  await block.getByRole('button', { name: 'Resend confirmation' }).click();
  await flow.check(2, '"Resend confirmation" queues it: "Confirmation queued."', async () => {
    await expect(block.getByText('Confirmation queued.')).toBeVisible();
  });
  await flow.check(3, 'The guest gets "You\'re on the list" in Mailpit', async () => {
    expect(await mailTo(fresh, /on the list/i)).not.toBeNull();
  });

  // ── Sent, but "the guest says they never got it" (decision Max 2026-10-11) ─
  await page.reload();
  const sentBlock = page.getByTestId('guest-confirmation');
  await expect(sentBlock.locator('[data-testid="guest-mail-status"][data-state="sent"]')).toBeVisible({ timeout: 20_000 });
  await flow.shot('resend-sent');
  await sentBlock.getByRole('button', { name: 'Resend confirmation' }).click();
  await expect(sentBlock.getByText('Confirmation queued.')).toBeVisible();
  await flow.check(12, 'A sent confirmation can be resent: a second "You\'re on the list" in Mailpit', async () => {
    await expect.poll(() => countMails(fresh, /on the list/i), { timeout: 20_000 }).toBe(2);
  });

  // ── The bounced guest: no resend until the address changes ─────────────────
  await page.goto(`/app/guests/${ids.bounced}?event=${EVENT}`);
  const bBlock = page.getByTestId('guest-confirmation');
  await expect(bBlock).toBeVisible();
  await flow.shot('bounced');
  await flow.check(4, 'Bounced: the hint says to change the address, no resend button', async () => {
    await expect(bBlock.getByText('This address bounced. Change the email first, then resend.')).toBeVisible();
    await expect(bBlock.getByRole('button', { name: 'Resend confirmation' })).toHaveCount(0);
  });
  const corrected = `corrected-${run}@example.test`;
  const { error: upErr } = await adminClient().from('guests').update({ email: corrected } as never).eq('id', ids.bounced);
  if (upErr) throw new Error(upErr.message);
  await page.reload();
  await flow.check(5, 'After the address changed, "Resend confirmation" is back', async () => {
    await expect(page.getByTestId('guest-confirmation').getByRole('button', { name: 'Resend confirmation' })).toBeVisible();
  });

  // ── Platform → Mail log ────────────────────────────────────────────────────
  await page.goto('/app/platform/mail');
  const log = page.getByTestId('mail-log');
  await expect(log).toBeVisible({ timeout: 20_000 });
  await flow.shot('mail-log');
  await flow.check(6, 'The mail log shows masked addresses, never a full one', async () => {
    const text = (await log.textContent()) ?? '';
    expect(text).toMatch(/\*\*\*@/);
    expect(text).not.toContain(fresh);
  });

  const row = log.getByTestId('mail-log-row').filter({ hasText: 'f***@e***.test' }).first();
  await row.getByRole('button', { name: 'Show address' }).click();
  await page.getByLabel('Ticket').fill(`flow ${run}`);
  await page.getByRole('button', { name: 'Show address' }).last().click();
  await flow.check(7, '"Show address" with a ticket shows the full address', async () => {
    await expect(page.getByTestId('mail-log-revealed')).toHaveText(fresh);
  });
  await flow.check(8, 'The reveal is in the access log, naming the ticket', async () => {
    const reason = await withDb(async (client) => {
      const r = await client.query(
        "select reason from public.platform_access_log where admin_id = $1 and reason like $2 order by created_at desc limit 1",
        [adminId, `%flow ${run}`],
      );
      return (r.rows[0]?.reason as string | undefined) ?? null;
    });
    expect(reason).toMatch(/^mail_recipient [0-9a-f-]{36}: flow /);
  });
  await page.getByRole('button', { name: 'Cancel' }).last().click();

  // ── Test mail ──────────────────────────────────────────────────────────────
  // Only to a platform admin (review #463): admin@ is one for this flow.
  const before = await countMails(ADMIN, /^\[Test\] /);
  const card = page.getByTestId('test-mail');
  await pickKitOption(card.getByRole('combobox', { name: 'Send to' }), { label: `Max de Vries · ${ADMIN}` });
  await flow.shot('test-mail');
  await card.getByRole('button', { name: 'Send test' }).click();
  await flow.check(9, 'A test mail goes to a platform admin picked from the list: "Test mail sent."', async () => {
    await expect(card.getByText(/Test mail sent/)).toBeVisible();
    await expect(card.locator('input[type="email"]')).toHaveCount(0);
  });
  await flow.check(10, 'It lands in Mailpit with "[Test]" in the subject, and the log marks it as a test', async () => {
    await expect.poll(() => countMails(ADMIN, /^\[Test\] /), { timeout: 20_000 }).toBeGreaterThan(before);
    await page.reload();
    await expect(page.getByTestId('mail-log').getByText('Test').first()).toBeVisible();
  });

  await flow.check(11, 'No sideways scroll and no uncaught page errors', async () => {
    await expectNoHorizontalOverflow(flow);
    expect(flow.pageErrors).toEqual([]);
  });
});
