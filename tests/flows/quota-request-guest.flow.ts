import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: Quota-aanvraag Q (z8uq9m2xyp) + adjust before approving (z8uq9m5kux),
 * in all four variants.
 *
 *   staff@ → Add guest over quota → "Request more slots" with the typed guest
 *   on (the default) → admin@ → Requests → Quota: the card says who the slots
 *   are for → Approve opens the approve sheet → one plus-one less, VIP instead
 *   of Regular → the guest is on the list on staff@'s name, as adjusted; the
 *   quota-only request is trimmed 2 → 1 in the same sheet → staff@ →
 *   Home: the Updates card (fulfilled, raised, declined with its reason; the
 *   two approvals say "Approved with changes") →
 *   "Got it" and "Add guests" each dismiss their row, and it stays gone after
 *   a reload.
 *
 * admin@, not manager@: deciding a quota request is admin-only (RLS
 * quota_requests_decide_admin + approve_quota_request; canDecideRequests =
 * admin). manager@ is user_manager and has no decide button. Each variant
 * tags its own requests, so the four runs never share a card.
 *
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const ADMIN = 'admin@plusone.test';
const STAFF = 'staff@plusone.test';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const STAFF_ID = '55555555-5555-4555-8555-555555555555';
const VENUE = 'aa000000-0000-7000-8000-000000000001';
const EVENT = 'ee000000-0000-7000-8000-000000000001';
const EVENT_NAME = 'PLUSONE Launch Night';
const REGULAR = 'dd000000-0000-7000-8000-000000000001';
const VIP = 'dd000000-0000-7000-8000-000000000002';

test.beforeAll(async () => {
  for (const email of [ADMIN, STAFF]) {
    await acceptConsent(email);
    const id = await getUserIdByEmail(email);
    const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
    if (error) throw new Error(`quota-request-guest setup: ${error.message}`);
  }
});

/** Earlier runs' open requests set aside, earlier decisions dismissed, so this
 *  run's cards are the only ones (no deletes: soft state only). */
async function resetStaffRequests(): Promise<void> {
  const db = adminClient();
  const declined = await db
    .from('quota_requests')
    .update({
      status: 'denied',
      decided_by: ADMIN_ID,
      decided_at: new Date().toISOString(),
      decision_reason: 'Flow reset',
    } as never)
    .eq('user_id', STAFF_ID)
    .eq('status', 'pending');
  if (declined.error) throw new Error(`reset (decline): ${declined.error.message}`);
  const seen = await db
    .from('quota_requests')
    .update({ seen_at: new Date().toISOString() } as never)
    .eq('user_id', STAFF_ID)
    .neq('status', 'pending')
    .is('seen_at', null);
  if (seen.error) throw new Error(`reset (seen): ${seen.error.message}`);
}

test('quota request: name the guest, approve adds them, Home tells the requester', async ({ page, flow }) => {
  const tag = `${flow.variant}-${Date.now().toString(36)}`;
  const guestName = `Lisa ${tag}`;
  await resetStaffRequests();

  // A quota-only request (the "raised" card) and one to decline (the
  // "declined" card), filed for staff@ as fixtures.
  const raisedMotivation = `Raised ${tag}`;
  const { data: fixtures, error: fixErr } = await adminClient()
    .from('quota_requests')
    .insert([
      { event_id: EVENT, venue_id: VENUE, user_id: STAFF_ID, requested_extra: 2, motivation: raisedMotivation },
      { event_id: EVENT, venue_id: VENUE, user_id: STAFF_ID, requested_extra: 1, motivation: `Declined ${tag}` },
    ] as never)
    .select('id, motivation');
  if (fixErr) throw new Error(`fixtures: ${fixErr.message}`);
  const declineId = (fixtures as { id: string; motivation: string }[]).find((f) => f.motivation.startsWith('Declined'))!.id;

  // ── staff@ goes over quota and asks for more, naming the guest ────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(STAFF)}&next=${encodeURIComponent(`/app/events/${EVENT}/add`)}`);
  await page.waitForURL(/\/add/);
  await page.waitForLoadState('networkidle').catch(() => {});
  const quotaLine = await page.getByText(/Your quota · \d+ of \d+ left/).first().textContent();
  const left = Number(/· (\d+) of/.exec(quotaLine ?? '')?.[1] ?? '0');
  const plus = Math.max(1, left);
  const guestLabel = `${guestName} +${plus}`;
  await page.getByPlaceholder('e.g. "John Doe +2 vip"').fill(guestLabel);
  const tierPick = page.getByRole('button', { name: /^Regular/ }).first();
  if (await tierPick.isVisible().catch(() => false)) await tierPick.click();
  await page.getByRole('button', { name: 'Request more slots' }).click();
  const withGuest = page.getByTestId('quota-request-with-guest');
  await expect(withGuest).toBeVisible();
  await page.getByPlaceholder('Why do you need these slots?').fill(`Guest ${tag}`);
  await withGuest.scrollIntoViewIfNeeded();
  await flow.shot('staff-request-with-guest');

  await flow.check(1, 'The request panel offers "Put {guest} on the list when it\'s approved", switched on', async () => {
    await expect(withGuest).toContainText(`Put ${guestLabel} on the list when it's approved`);
    await expect(withGuest.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByTestId('quota-request-sent')).toBeVisible();
  await flow.shot('staff-request-sent');

  await flow.check(2, 'After sending: "Request sent. {guest} goes on the list once an admin approves it."', async () => {
    await expect(page.getByTestId('quota-request-sent')).toHaveText(
      `Request sent. ${guestLabel} goes on the list once an admin approves it.`,
    );
  });

  const { data: filed } = await adminClient()
    .from('quota_requests')
    .select('id, requested_extra, guest_payload, status')
    .eq('user_id', STAFF_ID)
    .eq('motivation', `Guest ${tag}`)
    .single();
  const guestReq = filed as { id: string; requested_extra: number; guest_payload: Record<string, unknown>; status: string };
  await flow.check(3, 'Database: the request is pending and carries the guest (name, +N, tier)', async () => {
    expect(guestReq.status).toBe('pending');
    expect(guestReq.guest_payload).toMatchObject({ name: guestName, plus_ones: plus, tier_id: REGULAR });
  });

  // ── admin@ decides on the quota tab ───────────────────────────────────────
  await page.context().clearCookies();
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=${encodeURIComponent(`/app/requests/quota?event=${EVENT}`)}`);
  await page.waitForURL(/\/app\/requests\/quota/);
  const guestCard = page.locator('div.rounded-\\[18px\\]').filter({ hasText: `Guest ${tag}` }).first();
  await expect(guestCard).toBeVisible({ timeout: 20_000 });
  await guestCard.scrollIntoViewIfNeeded();
  await flow.shot('admin-quota-card-with-guest');

  await flow.check(4, 'The admin\'s card says who the slots are for: "For: {guest} +N · Regular"', async () => {
    await expect(guestCard.getByTestId('quota-request-guest')).toHaveText(`For: ${guestLabel} · Regular`);
  });

  // z8uq9m5kux: Approve opens the approve sheet, at "as asked".
  await guestCard.getByRole('button', { name: `Approve +${guestReq.requested_extra}` }).click();
  const summary = page.getByTestId('quota-adjust-summary');
  await expect(summary).toBeVisible();
  await flow.shot('admin-approve-sheet-as-asked');
  await flow.check(15, 'The approve sheet opens at "as asked": +N spots, the guest\'s +N, Regular picked', async () => {
    await expect(summary).toHaveText(
      `Spots: +${guestReq.requested_extra} of ${guestReq.requested_extra} · ${guestLabel} on Regular`,
    );
    await expect(page.getByTestId('quota-adjust-plus')).toContainText(String(plus));
  });
  await flow.check(16, 'Spots and plus-ones can only go down: both + buttons are disabled at "as asked"', async () => {
    await expect(page.getByRole('button', { name: 'One spot more' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'One plus-one more' })).toBeDisabled();
  });

  // One plus-one less, and VIP instead of Regular.
  const adjustedPlus = plus - 1;
  const adjustedLabel = adjustedPlus > 0 ? `${guestName} +${adjustedPlus}` : guestName;
  await page.getByRole('button', { name: 'One plus-one less' }).click();
  await page.getByTestId('quota-adjust-tiers').getByRole('button').filter({ hasText: /^VIPNo max$/ }).click();
  await expect(summary).toHaveText(
    `Spots: +${guestReq.requested_extra} of ${guestReq.requested_extra} · ${adjustedLabel} on VIP`,
  );
  await flow.shot('admin-approve-sheet-adjusted');
  // The card behind the sheet has the same label: click the sheet's own button.
  await summary.locator('..').getByRole('button', { name: `Approve +${guestReq.requested_extra}`, exact: true }).click();
  await expect
    .poll(async () => (await adminClient().from('quota_requests').select('status').eq('id', guestReq.id).single()).data?.status)
    .toBe('approved');

  await flow.check(5, 'Database: approved with guest_id; the guest is on the list on VIP with one plus-one less, added by staff@', async () => {
    const { data: req } = await adminClient().from('quota_requests').select('guest_id').eq('id', guestReq.id).single();
    const guestId = (req as { guest_id: string | null }).guest_id;
    expect(guestId).not.toBeNull();
    const { data: g } = await adminClient()
      .from('guests')
      .select('full_name, plus_ones, tier_id, added_by, status')
      .eq('id', guestId ?? '')
      .single();
    expect(g).toEqual({ full_name: guestName, plus_ones: adjustedPlus, tier_id: VIP, added_by: STAFF_ID, status: 'approved' });
  });

  await flow.check(17, 'Database: approved_* record the adjustment; the payload keeps what was asked', async () => {
    const { data } = await adminClient()
      .from('quota_requests')
      .select('approved_extra, approved_tier_id, approved_plus_ones, guest_payload')
      .eq('id', guestReq.id)
      .single();
    expect(data).toMatchObject({
      approved_extra: guestReq.requested_extra,
      approved_tier_id: VIP,
      approved_plus_ones: adjustedPlus,
      guest_payload: { plus_ones: plus, tier_id: REGULAR },
    });
  });

  // The quota-only request, approved in the UI too.
  const raisedCard = page.locator('div.rounded-\\[18px\\]').filter({ hasText: raisedMotivation }).first();
  await expect(raisedCard).toBeVisible();
  await flow.check(6, 'A request without a guest shows no "For:" line', async () => {
    await expect(raisedCard.getByTestId('quota-request-guest')).toHaveCount(0);
  });
  // Trim the quota-only request: 2 asked, 1 granted.
  await raisedCard.getByRole('button', { name: 'Approve +2' }).click();
  await page.getByRole('button', { name: 'One spot less' }).click();
  await expect(page.getByTestId('quota-adjust-summary')).toHaveText('Spots: +1 of 2');
  await page.getByTestId('quota-adjust-summary').locator('..').getByRole('button', { name: 'Approve +1', exact: true }).click();
  await expect(raisedCard).toBeHidden();
  await flow.check(18, 'Database: the trimmed request raised the quota by 1, not 2', async () => {
    const { data } = await adminClient()
      .from('quota_requests')
      .select('status, requested_extra, approved_extra')
      .eq('user_id', STAFF_ID)
      .eq('motivation', raisedMotivation)
      .single();
    expect(data).toEqual({ status: 'approved', requested_extra: 2, approved_extra: 1 });
  });

  // The decline (with its reason) as a fixture: the Home card is under test here.
  const declined = await adminClient()
    .from('quota_requests')
    .update({ status: 'denied', decided_by: ADMIN_ID, decided_at: new Date().toISOString(), decision_reason: 'The list is full tonight' } as never)
    .eq('id', declineId);
  if (declined.error) throw new Error(`decline: ${declined.error.message}`);

  // ── staff@ → Home: the Updates card ───────────────────────────────────────
  await page.context().clearCookies();
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(STAFF)}&next=/app`);
  await page.waitForURL(/\/app$/);
  const card = page.getByTestId('quota-updates');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await flow.shot('home-updates');

  const fulfilledRow = card.locator('[data-testid="quota-update"][data-kind="fulfilled"]');
  const raisedRow = card.locator('[data-testid="quota-update"][data-kind="raised"]');
  const declinedRow = card.locator('[data-testid="quota-update"][data-kind="declined"]');

  await flow.check(7, 'Home shows "{guest} is on the list for {event}" (the granted +N) and "Approved with changes: … on VIP."', async () => {
    await expect(fulfilledRow).toContainText(`${adjustedLabel} is on the list for ${EVENT_NAME}`);
    await expect(fulfilledRow).toContainText(`Your quota went up by +${guestReq.requested_extra}.`);
    await expect(fulfilledRow.getByTestId('quota-update-changes')).toHaveText(
      `Approved with changes: +${adjustedPlus} instead of +${plus}, on VIP.`,
    );
  });
  await flow.check(8, 'Home shows "Your quota for {event} went up by +1" with "Approved with changes: +1 spot instead of +2." and "Add guests"', async () => {
    await expect(raisedRow).toContainText(`Your quota for ${EVENT_NAME} went up by +1`);
    await expect(raisedRow.getByTestId('quota-update-changes')).toHaveText('Approved with changes: +1 spot instead of +2.');
    await expect(raisedRow.getByRole('button', { name: 'Add guests' })).toBeVisible();
  });
  await flow.check(9, 'Home shows the decline with its reason, and no add button', async () => {
    await expect(declinedRow).toContainText(`Your request for ${EVENT_NAME} was declined`);
    await expect(declinedRow).toContainText('Reason: The list is full tonight');
    await expect(declinedRow.getByRole('button', { name: 'Add guests' })).toHaveCount(0);
  });

  await fulfilledRow.getByRole('button', { name: 'Got it' }).click();
  await flow.check(10, '"Got it" removes that row; the database has seen_at', async () => {
    await expect(fulfilledRow).toHaveCount(0);
    const { data } = await adminClient().from('quota_requests').select('seen_at').eq('id', guestReq.id).single();
    expect((data as { seen_at: string | null }).seen_at).not.toBeNull();
  });

  await raisedRow.getByRole('button', { name: 'Add guests' }).click();
  await page.waitForURL(new RegExp(`/app/events/${EVENT}/add`));
  await flow.shot('add-guests-from-update');
  await flow.check(11, '"Add guests" opens Add guest for that event', async () => {
    await expect(page.getByPlaceholder('e.g. "John Doe +2 vip"')).toBeVisible();
  });

  await page.goto('/app');
  await page.reload();
  await expect(page.getByTestId('quota-updates')).toBeVisible({ timeout: 20_000 });
  await flow.shot('home-after-dismiss');
  await flow.check(12, 'After a reload only the decline is left: dismissed rows stay gone', async () => {
    await expect(page.locator('[data-testid="quota-update"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="quota-update"][data-kind="declined"]')).toBeVisible();
  });

  await page.locator('[data-testid="quota-update"][data-kind="declined"]').getByRole('button', { name: 'Got it' }).click();
  await flow.check(13, 'With nothing left the whole card disappears', async () => {
    await expect(page.getByTestId('quota-updates')).toHaveCount(0);
  });

  await flow.check(14, 'No step scrolls sideways', async () => {
    expectNoHorizontalOverflow(flow);
  });
});
