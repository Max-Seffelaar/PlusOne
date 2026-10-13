import pg from 'pg';
import { test, expect, expectNoHorizontalOverflow, reportsNative, PURCHASE_COPY, pickKitOption } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';
import type { Locator, Page } from '@playwright/test';

/**
 * Flow: Kit Select (z8uq9m4a2w) — the kit dropdown is a PlusOne listbox, not
 * the OS-drawn `<select>` list. A fine pointer from 1024px gets a popover under
 * the field; touch (phone, and the iPad even at sidebar width) gets a bottom
 * sheet with 44px rows. Walked on its busiest users: Platform → Audit (company
 * filter) and Platform → Mail log (the long, grouped test-mail type list).
 *
 * Runs on the PLAIN seed. admin@ is no platform admin there (pgTAP relies on
 * that), so — like platform-overview — the flow flips the flag through the
 * bootstrap GUC for its own duration and clears it again afterwards.
 */

const ADMIN = 'admin@plusone.test';
const VESPER = 'Club Vesper';
const ACCENT = 'rgb(181, 166, 255)';
const PGURL = process.env.PGURL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

async function setPlatformAdmin(on: boolean): Promise<void> {
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('plusone.platform_admin_write', 'on', true)");
    await client.query('update public.user_profiles set is_platform_admin = $1 where email = $2', [on, ADMIN]);
    await client.query('commit');
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId);
  if (error) throw new Error(`kit-select setup: ${error.message}`);
  await setPlatformAdmin(true);
});

test.afterAll(async () => {
  await setPlatformAdmin(false);
});

type Box = { x: number; y: number; width: number; height: number };
async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error('no bounding box');
  return b;
}

async function viewport(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
}

test('kit-select: popover on a fine pointer, bottom sheet on touch, picks and keyboard', async ({ page, flow }) => {
  // The desktop variant is the only fine-pointer one (matrix.ts); the iPad is
  // 1024px wide (sidebar chrome) but touch, so it must get the sheet.
  const popover = flow.variant === 'desktop-browser';

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/platform/audit`);
  await page.waitForURL(/\/app\/platform\/audit/);
  const company = page.getByRole('combobox', { name: 'Company' });
  await expect(company).toBeVisible();
  await flow.shot('audit-closed');

  await flow.check(1, 'The app seam reports native exactly in the native variants', async () => {
    expect(await reportsNative(page)).toBe(flow.native);
  });

  await flow.check(2, 'The company filter is the kit dropdown (a combobox button, no native <select>) showing "All companies"', async () => {
    await expect(page.locator('select')).toHaveCount(0);
    await expect(company).toHaveText('All companies');
    await expect(company).toHaveAttribute('aria-expanded', 'false');
  });

  await company.click();
  const list = page.getByRole('listbox', { name: 'Company' });
  const panel = page.getByTestId('select-panel');
  await expect(list).toBeVisible();
  await flow.shot(popover ? 'audit-popover' : 'audit-sheet');

  await flow.check(3, 'Fine pointer ≥1024: a popover right under the field, no backdrop, no Cancel. Touch: a bottom sheet on the viewport edge (over the tab bar), at most 560px wide, with Cancel', async () => {
    await expect(company).toHaveAttribute('aria-expanded', 'true');
    const p = await box(panel);
    const vp = await viewport(page);
    const cancel = page.getByRole('button', { name: 'Cancel' });
    if (popover) {
      const f = await box(company);
      expect(p.y).toBeGreaterThanOrEqual(f.y + f.height);
      expect(p.y).toBeLessThan(f.y + f.height + 20);
      expect(Math.abs(p.x - f.x)).toBeLessThan(2);
      await expect(cancel).toBeHidden();
    } else {
      expect(Math.abs(p.y + p.height - vp.height)).toBeLessThan(2);
      expect(p.width).toBeLessThanOrEqual(560);
      await expect(cancel).toBeVisible();
    }
  });

  await flow.check(4, 'The chosen row ("All companies") is marked selected and drawn in the lavender accent', async () => {
    const chosen = list.getByRole('option', { name: 'All companies', exact: true });
    await expect(chosen).toHaveAttribute('aria-selected', 'true');
    await expect(chosen).toHaveCSS('color', ACCENT);
  });

  await flow.check(5, 'Touch: every row is at least 44px tall; fine pointer: compact rows of at least 36px', async () => {
    const min = popover ? 36 : 44;
    for (const opt of await list.getByRole('option').all()) {
      expect((await box(opt)).height).toBeGreaterThanOrEqual(min - 0.5);
    }
  });

  await list.getByRole('option', { name: VESPER, exact: true }).click();
  await flow.shot('audit-picked');

  await flow.check(6, `Picking "${VESPER}" closes the list, shows it in the field and keeps focus on the field`, async () => {
    await expect(list).toHaveCount(0);
    await expect(company).toHaveText(VESPER);
    await expect(company).toHaveAttribute('aria-expanded', 'false');
    await expect(company).toBeFocused();
  });

  await flow.check(7, 'Closing without a pick changes nothing: Escape on a fine pointer, Cancel on touch', async () => {
    await company.click();
    await expect(list).toBeVisible();
    if (popover) await company.press('Escape');
    else await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(list).toHaveCount(0);
    await expect(company).toHaveText(VESPER);
  });

  await flow.check(8, 'Keyboard: ArrowDown opens on the chosen row, Home jumps to the top, Enter picks it ("All companies" again)', async () => {
    await company.focus();
    await company.press('ArrowDown');
    await expect(list).toBeVisible();
    const active = async (): Promise<string> =>
      page.evaluate(() => {
        const id = document.activeElement?.getAttribute('aria-activedescendant');
        return (id && document.getElementById(id)?.textContent) || '';
      });
    expect(await active()).toBe(VESPER);
    await company.press('Home');
    expect(await active()).toBe('All companies');
    await company.press('Enter');
    await expect(list).toHaveCount(0);
    await expect(company).toHaveText('All companies');
  });

  await flow.check(9, `Type-ahead: typing "club v" on the closed field jumps to "${VESPER}"`, async () => {
    await company.focus();
    await page.keyboard.type('club v');
    await expect(list).toBeVisible();
    await expect(company).toHaveAttribute('aria-activedescendant', /.+/);
    const id = await company.getAttribute('aria-activedescendant');
    await expect(page.locator(`[id="${id}"]`)).toHaveText(VESPER);
    await company.press('Escape');
    await expect(list).toHaveCount(0);
  });

  // ── Mail log: the long grouped type list scrolls inside the panel ─────────
  await page.goto('/app/platform/mail');
  const mailType = page.getByTestId('test-mail').getByRole('combobox', { name: 'Mail' });
  await expect(mailType).toBeVisible();
  await mailType.click();
  const mailList = page.getByRole('listbox', { name: 'Mail' });
  await expect(mailList).toBeVisible();
  await flow.shot(popover ? 'mail-type-popover' : 'mail-type-sheet');

  await flow.check(10, 'A long list stays inside the panel and scrolls there; the panel fits on screen', async () => {
    const vp = await viewport(page);
    const p = await box(panel);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.height).toBeLessThanOrEqual(vp.height);
    const scrolls = await mailList.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrolls).toBe(true);
  });

  const last = mailList.getByRole('option').last();
  const lastLabel = (await last.textContent()) ?? '';
  await mailType.press('Escape');
  await expect(mailList).toHaveCount(0);
  await pickKitOption(mailType, { label: lastLabel });
  await flow.check(11, 'Picking the last row of the long list (scrolled into view) sets the field', async () => {
    await expect(mailType).toHaveText(lastLabel);
  });
  await flow.shot('mail-type-picked');

  await flow.check(12, 'No sideways scroll, no target=_blank link, no purchase copy in the native shell, no uncaught page errors', async () => {
    expectNoHorizontalOverflow(flow);
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
    if (flow.native) await expect(page.locator('body')).not.toHaveText(PURCHASE_COPY);
    expect(flow.pageErrors).toEqual([]);
  });
});
