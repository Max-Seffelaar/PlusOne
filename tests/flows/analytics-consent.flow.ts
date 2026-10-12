import { test, expect, expectNoHorizontalOverflow, reportsNative } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Analytics PH (PostHog) foundation — what a visitor and a signed-in user see,
 * built and shipped WITHOUT a PostHog key (decision Max 2026-10-12):
 *
 *  - Public landing (`/`): the cookie banner asks once (browser variants, 390
 *    and 1280); "Only necessary" closes it for good. The native shell never
 *    shows it.
 *  - Profile → Privacy → Product analytics: on by default, the switch writes
 *    `user_profiles.analytics_opt_out_at` (checked in the database) and survives
 *    a reload; turning it back on clears the column.
 *  - Without NEXT_PUBLIC_POSTHOG_KEY not one request goes to `/ingest`, before
 *    or after any choice (the ePrivacy "nothing before consent" floor, and the
 *    "no key = Noop" promise).
 *
 * Seed user: manager@ (Club Vesper). Plain seed; the opt-out column is reset to
 * null first so the switch starts in its default position.
 */

const USER = 'manager@plusone.test';

test.beforeAll(async () => {
  await acceptConsent(USER);
  const id = await getUserIdByEmail(USER);
  const { error } = await adminClient().from('user_profiles').update({ analytics_opt_out_at: null }).eq('id', id ?? '');
  if (error) throw new Error(`analytics-consent setup: ${error.message}`);
});

async function storedOptOut(): Promise<string | null> {
  const id = await getUserIdByEmail(USER);
  const { data, error } = await adminClient()
    .from('user_profiles')
    .select('analytics_opt_out_at')
    .eq('id', id ?? '')
    .single();
  if (error) throw new Error(error.message);
  return data.analytics_opt_out_at;
}

test('analytics consent: public banner, Profile opt-out, no /ingest without a key', async ({ page, flow, baseURL }) => {
  const ingest: string[] = [];
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/ingest')) ingest.push(r.method());
  });
  const banner = page.getByTestId('cookie-banner');

  await page.goto('/');
  await page.waitForLoadState('networkidle').catch(() => {});

  await flow.check(1, 'The app seam reports native exactly in the native variants', async () => {
    expect(await reportsNative(page)).toBe(flow.native);
  });

  await flow.check(2, 'Landing: the browser shows the cookie banner; the native shell never does', async () => {
    if (flow.native) {
      await page.waitForTimeout(500);
      await expect(banner).toHaveCount(0);
    } else {
      await expect(banner).toBeVisible();
      await expect(banner.getByRole('button', { name: 'Accept all' })).toBeVisible();
      await expect(banner.getByRole('button', { name: 'Only necessary' })).toBeVisible();
      await expect(banner.getByRole('link', { name: 'Cookie policy' })).toBeVisible();
    }
  });
  await flow.shot('landing');

  if (flow.native) {
    flow.skip(3, 'Banner buttons and the policy link are at least 44px tall');
    flow.skip(4, '"Only necessary" closes the banner, and it stays gone after a reload');
  } else {
    await flow.check(3, 'Banner buttons and the policy link are at least 44px tall', async () => {
      for (const el of [
        banner.getByRole('button', { name: 'Accept all' }),
        banner.getByRole('button', { name: 'Only necessary' }),
        banner.getByRole('button', { name: 'Choose' }),
        banner.getByRole('link', { name: 'Cookie policy' }),
      ]) {
        const box = await el.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    });
    await banner.getByRole('button', { name: 'Choose' }).click();
    await expect(page.getByTestId('cookie-categories')).toBeVisible();
    await flow.shot('banner-choose');
    await flow.check(4, '"Only necessary" closes the banner, and it stays gone after a reload', async () => {
      await banner.getByRole('button', { name: 'Only necessary' }).click();
      await expect(banner).toHaveCount(0);
      const stored = await page.evaluate(() => window.localStorage.getItem('plusone.consent.v1'));
      expect(JSON.parse(stored ?? 'null')).toMatchObject({ analytics: false, marketing: false });
      await page.reload();
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(banner).toHaveCount(0);
    });
    await flow.shot('landing-decided');
  }

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(USER)}&next=/app/profile`);
  await page.waitForURL(/\/app\/profile/);
  const section = page.getByTestId('analytics-opt-out');
  const toggle = section.getByRole('switch', { name: 'Product analytics' });

  await flow.check(5, 'Profile shows Privacy → Product analytics, on by default', async () => {
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
  });
  await section.scrollIntoViewIfNeeded();
  await flow.shot('profile-analytics-on');

  await flow.check(6, 'Switching it off stores the opt-out on your own profile', async () => {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(section.getByText('Saved')).toBeVisible();
    await expect.poll(storedOptOut).not.toBeNull();
  });
  await flow.shot('profile-analytics-off');

  await flow.check(7, 'The opt-out survives a reload', async () => {
    await page.reload();
    await expect(section).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  await flow.check(8, 'Switching it back on clears the opt-out', async () => {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect.poll(storedOptOut).toBeNull();
  });

  await flow.check(9, 'No cookie banner anywhere inside the app', async () => {
    await expect(banner).toHaveCount(0);
  });

  await flow.check(10, 'Without a PostHog key: zero /ingest requests, before or after any choice', async () => {
    expect(ingest).toEqual([]);
    const phKeys = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((k) => k.startsWith('ph_') || k.startsWith('__ph_')),
    );
    expect(phKeys).toEqual([]);
  });

  await flow.check(11, 'No link opens a new browser window (target=_blank)', async () => {
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
  });
  await flow.check(12, 'No step scrolls sideways', async () => {
    expectNoHorizontalOverflow(flow);
  });
  await flow.check(13, 'No uncaught page errors', async () => {
    expect(flow.pageErrors).toEqual([]);
  });
  void baseURL;
});
