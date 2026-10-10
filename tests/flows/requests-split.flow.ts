import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: Requests E (z8uq9m2vga), in all four variants.
 *
 *   admin@ → Requests → a request for +3 (4 people) → Approve… → the split
 *   sheet: 1 on VIP, 2 on Regular (you +1), 1 declined → the note is required
 *   → "Add 3, decline 1" → two guests on the list, one partly mail in Mailpit
 *   → a second request declined as a whole with a note → one decline mail.
 *
 * admin@, not manager@: manager@ is user_manager, which has no decide right
 * (canDecideRequests = admin; decide_guest_request = admin or organizer).
 * Each variant files its own two requests (unique names + addresses), so the
 * four runs never share a card or a mail. Mail goes through the stub
 * provider's Mailpit hand-off, drained in after() by the decide action.
 *
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const ADMIN = 'admin@plusone.test';
const VENUE = 'aa000000-0000-7000-8000-000000000001';
const EVENT = 'ee000000-0000-7000-8000-000000000001';
const EVENT_NAME = 'PLUSONE Launch Night';
const REGULAR = 'dd000000-0000-7000-8000-000000000001';
const VIP = 'dd000000-0000-7000-8000-000000000002';
const CONTACT = 'guests@clubvesper.test';
const MAILPIT = process.env.INBUCKET_URL || 'http://127.0.0.1:55324';

interface CaughtMail {
  subject: string;
  text: string;
}

/** Every mail Mailpit caught for `email`, after waiting until at least one arrived. */
async function mailsTo(email: string): Promise<CaughtMail[]> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
    const list =
      ((await res.json()) as { messages?: Array<{ ID: string; Subject: string; To?: Array<{ Address: string }> }> })
        .messages ?? [];
    const hits = list.filter((m) => (m.To ?? []).some((t) => t.Address.toLowerCase() === email));
    if (hits.length > 0) {
      // A second mail would be drained by the same after(); give it a moment.
      await new Promise((r) => setTimeout(r, 1500));
      const again =
        ((await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json()) as {
          messages?: Array<{ ID: string; Subject: string; To?: Array<{ Address: string }> }>;
        }).messages ?? [];
      const all = again.filter((m) => (m.To ?? []).some((t) => t.Address.toLowerCase() === email));
      return Promise.all(
        all.map(async (m) => {
          const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text?: string };
          return { subject: m.Subject, text: full.Text ?? '' };
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return [];
}

async function fileRequest(name: string, email: string, plusOnes: number): Promise<string> {
  const { data, error } = await adminClient()
    .from('guest_requests')
    .insert({ event_id: EVENT, full_name: name, email, phone: '+31612345678', plus_ones: plusOnes })
    .select('id')
    .single();
  if (error || !data) throw new Error(`requests-split setup: ${error?.message}`);
  return data.id as string;
}

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const id = await getUserIdByEmail(ADMIN);
  const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
  if (error) throw new Error(`requests-split setup: ${error.message}`);
  // Guest mail waits for a company contact address (6a); set it.
  const contact = await adminClient().from('venues').update({ contact_email: CONTACT }).eq('id', VENUE);
  if (contact.error) throw new Error(`requests-split setup: ${contact.error.message}`);
});

test('requests: split +3 over two tiers with one declined → one mail; whole decline → one mail', async ({ page, flow }) => {
  const tag = `${flow.variant}-${Date.now().toString(36)}`;
  const splitName = `Lotte Split ${tag}`;
  const splitEmail = `flow-split-${tag}@plusone.test`;
  const declineName = `Daan Decline ${tag}`;
  const declineEmail = `flow-decline-${tag}@plusone.test`;
  const splitId = await fileRequest(splitName, splitEmail, 3);
  const declineId = await fileRequest(declineName, declineEmail, 1);

  // ── Requests → the +3 card ────────────────────────────────────────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/requests`);
  await page.waitForURL(/\/app\/requests/);
  await page.getByPlaceholder(/Search/i).first().fill(tag).catch(() => {});
  const card = page.locator('div.rounded-\\[18px\\]').filter({ hasText: splitName }).first();
  await expect(card).toBeVisible();
  await flow.shot('requests-card');

  await flow.check(1, 'Requests shows the new request with its +3', async () => {
    await expect(card.getByText('+3', { exact: true })).toBeVisible();
  });

  // ── The split sheet ───────────────────────────────────────────────────────
  await card.getByRole('button', { name: 'Approve…' }).click();
  const tiers = page.getByTestId('decide-tiers');
  await expect(tiers).toBeVisible();
  await flow.shot('decide-sheet-default');

  await flow.check(2, 'The sheet opens with all 4 people on the first tier: "4 of 4 on the list", "Add to the list"', async () => {
    await expect(page.getByTestId('decide-summary')).toHaveText('4 of 4 on the list');
    await expect(page.getByRole('button', { name: 'Add to the list' })).toBeEnabled();
  });

  // 4 on Regular → 2 on Regular, 1 on VIP, 1 left over (declined).
  await page.getByRole('button', { name: 'One less on Regular' }).click();
  await page.getByRole('button', { name: 'One less on Regular' }).click();
  await page.getByRole('button', { name: 'One more on VIP', exact: true }).click();
  await flow.shot('decide-sheet-split');

  await flow.check(3, 'Split 1 VIP + 2 Regular: "3 of 4 on the list, 1 declined"; the note becomes required and the button waits for it', async () => {
    await expect(page.getByTestId('decide-summary')).toHaveText('3 of 4 on the list, 1 declined');
    await expect(page.getByText('required when you decline someone')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add 3, decline 1' })).toBeDisabled();
  });

  await page.getByRole('textbox', { name: 'Message to the guest' }).fill('We could fit three of you, sorry.');
  await flow.shot('decide-sheet-note');
  await page.getByRole('button', { name: 'Add 3, decline 1' }).click();
  await expect(page.getByTestId('decide-tiers')).toBeHidden();

  await flow.check(4, 'Database: two guests from the request (Regular +1 with the contact, VIP solo), the request approved for 3 with the note', async () => {
    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from('guests')
          .select('tier_id, plus_ones, email, status')
          .eq('guest_request_id', splitId)
          .order('created_at');
        return (data ?? []).map((g) => `${g.tier_id === VIP ? 'VIP' : g.tier_id === REGULAR ? 'Regular' : '?'}:${g.plus_ones}:${g.email ? 'mail' : '-'}`).sort();
      })
      .toEqual(['Regular:1:mail', 'VIP:0:-']);
    const { data: req } = await adminClient()
      .from('guest_requests')
      .select('status, approved_plus_ones, decision_message')
      .eq('id', splitId)
      .single();
    expect(req).toEqual({ status: 'approved', approved_plus_ones: 2, decision_message: 'We could fit three of you, sorry.' });
  });

  const splitMails = await mailsTo(splitEmail);
  await flow.check(5, 'Exactly one mail to the requester: the partly mail for 3 people, both tiers, the note (no separate "You\'re on the list")', async () => {
    expect(splitMails).toHaveLength(1);
    expect(splitMails[0].subject).toBe(`On the list for ${EVENT_NAME}: 3 people`);
    expect(splitMails[0].text).toContain('We could fit three of you, sorry.');
    // One mail names every part of the split (claim `tiers`, z8uq9m2vga).
    expect(splitMails[0].text).toContain('Your spot: 3 people');
    expect(splitMails[0].text).toContain('Regular: 2 people');
    expect(splitMails[0].text).toContain('VIP: 1 person');
  });

  await flow.check(6, 'The card left the queue; the totals line counts the declined person', async () => {
    await expect(page.locator('div.rounded-\\[18px\\]').filter({ hasText: splitName })).toHaveCount(0);
    await expect(page.getByTestId('request-decision-counts')).toContainText('declined');
  });

  // ── A whole decline with a note ──────────────────────────────────────────
  const declineCard = page.locator('div.rounded-\\[18px\\]').filter({ hasText: declineName }).first();
  await declineCard.getByRole('button', { name: 'Decline' }).click();
  await flow.shot('decline-sheet');
  await flow.check(7, 'Decline sheet: "Note to the guest" is required; the confirm waits for it', async () => {
    await expect(page.getByText('Note to the guest')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm decline' })).toBeDisabled();
  });
  await page.getByRole('textbox', { name: 'Note to the guest' }).fill('Full tonight, try next week.');
  await page.getByRole('button', { name: 'Confirm decline' }).click();
  await expect(page.getByRole('button', { name: 'Confirm decline' })).toBeHidden();

  await flow.check(8, 'Database: the request is declined with the note, no guest', async () => {
    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from('guest_requests')
          .select('status, decision_message')
          .eq('id', declineId)
          .single();
        return data;
      })
      .toEqual({ status: 'denied', decision_message: 'Full tonight, try next week.' });
    const { count } = await adminClient()
      .from('guests')
      .select('id', { count: 'exact', head: true })
      .eq('guest_request_id', declineId);
    expect(count).toBe(0);
  });

  const declineMails = await mailsTo(declineEmail);
  await flow.check(9, 'Exactly one decline mail, with the note', async () => {
    expect(declineMails).toHaveLength(1);
    expect(declineMails[0].subject).toBe(`Your guest list request for ${EVENT_NAME}`);
    expect(declineMails[0].text).toContain('Full tonight, try next week.');
  });

  await flow.shot('requests-after');
  await expectNoHorizontalOverflow(flow);

  // ── The desktop cockpit's decline asks for the note too (review S2) ──────
  // The cockpit is the Deur tab on a fine pointer at ≥1024px only.
  if (flow.variant === 'desktop-browser') {
    const cockpitName = `Sem Cockpit ${tag}`;
    const cockpitEmail = `flow-cockpit-${tag}@plusone.test`;
    const cockpitId = await fileRequest(cockpitName, cockpitEmail, 0);
    await page.goto(`/app/door?event=${EVENT}`);
    const row = page.locator('div').filter({ hasText: cockpitName }).filter({ has: page.getByTitle('Deny') }).last();
    await row.getByTitle('Deny').click();
    await flow.shot('cockpit-decline-sheet');
    await flow.check(11, 'Cockpit: Deny opens the note sheet ("Note to the guest", required); no one-tap decline', async () => {
      await expect(page.getByText('Note to the guest')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Confirm decline' })).toBeDisabled();
      const { data } = await adminClient().from('guest_requests').select('status').eq('id', cockpitId).single();
      expect(data?.status).toBe('pending');
    });
    await page.getByRole('textbox', { name: 'Note to the guest' }).fill('Sold out tonight, sorry.');
    await page.getByRole('button', { name: 'Confirm decline' }).click();
    await flow.check(12, 'Cockpit decline: declined with the note, and exactly one decline mail', async () => {
      await expect
        .poll(async () => {
          const { data } = await adminClient()
            .from('guest_requests')
            .select('status, decision_message')
            .eq('id', cockpitId)
            .single();
          return data;
        })
        .toEqual({ status: 'denied', decision_message: 'Sold out tonight, sorry.' });
      const mails = await mailsTo(cockpitEmail);
      expect(mails).toHaveLength(1);
      expect(mails[0].text).toContain('Sold out tonight, sorry.');
    });
  } else {
    flow.skip(11, 'Cockpit decline sheet (desktop cockpit only)');
    flow.skip(12, 'Cockpit decline: note + one mail (desktop cockpit only)');
  }

  await flow.check(10, 'No uncaught page errors', async () => {
    expect(flow.pageErrors).toEqual([]);
  });
});
