import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent } from '../e2e/helpers/supabase-admin';

/**
 * Flow: the Tasks tab next to Check-in is gone (z8uq9m2vg7, Joeri's walkthrough:
 * it did nothing yet). door@ opens the Check-in tab on the seed event in every
 * variant: phone (390) and iPad get the offline-outbox door, the 1280 mouse
 * variant gets the Event-day cockpit (plan decision 14). An old bookmark with
 * `?seg=taken` lands on the check-in list too. Nothing about the outbox or the
 * check-in itself changes; the door-checkin flow covers those.
 *
 * Numbered checks = the ✅ half of the mini-PR's test handoff.
 */

const SEED_EVENT = 'ee000000-0000-7000-8000-000000000001';
const DOOR = 'door@plusone.test';

test('door: no Tasks tab next to Check-in, an old ?seg=taken link lands on Check-in', async ({ page, flow }) => {
  await acceptConsent(DOOR);
  const cockpit = flow.variant === 'desktop-browser';

  await page.goto(`/auth/dev-login?email=${DOOR}&next=${encodeURIComponent(`/app/door?event=${SEED_EVENT}`)}`);
  await page.waitForURL(/\/app\/door/);
  // A seed guest on the list = the door (or cockpit) is up with its data.
  await expect(page.getByText('Juri Braakman').first()).toBeVisible({ timeout: 30_000 });
  await flow.shot(cockpit ? 'cockpit' : 'door');

  await flow.check(1, 'The Check-in tab shows no "Tasks" tab next to Check-in', async () => {
    await expect(page.getByRole('button', { name: 'Tasks', exact: true })).toHaveCount(0);
  });

  await page.goto(`/app/door?event=${SEED_EVENT}&seg=taken`);
  await expect(page.getByText('Juri Braakman').first()).toBeVisible({ timeout: 30_000 });
  await flow.shot(cockpit ? 'cockpit-old-tasks-link' : 'door-old-tasks-link');
  if (!cockpit) {
    // "open jobs at the door" is the Tasks screen's subtitle. (The desktop
    // cockpit has its own Tasks card with that line; it never had the segment.)
    await flow.check(2, 'An old ?seg=taken link opens the check-in list, not the Tasks screen', async () => {
      await expect(page.getByText('open jobs at the door')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Tasks', exact: true })).toHaveCount(0);
    });
  } else {
    flow.skip(2, 'An old ?seg=taken link opens the check-in list (outbox door only; the cockpit never had the segment)');
  }

  await flow.check(3, 'No step scrolls sideways', async () => {
    expectNoHorizontalOverflow(flow);
  });
  await flow.check(4, 'No uncaught page errors', async () => {
    expect(flow.pageErrors).toEqual([]);
  });
});
