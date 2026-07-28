import { test, expect, type Page } from '@playwright/test';
import { acceptConsent } from './helpers/supabase-admin';

/**
 * `/app` must render the event board — and must do so even in a tab that has
 * NEVER painted. Behavioural guard for the 86eya4yuf hydration hang (PR #237).
 *
 * `PlusOneApp` reads `useSearchParams()`, which suspends during SSR. If the
 * shell is server-rendered under a `<Suspense>` (the pre-#237 shape), Next
 * 15.5's inline fizz runtime gates the boundary reveal ($RV) AND React's
 * hydration retry (`_reactRetry`) on `requestAnimationFrame`, with no timeout
 * fallback while `$RT` is unset. A tab that never paints — a background tab, a
 * webview, a headless browser that doesn't composite — never fires rAF, so the
 * app sits forever on zero-filled SSR HTML: zero queries mount, zero fetches
 * fire, and Home/Deur read as a settled "no events" screen. Silent, app-breaking
 * information loss.
 *
 * The fix mounts the shell client-only (`app-client.tsx`, `ssr: false`), a path
 * that does not depend on rAF to hydrate. `tests/unit/app-shell-no-ssr-suspense`
 * pins the *structure*; this spec pins the *behaviour*, in two layers:
 *   1. a normal load renders event cards (broad "empty board" guard — also
 *      catches a future data / RLS / windowing regression that empties the board);
 *   2. the same load with `requestAnimationFrame` stubbed to a no-op — the exact
 *      failure condition of the hang. The pre-#237 shell would never reveal here
 *      and this test would time out; the `ssr: false` mount still renders.
 *
 * Read-only against the seed. door@ = Lisa (doorhost/staff at Club Vesper),
 * needs no MFA and reads her venue's events on Home; terms are pre-accepted so
 * dev-login lands straight on `/app` (no consent gate to confound the assert).
 */

const DEV_LOGIN = '/auth/dev-login?email=door@plusone.test&next=/app';
// supabase/seed.sql: Club Vesper's always-upcoming event (now() + 5 days). On a
// fresh (CI) seed it is the one guaranteed event on the board.
const SEED_EVENT = 'PLUSONE Launch Night';

async function expectEventBoardVisible(page: Page): Promise<void> {
  await page.waitForURL('**/app', { timeout: 60_000 });
  // The seed event must actually render as a card. This is what fails when the
  // shell never hydrates (frozen SSR skeletons / stuck boot screen) — the counts
  // would sit at zero and no card would ever appear.
  await expect(page.getByText(SEED_EVENT).first()).toBeVisible({ timeout: 30_000 });
}

test.describe('/app renders the event board (86eya4yuf hydration guard)', () => {
  test.beforeAll(async () => {
    await acceptConsent('door@plusone.test');
  });

  test('Home shows event cards on a normal load', async ({ page }) => {
    await page.goto(DEV_LOGIN);
    await expectEventBoardVisible(page);
  });

  test('Home still renders events when requestAnimationFrame never fires (never-painted tab)', async ({ page }) => {
    // Force the hang's exact precondition: rAF callbacks never run. Applied
    // before any page script so the fizz runtime and React see the stub. Safe:
    // /app content is CSS-animated (tailwindcss-animate) and React commits via
    // its MessageChannel scheduler — neither is gated on rAF — so on the fixed
    // (ssr:false) mount the board still renders. Only a server-streamed Suspense
    // shell (the regression) would deadlock here.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, value: () => 0 });
      Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, value: () => undefined });
    });
    await page.goto(DEV_LOGIN);
    await expectEventBoardVisible(page);
  });
});
