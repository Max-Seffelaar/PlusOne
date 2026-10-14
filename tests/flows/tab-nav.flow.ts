import { test, expect, expectNoHorizontalOverflow } from './harness';
import type { Page, Request } from '@playwright/test';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: po screens and tabs navigate on the client (Snelheid P2 finding 1,
 * z8uq9m2xz2 9-FE), in all four variants.
 *
 *   admin@ on Club Vesper → Home → Events → Guests → More → Contacts →
 *   browser Back → Back: every step changes the URL (bookmarkable, G1) and
 *   renders its screen without a document or RSC request → a reload of the
 *   last URL lands on the same screen → the Check-in tab still opens the door
 *   (door navigation is unchanged and still goes through the router).
 *
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const ADMIN = 'admin@plusone.test';
const VENUE = 'aa000000-0000-7000-8000-000000000001';

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId);
  if (error) throw new Error(`tab-nav setup: ${error.message}`);
});

const isServerNav = (r: Request): boolean =>
  r.resourceType() === 'document' || r.headers()['rsc'] === '1' || r.url().includes('_rsc=');

async function tap(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name, exact: true }).filter({ visible: true }).first().click();
}

test('tab navigation: URL per screen, no server round-trip, Back works, door unchanged', async ({ page, context, flow, baseURL }) => {
  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  await context.addCookies([{ name: 'po_active_venue', value: VENUE, domain: host, path: '/' }]);
  let watching = false;
  const serverNavs: string[] = [];
  page.on('request', (r) => {
    if (watching && isServerNav(r)) serverNavs.push(`${r.resourceType()} ${new URL(r.url()).pathname}`);
  });

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app`);
  await page.waitForURL(/\/app$/);
  await expect(page.getByRole('button', { name: 'Events', exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await flow.shot('home');

  watching = true;
  await tap(page, 'Events');
  await page.waitForURL(/\/app\/events$/);
  await expect(page.getByRole('button', { name: 'Past', exact: true })).toBeVisible();
  await flow.shot('events');
  await tap(page, 'Guests');
  await page.waitForURL(/\/app\/guests$/);
  await expect(page.getByRole('button', { name: 'Regulars' })).toBeVisible({ timeout: 20_000 });
  await flow.shot('guests');
  // The phone's More tab carries the open-requests badge in its name ("3 More").
  await page.getByRole('button', { name: /^(\d+\s*)?More$/ }).filter({ visible: true }).first().click();
  await page.waitForURL(/\/app\/more$/);
  await flow.shot('more');
  // Contacts: a More row on a phone, a sidebar item from 1024px.
  await page.getByRole('button', { name: /^Contacts/ }).filter({ visible: true }).first().click();
  await page.waitForURL(/\/app\/contacts/);
  await expect(page.getByText('Sanne Mulder').first()).toBeVisible({ timeout: 20_000 });
  await flow.shot('contacts');

  await flow.check(1, 'Home → Events → Guests → More → Contacts: each step changes the URL without a document or RSC request', async () => {
    expect(serverNavs).toEqual([]);
  });

  await page.goBack();
  await page.waitForURL(/\/app\/more$/);
  await expect(page.getByText('Contacts', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await flow.shot('back-to-more');
  await flow.check(2, 'Browser Back returns to the previous screen without a server round-trip', async () => {
    expect(serverNavs).toEqual([]);
  });

  await page.goForward();
  await page.waitForURL(/\/app\/contacts/);
  await page.reload();
  await expect(page.getByText('Sanne Mulder').first()).toBeVisible({ timeout: 30_000 });
  await flow.check(3, 'The URL is real: a reload of /app/contacts lands on Contacts (G1)', async () => {
    expect(new URL(page.url()).pathname).toBe('/app/contacts');
  });

  await tap(page, 'Check-in');
  await page.waitForURL(/\/app\/door/);
  await flow.shot('door');
  await flow.check(4, 'The Check-in tab still opens the door (door navigation unchanged)', async () => {
    expect(new URL(page.url()).pathname).toBe('/app/door');
  });
  await flow.check(5, 'No sideways scroll and no uncaught page errors', async () => {
    expectNoHorizontalOverflow(flow);
    expect(flow.pageErrors).toEqual([]);
  });
});
