import { test, expect, expectNoHorizontalOverflow } from './harness';
import type { Page } from '@playwright/test';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: form errors point at the field, follow-up (z8uq9m5m8g), in all four
 * variants. The #498 pattern on three more forms, each refused by the SERVER
 * (the path a client check cannot cover):
 *
 *   Profile → first "PlusOne", last "Support" → Save: the reserved-name refusal
 *   lands on Last name (focused, scrolled into the visible area, message under
 *   it, no line under the form), nothing saved; typing there clears it.
 *
 *   Promotion → Promoters → New promoter with an 81-character handle: the
 *   handle is marked with "Keep it to 80 characters.", no promoter created.
 *
 *   New company with a 3-digit KVK number AND a bad billing e-mail: BOTH are
 *   marked (each with its own message), focus on KVK (first in form order),
 *   no company created.
 *
 * Round 2 (Max, testing #506 in train #507):
 *   Q9  Profile with First name emptied: Save stays on and says "Enter your
 *       first name." under the field (it used to be a dead, disabled button).
 *   Q10 New link with Max people 0: saved with NO max (0 and empty both mean
 *       no limit, decision Max 2026-10-14), stored as null; the hint says so.
 *   Q12 Before that, 100001 in Max people: the field error, no link.
 *   Q11 Team invite to an address whose domain takes no mail: refused under
 *       Email, no invite row. A reserved `.invalid` domain keeps the run
 *       deterministic; the DNS path is covered by mail-domain.test.ts.
 *
 * Only Q10 writes: one stamped label-only link per variant (no max). Every
 * other save is refused. Numbered checks = the
 * ✅ half of this flow's test handoff.
 */

const ADMIN = 'admin@plusone.test';

/** Where the focused input sits, and what describes it. */
async function focused(page: Page): Promise<{
  placeholder: string | null;
  invalid: string | null;
  description: string | null;
  inWindow: boolean;
  inScrollArea: boolean;
}> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const box = (el?.closest('[data-field-shell]') as HTMLElement | null) ?? el;
    const area = el?.closest('.po-scroll') as HTMLElement | null;
    const r = box?.getBoundingClientRect();
    const a = area?.getBoundingClientRect() ?? null;
    const describedBy = el?.getAttribute('aria-describedby') ?? null;
    return {
      placeholder: el?.getAttribute('placeholder') ?? null,
      invalid: el?.getAttribute('aria-invalid') ?? null,
      description: describedBy ? document.getElementById(describedBy)?.textContent ?? null : null,
      inWindow: !!r && r.top >= 0 && r.bottom <= window.innerHeight,
      // A sheet scrolls in its own box; no .po-scroll ancestor = the window is the area.
      inScrollArea: !!r && (!a || (r.top >= a.top - 1 && r.bottom <= a.bottom + 1)),
    };
  });
}

/** The message under an input, through its aria-describedby. */
async function describedText(page: Page, placeholder: string): Promise<string | null> {
  return page.getByPlaceholder(placeholder, { exact: true }).evaluate((el) => {
    const id = el.getAttribute('aria-describedby');
    return id ? document.getElementById(id)?.textContent ?? null : null;
  });
}

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const id = await getUserIdByEmail(ADMIN);
  const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
  if (error) throw new Error(`form-errors setup: ${error.message}`);
});

test('form errors point at the field: profile, promoter, new company', async ({ page, flow }) => {
  const stamp = Date.now().toString(36);
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  const before = (await adminClient().from('user_profiles').select('first_name, last_name').eq('id', adminId).single()).data;

  // ── Profile: the reserved-name refusal sits on Last name ──
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/profile`);
  await page.waitForURL(/\/app\/profile/);
  const first = page.getByPlaceholder('First name', { exact: true });
  const last = page.getByPlaceholder('Last name', { exact: true });
  await expect(first).toBeVisible();
  await first.fill('PlusOne');
  await last.fill('Support');
  await page.evaluate(() => document.querySelector('.po-scroll')?.scrollTo({ top: 0 }));
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await flow.check(1, 'Profile, reserved name: focus lands on Last name, marked, inside the visible form area', async () => {
    await expect
      .poll(async () => focused(page), { timeout: 10_000 })
      .toMatchObject({ placeholder: 'Last name', invalid: 'true', inWindow: true, inScrollArea: true });
  });
  await flow.shot('profile-last-name-error');
  await flow.check(2, 'The reason is right under Last name (aria-describedby, role=alert); no line under the form; nothing saved', async () => {
    expect(await describedText(page, 'Last name')).toBe('That name is reserved in PlusOne. Please use your own name.');
    await expect(page.locator('.po-scroll').getByRole('alert')).toHaveCount(1);
    const now = (await adminClient().from('user_profiles').select('first_name, last_name').eq('id', adminId).single()).data;
    expect(now).toEqual(before);
  });
  await last.fill('Supporter');
  await flow.check(3, 'Typing in Last name clears its error', async () => {
    await expect(last).not.toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.po-scroll').getByRole('alert')).toHaveCount(0);
  });
  // Leave the profile as it was: no save happened, the inputs reset on the next visit.

  // ── Promoter sheet: an over-long handle ──
  await page.goto('/app/promotion/roster');
  await page.getByRole('button', { name: 'New promoter' }).click();
  const name = page.getByPlaceholder('e.g. Jayden', { exact: true });
  await expect(name).toBeVisible();
  const promoter = `FE ${flow.variant} ${stamp}`;
  await name.fill(promoter);
  await page.getByPlaceholder('@handle', { exact: true }).fill(`@${'h'.repeat(80)}`);
  await page.getByRole('button', { name: 'Add promoter' }).click();
  await flow.check(4, 'Promoter, 81-character handle: the handle is focused and marked, "Keep it to 80 characters." under it', async () => {
    await expect
      .poll(async () => focused(page), { timeout: 10_000 })
      .toMatchObject({ placeholder: '@handle', invalid: 'true', description: 'Keep it to 80 characters.', inWindow: true });
  });
  await flow.shot('promoter-handle-error');
  await flow.check(5, 'No promoter was created, and the name field is not marked', async () => {
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
    const { count } = await adminClient().from('influencers').select('id', { count: 'exact', head: true }).eq('name', promoter);
    expect(count).toBe(0);
  });

  // ── New company: two fields refused at once ──
  const company = `FE Co ${flow.variant} ${stamp}`;
  await page.goto('/app/venue/new');
  const companyName = page.getByPlaceholder('e.g. LOFI', { exact: true });
  await expect(companyName).toBeVisible();
  await companyName.fill(company);
  await page.getByPlaceholder('12345678', { exact: true }).fill('123');
  await page.getByPlaceholder('billing@company.com', { exact: true }).fill('nope');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create company' }).click();
  await flow.check(6, 'New company, bad KVK + bad billing email: focus on KVK (first in form order), in view', async () => {
    await expect
      .poll(async () => focused(page), { timeout: 10_000 })
      .toMatchObject({ placeholder: '12345678', invalid: 'true', description: 'KVK number is 8 digits', inWindow: true, inScrollArea: true });
  });
  await flow.shot('company-kvk-error');
  await flow.check(7, 'Billing email is marked too, with its own message; no line above Submit; no company created', async () => {
    await expect(page.getByPlaceholder('billing@company.com', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    expect(await describedText(page, 'billing@company.com')).toBe('Invalid email');
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(2);
    const { count } = await adminClient().from('venues').select('id', { count: 'exact', head: true }).eq('name', company);
    expect(count).toBe(0);
  });
  await page.getByPlaceholder('billing@company.com', { exact: true }).scrollIntoViewIfNeeded();
  await flow.shot('company-billing-email-error');

  // ── Round 2 · Q9: Save stays on with an emptied name ──
  await page.goto('/app/profile');
  const firstAgain = page.getByPlaceholder('First name', { exact: true });
  await expect(firstAgain).toBeVisible();
  await firstAgain.fill('');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await flow.check(9, 'Profile, First name emptied: Save stays on; Save puts "Enter your first name." under it, focused; nothing saved', async () => {
    await expect(save).toBeEnabled();
    await save.click();
    await expect
      .poll(async () => focused(page), { timeout: 10_000 })
      .toMatchObject({ placeholder: 'First name', invalid: 'true', description: 'Enter your first name.', inWindow: true });
    const now = (await adminClient().from('user_profiles').select('first_name, last_name').eq('id', adminId).single()).data;
    expect(now).toEqual(before);
  });
  await flow.shot('profile-first-name-required');

  // ── Round 2 · Q10: 0 means no max; over 100 000 is refused ──
  const zeroLabel = `FE zero ${flow.variant} ${stamp}`;
  await page.goto('/app/promotion');
  await page.getByRole('button', { name: 'New link' }).click();
  await page.getByRole('button', { name: 'Label only' }).click();
  await page.getByPlaceholder('Instagram bio', { exact: true }).fill(zeroLabel);
  const maxPeople = page.getByPlaceholder('∞ no cap', { exact: true });
  await maxPeople.fill('100001');
  await page.getByRole('button', { name: 'Create link' }).click();
  await flow.check(12, 'New link, Max people 100001: "Use a whole number up to 100,000." under Max people, focused; no link yet', async () => {
    await expect
      .poll(async () => focused(page), { timeout: 10_000 })
      .toMatchObject({ placeholder: '∞ no cap', invalid: 'true', description: 'Use a whole number up to 100,000.', inWindow: true });
    const { count } = await adminClient().from('request_links').select('id', { count: 'exact', head: true }).eq('label', zeroLabel);
    expect(count).toBe(0);
  });
  await flow.shot('link-max-people-over-cap');
  await maxPeople.fill('0');
  // Typing in the field clears its error; the hint says what 0 means.
  await expect(maxPeople).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('0 or empty means no limit.')).toBeVisible();
  await page.getByRole('button', { name: 'Create link' }).click();
  await expect
    .poll(async () => (await adminClient().from('request_links').select('max_headcount, event_id').eq('label', zeroLabel).maybeSingle()).data, { timeout: 15_000 })
    .not.toBeNull();
  await flow.shot('link-max-people-zero-saved');
  const saved = (await adminClient().from('request_links').select('max_headcount, event_id').eq('label', zeroLabel).single()).data as {
    max_headcount: number | null;
    event_id: string;
  };
  await page.goto(`/app/promotion/events/${saved.event_id}`);
  const card = page.getByRole('button').filter({ hasText: zeroLabel }).first();
  await flow.check(10, 'New link, Max people 0: saved with no max (stored null, no error) and its card reads "No max", never "max 0"', async () => {
    expect(saved.max_headcount).toBeNull();
    await expect(card).toContainText('No max', { timeout: 15_000 });
    await expect(card).not.toContainText('/0');
  });
  await card.scrollIntoViewIfNeeded();
  await flow.shot('link-card-no-max');

  // ── Round 2 · Q11: a team invite to a domain that takes no mail ──
  const noMail = `fe-${flow.variant}-${stamp}@theoperatoirs.invalid`;
  await page.goto('/app/team');
  await page.getByRole('button', { name: 'Invite a member' }).first().click();
  await page.getByRole('button', { name: /Company user · Team/ }).click();
  await page.getByPlaceholder('name@company.com', { exact: true }).fill(noMail);
  await page.getByRole('button', { name: 'Staff', exact: true }).click();
  await page.getByRole('button', { name: 'Send invite' }).click();
  await flow.check(11, 'Team invite to a domain that takes no mail: the domain message under Email, focused; no invite row', async () => {
    await expect
      .poll(async () => focused(page), { timeout: 15_000 })
      .toMatchObject({
        placeholder: 'name@company.com',
        invalid: 'true',
        description: "That email domain doesn't take mail. Check the part after the @.",
        inWindow: true,
      });
    const { count } = await adminClient().from('invites').select('id', { count: 'exact', head: true }).eq('email', noMail);
    expect(count).toBe(0);
  });
  await flow.shot('team-invite-no-mail-domain');

  await flow.check(8, 'No sideways scroll and no uncaught page errors', async () => {
    await expectNoHorizontalOverflow(flow);
    expect(flow.pageErrors).toEqual([]);
  });
});
