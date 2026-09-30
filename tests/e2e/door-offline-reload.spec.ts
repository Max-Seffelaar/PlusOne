import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { acceptConsent, adminClient } from './helpers/supabase-admin';

/**
 * N7 (decision 15): the Deur tab survives an OFFLINE RELOAD with its queue.
 *
 * Max's device bugs (2026-09-28): with the door open, going offline and
 * refreshing made the whole page disappear and the queued check-ins with it.
 * The fix has three legs, and this spec walks all of them in a real browser:
 *
 *  1. the service worker is registered under `/app` and has the `/app` shell +
 *     its chunks cached after ONE online visit (seed-session / seed-assets);
 *  2. offline, the Deur tab mounts the last pinned door event from IndexedDB
 *     because the candidate list cannot load;
 *  3. the outbox (IndexedDB) survives the reload and drains on reconnect —
 *     asserted on the DATABASE (one check_ins row, offline_synced, actor pinned),
 *     not just the UI.
 *
 * The worker is production-only; on localhost it is inert unless a page opts in
 * (`po:sw-dev-cache` → `/service-worker.js?dev-cache=1`, see
 * src/components/register-sw.tsx). This spec is the only opt-in.
 *
 * door@ = Lisa (doorhost at Club Vesper), no MFA. Phone viewport → the outbox
 * door (decision 14), not the desktop cockpit.
 */

const EVENT_ID = 'ee000000-0000-7000-8000-000000000001';
const REGULAR_TIER = 'dd000000-0000-7000-8000-000000000001';
const LISA_ID = '66666666-6666-4666-8666-666666666666'; // door@plusone.test
const MAX_ID = '11111111-1111-4111-8111-111111111111'; // admin (quota-exempt) — adds setup guests

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

async function seedGuest(name: string): Promise<string> {
  const id = uuidv7();
  const { error } = await adminClient().from('guests').insert({
    id,
    event_id: EVENT_ID,
    tier_id: REGULAR_TIER,
    full_name: name,
    added_by: MAX_ID,
    source: 'app',
    status: 'approved',
  });
  if (error) throw new Error(`seedGuest failed: ${error.message}`);
  return id;
}

async function checkInRows(guestId: string) {
  const { data, error } = await adminClient().from('check_ins').select('*').eq('guest_id', guestId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Resolves once the worker controls the page and holds what an offline cold
 *  start needs: the `/app` shell and the door's IndexedDB pin + snapshot. */
async function waitForOfflineReady(page: Page): Promise<void> {
  // `expect.poll` over `page.evaluate`, not `page.waitForFunction`: the latter
  // does not await an async predicate — the returned Promise is truthy, so it
  // "passed" before the (2 s-throttled) snapshot write had happened.
  const probe = () =>
    page.evaluate(async (eventId) => {
      if (!navigator.serviceWorker?.controller) return false;
      if (!(await caches.match('/app', { ignoreSearch: true }))) return false;
      // Read-only probe: it must never CREATE the database. An open that runs
      // `upgradeneeded` here would create an empty v1 `plusone-door` without the
      // app's `kv` store, and the app's own open would then never upgrade it.
      const db = await new Promise<IDBDatabase | null>((resolve) => {
        const req = indexedDB.open('plusone-door');
        req.onupgradeneeded = () => req.transaction?.abort();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
      if (!db || !db.objectStoreNames.contains('kv')) return false;
      const get = (key: string) =>
        new Promise<unknown>((resolve) => {
          const r = db.transaction('kv').objectStore('kv').get(key);
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => resolve(undefined);
        });
      const [pin, persisted] = await Promise.all([get('door-last-event'), get('door-query-cache')]);
      db.close();
      // The persisted client must hold THIS event's snapshot with data — a blob
      // written before the snapshot query resolved holds only the quota query.
      const queries =
        (persisted as { clientState?: { queries?: { queryKey: unknown[]; state: { data?: unknown } }[] } } | undefined)
          ?.clientState?.queries ?? [];
      const snapshot = queries.some(
        (q) => q.queryKey[0] === 'door' && q.queryKey[1] === eventId && q.state.data !== undefined,
      );
      return Boolean(pin) && snapshot;
    }, EVENT_ID);
  await expect.poll(probe, { timeout: 60_000, intervals: [500] }).toBe(true);
}

/** Status of this event's snapshot query in the persisted door cache:
 *  'success' | 'error' | 'missing' (no blob, or the blob lacks the query). */
async function persistedSnapshotStatus(page: Page): Promise<string> {
  return page.evaluate(async (eventId) => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open('plusone-door');
      req.onupgradeneeded = () => req.transaction?.abort(); // never create it
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db || !db.objectStoreNames.contains('kv')) return 'missing';
    const persisted = await new Promise<unknown>((resolve) => {
      const r = db.transaction('kv').objectStore('kv').get('door-query-cache');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    });
    db.close();
    const queries =
      (persisted as { clientState?: { queries?: { queryKey: unknown[]; state: { status: string } }[] } } | undefined)
        ?.clientState?.queries ?? [];
    const q = queries.find((x) => x.queryKey[0] === 'door' && x.queryKey[1] === eventId);
    return q ? q.state.status : 'missing';
  }, EVENT_ID);
}

/**
 * Really offline. `context.setOffline` flips `navigator.onLine` and fails the
 * PAGE's requests, but Chromium does not reliably apply it to the service
 * worker's own fetches — the worker then reaches the dev server and the test
 * proves nothing. Aborting every request to the app and to the local Supabase at
 * the context level covers the worker too (Chromium routes SW traffic through
 * `context.route`).
 */
const APP_AND_SUPABASE = /\/\/(localhost|127\.0\.0\.1):\d+\//;
/** Dead venue wifi: every request fails but `navigator.onLine` stays TRUE —
 *  also what Android WebView reports without ACCESS_NETWORK_STATE. The door
 *  then keeps trying to sync and its snapshot refetch fails. */
async function goDeadWifi(context: BrowserContext): Promise<void> {
  await context.route(APP_AND_SUPABASE, (route) => route.abort('internetdisconnected'));
}
async function goOnline(context: BrowserContext): Promise<void> {
  await context.unroute(APP_AND_SUPABASE);
  await context.setOffline(false);
}

/** The door candidate read: `fetchEvents` (src/features/po/queries.ts) is the
 *  only `/rest/v1/events` read ordered by `starts_at` while the Deur tab is up
 *  (the door snapshot reads one event by id; `usePoEvents` lives in
 *  `AppScreens`, which is not mounted on the door tab). */
const CANDIDATE_READ = /\/rest\/v1\/events\?.*order=starts_at\.desc/;

/** A running count of FAILED candidate reads on this page, across navigations. */
function trackFailedCandidateReads(page: Page): () => number {
  let failed = 0;
  page.on('requestfailed', (req) => {
    if (CANDIDATE_READ.test(req.url())) failed += 1;
  });
  return () => failed;
}

/** The door is up with the check-in still queued — and STAYS up once the
 *  candidate query has settled (a door mounted only while that query is
 *  "loading" would pass a single look and vanish right after).
 *
 *  No fixed sleep: a sentinel in the page records if the search field EVER
 *  leaves the DOM, and we wait for the real settling condition — the candidate
 *  read's first attempt AND its one retry (`retry: 1`, PoLiveProvider) have
 *  both failed since `failedBefore`, so the query is in `error` for good. */
async function expectDoorHoldsQueue(page: Page, failedReads: () => number, failedBefore: number): Promise<void> {
  const search = page.getByPlaceholder('Search a name…');
  await expect(search).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/1 queued/)).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => {
    const w = window as unknown as { __doorLost?: boolean };
    w.__doorLost = false;
    const present = () => document.querySelector('input[placeholder="Search a name…"]') !== null;
    new MutationObserver(() => {
      if (!present()) w.__doorLost = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await expect
    .poll(() => failedReads() - failedBefore, {
      message: 'the candidate read (first attempt + its one retry) should have failed offline',
      timeout: 30_000,
      intervals: [250],
    })
    .toBeGreaterThanOrEqual(2);
  expect(
    await page.evaluate(() => (window as unknown as { __doorLost?: boolean }).__doorLost),
    'the door must never leave the page once the candidate read has failed',
  ).toBe(false);
  await expect(search).toBeVisible();
  await expect(page.getByText(/1 queued/)).toBeVisible();
}

/** Outbox entries on disk that a drain would still (re)send: anything not yet
 *  settled as synced/duplicate. Read-only, like the probes above. */
async function unsettledOutboxEntries(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      const req = indexedDB.open('plusone-door');
      req.onupgradeneeded = () => req.transaction?.abort(); // never create it
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    });
    if (!db || !db.objectStoreNames.contains('kv')) return -1;
    const stored = await new Promise<unknown>((resolve) => {
      const r = db.transaction('kv').objectStore('kv').get('door-outbox');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    });
    db.close();
    const entries = (stored as { entries?: { status: string }[] } | undefined)?.entries ?? [];
    return entries.filter((e) => e.status !== 'synced' && e.status !== 'duplicate').length;
  });
}

test.describe('door: offline reload keeps the door and its queue (N7)', () => {
  test.beforeAll(async () => {
    await acceptConsent('door@plusone.test');
  });

  test('reload while offline boots the Deur tab from local caches; the queued check-in syncs once', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const guestName = `Reload Guest ${Date.now()}`;
    const guestId = await seedGuest(guestName);
    const failedCandidateReads = trackFailedCandidateReads(page);

    // Opt this page into the (normally production-only) worker before any script runs.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('po:sw-dev-cache', '1');
      } catch {
        /* ignore */
      }
    });

    // ── Online: log in and open the door once. ─────────────────────────────
    // Explicit `?event=`: earlier smoke specs create more upcoming events, and
    // with several candidates the Deur tab (rightly) asks which one first.
    await page.goto(
      `/auth/dev-login?email=door@plusone.test&next=${encodeURIComponent(`/app/door?event=${EVENT_ID}`)}`,
    );
    await page.waitForURL('**/app/door**', { timeout: 60_000 });
    const search = page.getByPlaceholder('Search a name…');
    await expect(search).toBeVisible({ timeout: 60_000 });
    await search.fill(guestName);
    await expect(page.getByText(guestName).first()).toBeVisible({ timeout: 30_000 });
    await waitForOfflineReady(page);

    // ── Dead wifi: check the guest in (queued in the outbox), then force a
    //    sync. The snapshot refetch fails and flips the door query to `error`
    //    while it keeps its data — the state that used to be dropped from the
    //    next IndexedDB write, emptying the door on the following reload. ────
    await goDeadWifi(context);
    await page.getByText(guestName).first().click();
    await page.getByRole('button', { name: /^Check in · 1 person/ }).click();
    await expect(page.getByText(/1 queued/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Sync now' }).click();
    // Wait until the failed refetch has reached IndexedDB: the persisted
    // snapshot is no longer a plain 'success'. With the fix it is 'error' WITH
    // its data; before it, the query was simply missing from the blob.
    await expect
      .poll(() => persistedSnapshotStatus(page), { timeout: 60_000, intervals: [1000] })
      .not.toBe('success');
    expect(await checkInRows(guestId)).toHaveLength(0);

    // ── Fully offline from here (navigator.onLine false too). ───────────────
    await context.setOffline(true);

    // ── Offline RELOAD: the page must come back, with the item still queued. ─
    const failedBeforeReload = failedCandidateReads();
    const reloaded = await page.reload({ waitUntil: 'domcontentloaded' });
    expect(reloaded?.fromServiceWorker(), 'the offline reload must be served by the worker').toBe(true);
    await expectDoorHoldsQueue(page, failedCandidateReads, failedBeforeReload);

    // ── Offline COLD START at `/`, the way the native shell launches: no
    //    `?event=` to lean on — the worker sends a signed-in device to the Deur
    //    tab and the tab mounts the pinned event from IndexedDB. ─────────────
    const failedBeforeStart = failedCandidateReads();
    const started = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(started?.fromServiceWorker(), 'the offline start must be served by the worker').toBe(true);
    await page.waitForURL('**/app/door**', { timeout: 30_000, waitUntil: 'commit' });
    await expectDoorHoldsQueue(page, failedCandidateReads, failedBeforeStart);
    expect(await checkInRows(guestId)).toHaveLength(0);

    // ── Reconnect: the outbox drains exactly once (idempotent upsert). ─────
    await goOnline(context);
    await expect.poll(async () => (await checkInRows(guestId)).length, { timeout: 90_000, intervals: [1000] }).toBe(1);
    const [row] = await checkInRows(guestId);
    expect(row.checked_by).toBe(LISA_ID); // RLS pinned the actor to the session user
    expect(row.offline_synced).toBe(true);
    expect(row.event_id).toBe(EVENT_ID);
    await expect(page.getByText(/queued/)).toHaveCount(0, { timeout: 30_000 });

    // The drained entry is settled ON DISK, so a reload has nothing to replay.
    await expect.poll(() => unsettledOutboxEntries(page), { timeout: 30_000, intervals: [500] }).toBe(0);

    // A second online reload replays nothing: the outbox the reloaded page
    // restores still holds nothing to send, and there is still exactly one row.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByPlaceholder('Search a name…')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => unsettledOutboxEntries(page), { timeout: 30_000, intervals: [500] }).toBe(0);
    await expect(page.getByText(/queued/)).toHaveCount(0);
    expect(await checkInRows(guestId)).toHaveLength(1);
  });
});
