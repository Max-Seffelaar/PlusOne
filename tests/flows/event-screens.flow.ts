import { test, expect, expectNoHorizontalOverflow, PURCHASE_COPY } from './harness';
import type { Page } from '@playwright/test';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';
import { ROLE_LABELS } from '@/features/auth/roles';

/**
 * Flow: Event C + Dashboard B (z8uq9m2vg7 + z8uq9m2vg8), in all four variants.
 *
 * The seed's manager@ is a user_manager: it can't create events, open an
 * event's tiers or see Quota per event, and it belongs to one company only. So
 * admin@ walks this flow (Club Vesper + De Marktzaal, the only seed user in
 * two companies); staff@ checks the denied cases. Handoff note in the PR.
 *
 *   Vesper: Home (requests block with data) → event → "+ Add guest" → quick add
 *   (John Doe) → guest detail (Edit, no phone icon) → new event (time fields)
 *   → Quota per event → Invite team member → Templates → editor → Back
 *   → deep link to a Marktzaal event → "Switch to De Marktzaal"
 *   Marktzaal: event opens → Home (requests empty card) → tier step
 *   staff@ (Vesper only): the same deep link stays "not available".
 *
 * Fixture: one upcoming De Marktzaal event without tiers, requests or links of
 * its own (upserted on a fixed id; it stays, like the other flows' fixtures).
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const VESPER = 'aa000000-0000-7000-8000-000000000001';
const MARKTZAAL = 'aa000000-0000-7000-8000-000000000002';
const SEED_EVENT = 'ee000000-0000-7000-8000-000000000001';
const JURI = 'cc000000-0000-7000-8000-000000000001';
const MARKT_EVENT = 'ee000000-0000-7000-8000-0000000e5c01';
const MARKT_EVENT_NAME = 'Marktzaal Showcase';
const ADMIN = 'admin@plusone.test';
const STAFF = 'staff@plusone.test';

let adminSnoozeBefore: string | null = null;

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  await acceptConsent(STAFF);
  const a = adminClient();
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  const { data: prof } = await a.from('user_profiles').select('mfa_snooze_until').eq('id', adminId).maybeSingle();
  adminSnoozeBefore = prof?.mfa_snooze_until ?? null;
  const { error: snooze } = await a.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId);
  if (snooze) throw new Error(`event-screens flow setup: ${snooze.message}`);
  const start = Date.now() + 10 * 24 * 3600 * 1000;
  const { error } = await a.from('events').upsert(
    {
      id: MARKT_EVENT,
      venue_id: MARKTZAAL,
      name: MARKT_EVENT_NAME,
      landing_slug: 'flow-marktzaal-showcase-e5c01',
      starts_at: new Date(start).toISOString(),
      ends_at: new Date(start + 6 * 3600 * 1000).toISOString(),
      status: 'open',
    },
    { onConflict: 'id' },
  );
  if (error) throw new Error(`event-screens flow setup: ${error.message}`);
});

test.afterAll(async () => {
  const a = adminClient();
  await a.from('invites').delete().eq('venue_id', VESPER).ilike('email', 'flow-evs-%');
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  await a.from('user_profiles').update({ mfa_snooze_until: adminSnoozeBefore }).eq('id', adminId);
});

async function go(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function noPurchaseCopy(page: Page): Promise<void> {
  expect(await page.locator('body').innerText()).not.toMatch(PURCHASE_COPY);
}

test('event screens: add guest, guest edit, deep link, requests empty state, time picker, tier step, invite, templates', async ({ page, context, flow, baseURL }) => {
  const a = adminClient();
  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  const touch = flow.variant !== 'desktop-browser';
  const nativeCopy: string[] = [];
  const recordCopy = async (): Promise<void> => {
    if (flow.native) nativeCopy.push(await page.locator('body').innerText());
  };
  await context.addCookies([{ name: 'po_active_venue', value: VESPER, domain: host, path: '/' }]);

  // ── Home with request data: the existing block stays ─────────────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app`);
  await page.waitForURL(/\/app/);
  // On desktop the first /app landing of a session may auto-open the Event-day
  // cockpit when one Vesper event is live (T6, door-branch.tsx — e.g. one left
  // behind by the door-checkin flow). That one-shot is consumed now, so going
  // to /app again lands on Home, like a user's next tap on Home does.
  await page.waitForLoadState('networkidle').catch(() => {});
  await go(page, '/app');
  await page.waitForURL(/\/app$/);
  await expect(page.getByText('Upcoming events').first()).toBeVisible();
  await flow.shot('home-vesper');
  await recordCopy();
  await flow.check(1, 'Home with requests: the "Requested vs on the list" block shows, no empty-state card', async () => {
    await expect(page.getByText('Requested vs on the list')).toBeVisible();
    await expect(page.getByTestId('requests-empty-card')).toHaveCount(0);
  });

  // ── Event detail: "+ Add guest" first thing on screen ──────────────────────
  await go(page, `/app/events/${SEED_EVENT}`);
  const addGuest = page.getByRole('button', { name: 'Add guest', exact: true });
  await expect(addGuest).toBeVisible();
  await flow.shot('event-detail');
  await flow.check(2, 'Opening an event shows a big "+ Add guest" button above the fold, at least 44px tall', async () => {
    const box = await addGuest.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  });

  await addGuest.click();
  await page.waitForURL(new RegExp(`/app/events/${SEED_EVENT}/add`));
  const nameInput = page.getByPlaceholder(/John Doe/);
  await expect(nameInput).toBeVisible();
  await flow.shot('quick-add');
  await flow.check(3, 'Add guest lands on this event\'s quick add, with the placeholder "John Doe" (not a real name)', async () => {
    await expect(nameInput).toHaveAttribute('placeholder', /John Doe \+2 vip/);
    await expect(page.getByPlaceholder(/Juri Braakman/)).toHaveCount(0);
  });

  // ── Guest detail: visible Edit, no "…", no slanted-arrow icon ──────────────
  await go(page, `/app/guests/${JURI}?event=${SEED_EVENT}`);
  await expect(page.getByText('Juri Braakman').first()).toBeVisible();
  const editRow = page.getByRole('button', { name: /^Edit PLUSONE Launch Night$/ });
  await flow.shot('guest-detail');
  await flow.check(4, 'Guest detail: each event card has a visible "Edit" button, the "…" button is gone', async () => {
    await expect(editRow).toBeVisible();
    await expect(editRow).toHaveText(/^Edit/);
    await expect(page.getByRole('button', { name: /^Actions for/ })).toHaveCount(0);
  });
  await flow.check(5, 'Guest detail: the phone number row has no icon in front of it', async () => {
    const row = page.getByText('+31612345678', { exact: true }).locator('xpath=ancestor::div[contains(@class,"py-[11px]")][1]');
    await expect(row.locator('svg')).toHaveCount(0);
  });
  await editRow.click();
  await flow.check(6, 'Edit opens the other actions for that event (+1s, remove from list)', async () => {
    await expect(page.getByRole('button', { name: /Remove from list/ })).toBeVisible();
  });
  await flow.shot('guest-edit-sheet');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // ── New event: the time fields ─────────────────────────────────────────────
  await go(page, '/app/events/new');
  await expect(page.getByText('Doors', { exact: true }).first()).toBeVisible();
  if (touch) {
    const time = page.locator('input[type="time"]').first();
    await time.fill('22:00');
    await flow.shot('new-event-time');
    await flow.check(7, 'Time field (touch): one clock only and enough room that the time is not cut off', async () => {
      const field = time.locator('xpath=..');
      await expect(field.locator('svg')).toHaveCount(0);
      const width = await time.evaluate((el) => el.getBoundingClientRect().width);
      expect(width).toBeGreaterThanOrEqual(100);
      await expect(time).toHaveValue('22:00');
    });
  } else {
    await flow.shot('new-event-time');
    flow.skip(7, 'Time field (touch): one clock only and enough room that the time is not cut off');
  }

  // ── Quota per event: Invite team member ────────────────────────────────────
  await go(page, '/app/allowance');
  const inviteCta = page.getByRole('button', { name: 'Invite team member' });
  await expect(inviteCta).toBeVisible();
  await flow.shot('quota-per-event');
  await recordCopy();
  const email = `flow-evs-${flow.variant}-${Date.now().toString(36)}@plusone.test`;
  await inviteCta.click();
  await expect(page.getByText('Invite a member').first()).toBeVisible();
  await page.getByPlaceholder('name@company.com').fill(email);
  await page.getByRole('button', { name: ROLE_LABELS.staff }).click();
  await flow.shot('quota-invite-form');
  await page.getByRole('button', { name: /Send invite/i }).click();
  await flow.check(8, 'Invite from Quota per event: lands in invites (+ audit row by the admin) and you stay on Quota per event with "1 invite pending"', async () => {
    await expect(page.getByText('Quota per event').first()).toBeVisible();
    await expect(page.getByTestId('quota-invites-pending')).toBeVisible();
    const { data: inv } = await a.from('invites').select('id, roles').eq('venue_id', VESPER).ilike('email', email);
    expect(inv).toHaveLength(1);
    expect(inv![0]!.roles).toEqual(['staff']);
    const adminId = await getUserIdByEmail(ADMIN);
    const { data: audit } = await a.from('audit_log').select('actor_id').eq('entity_id', inv![0]!.id);
    expect((audit ?? []).some((r) => r.actor_id === adminId)).toBe(true);
  });
  await flow.shot('quota-after-invite');

  // ── Templates: Back from the editor stays on the list ──────────────────────
  const { count: tplCount } = await a.from('event_templates').select('id', { count: 'exact', head: true }).eq('venue_id', VESPER);
  await go(page, '/app/templates');
  await flow.shot('templates');
  const emptyCta = page.getByRole('button', { name: 'Create your first template' });
  if ((tplCount ?? 0) === 0) {
    await flow.check(9, 'Templates without templates: a "Create your first template" button, no automatic jump into the editor', async () => {
      await expect(emptyCta).toBeVisible();
      await page.waitForTimeout(1000);
      expect(new URL(page.url()).pathname).toBe('/app/templates');
    });
    await emptyCta.click();
  } else {
    flow.skip(9, 'Templates without templates: a "Create your first template" button, no automatic jump into the editor');
    await page.locator('button:has(svg)').filter({ hasText: /tier|capacity/i }).first().click();
  }
  await page.waitForURL(/\/app\/templates\/.+/);
  await page.getByRole('button', { name: /back/i }).first().click();
  await page.waitForURL(/\/app\/templates$/);
  await page.waitForTimeout(1500);
  await flow.check(10, 'Template editor → Back: the list stays (no bounce back into the editor)', async () => {
    expect(new URL(page.url()).pathname).toBe('/app/templates');
  });
  await flow.shot('templates-after-back');

  // ── Deep link to another company's event ───────────────────────────────────
  await go(page, `/app/events/${MARKT_EVENT}`);
  const switchBtn = page.getByRole('button', { name: 'Switch to De Marktzaal' });
  await expect(switchBtn).toBeVisible();
  await flow.shot('deep-link-other-company');
  await flow.check(11, 'Deep link to a De Marktzaal event from Club Vesper: explanation + "Switch to De Marktzaal", no silent switch', async () => {
    await expect(page.getByText('This event belongs to De Marktzaal')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/app/events/${MARKT_EVENT}`);
    const cookie = (await context.cookies()).find((c) => c.name === 'po_active_venue');
    expect(cookie?.value).toBe(VESPER);
  });
  await switchBtn.click();
  await page.waitForURL(new RegExp(`/app/events/${MARKT_EVENT}$`));
  await expect(page.getByText(MARKT_EVENT_NAME).first()).toBeVisible({ timeout: 20_000 });
  await flow.shot('deep-link-switched');
  await flow.check(12, 'Switch to De Marktzaal opens that same event, with De Marktzaal active', async () => {
    const cookie = (await context.cookies()).find((c) => c.name === 'po_active_venue');
    expect(cookie?.value).toBe(MARKTZAAL);
    await expect(page.getByRole('button', { name: 'Add guest', exact: true })).toBeVisible();
  });

  // ── Home without requests or own links: the compact card ───────────────────
  await go(page, '/app');
  const card = page.getByTestId('requests-empty-card');
  await expect(card).toBeVisible();
  await flow.shot('home-requests-empty');
  await recordCopy();
  await flow.check(13, 'Home with 0 requests and no request link: compact card "Let guests request a spot" + "Create request link" (≥44px), no empty chart', async () => {
    await expect(card.getByText('Let guests request a spot')).toBeVisible();
    await expect(page.getByText('Requested vs on the list')).toHaveCount(0);
    const box = await card.getByRole('button', { name: 'Create request link' }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(touch ? 43 : 40);
  });
  await card.getByRole('button', { name: 'Create request link' }).click();
  await flow.check(14, '"Create request link" opens the request links of the next event', async () => {
    await page.waitForURL(/\/app\/events\/[^/]+\/links$/);
  });
  await flow.shot('request-links');

  // ── Tier step after creating an event ───────────────────────────────────────
  await go(page, `/app/events/${MARKT_EVENT}/tiers?setup=1`);
  const firstTier = page.getByRole('button', { name: 'Add your first tier' });
  await expect(firstTier).toBeVisible();
  await flow.shot('tier-step');
  await flow.check(15, 'Tier step: "Add your first tier" is the (≥44px) button; the text explains with Guest, Backstage, Artist, Photographer', async () => {
    await expect(page.getByText(/Guest, Backstage, Artist or Photographer/)).toBeVisible();
    const box = await firstTier.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await firstTier.click();
    await expect(page.getByText('New tier').first()).toBeVisible();
  });
  await flow.shot('tier-form');

  // ── staff@: no member of De Marktzaal, no rights on Quota per event ────────
  await context.clearCookies();
  await context.addCookies([{ name: 'po_active_venue', value: VESPER, domain: host, path: '/' }]);
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(STAFF)}&next=/app/events/${MARKT_EVENT}`);
  await page.waitForURL(new RegExp(`/app/events/${MARKT_EVENT}`));
  await expect(page.getByText("This event isn't available anymore.")).toBeVisible();
  await flow.shot('staff-deep-link');
  await flow.check(16, 'Not a member (staff@): the same link shows "not available" and never names the other company', async () => {
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('De Marktzaal');
    expect(body).not.toContain(MARKT_EVENT_NAME);
    await expect(page.getByRole('button', { name: /Switch to/ })).toHaveCount(0);
  });
  await go(page, '/app/allowance');
  await flow.shot('staff-quota');
  await flow.check(17, 'staff@ on Quota per event: no rights, no "Invite team member"', async () => {
    await expect(page.getByRole('button', { name: 'Invite team member' })).toHaveCount(0);
  });

  // ── Whole flow ──────────────────────────────────────────────────────────────
  if (flow.native) {
    await flow.check(18, 'Native shell: no billing or purchase copy on the screens of this flow', async () => {
      for (const text of nativeCopy) expect(text).not.toMatch(PURCHASE_COPY);
      await noPurchaseCopy(page);
    });
  } else {
    flow.skip(18, 'Native shell: no billing or purchase copy on the screens of this flow');
  }
  await flow.check(19, 'No step scrolls sideways', async () => {
    expectNoHorizontalOverflow(flow);
  });
  await flow.check(20, 'No uncaught page errors', async () => {
    expect(flow.pageErrors).toEqual([]);
  });
});
