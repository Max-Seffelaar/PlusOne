import { test, expect } from '@playwright/test';
import { adminClient } from './helpers/supabase-admin';

// STAP 4.3 — the core-flow smoke (Prod-ready 9/7 — 04, 86ey7q6ze).
//
// One deliberately small spec: dev-login as the venue admin → create an event →
// add a guest (creating the first tier inline) → check the guest in at the door.
// Every step is then asserted DIRECTLY IN THE DATABASE via the service-role
// client — never via UI text. That catches exactly the class of bug that slips
// past unit tests and the DoD: the UI says "ok" while RLS silently dropped the
// write (C15), or the audit trigger silently didn't fire (C7).
//
// Runs against the local Supabase stack (seed loaded) + `pnpm dev`; in CI the
// stack is started by `supabase start` and Playwright boots the dev server.
// admin@plusone.test = Max de Vries, {admin} at Club Vesper (seed). A fresh
// seed has no MFA factor on the account, so dev-login lands straight in /app;
// locally a dev:mfa-stamped TOTP factor is completed server-side by the route.

const ADMIN_EMAIL = 'admin@plusone.test';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const VENUE_ID = 'aa000000-0000-7000-8000-000000000001'; // Club Vesper

// Unique per run so local re-runs never collide (CI is always a fresh DB).
const STAMP = Date.now().toString(36);
const EVENT_NAME = `Smoke Night ${STAMP}`;
// Letters-only: digits/+ would engage the quick-add parser's +N handling.
const GUEST_NAME = 'Smoke Tester';

/** dd-mm-yyyy for the typeable desktop DateField, `days` from now. */
function typedDate(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

test('core flow: create event → add guest → door check-in, asserted in the database', async ({ page }) => {
  const db = adminClient();
  // The dev server may compile these routes on first hit (CI runs `next dev`).
  test.setTimeout(240_000);

  // On a fresh DB the admin has no TOTP factor, so /app would redirect once to
  // the skippable /mfa/enroll recommendation (MFA is fully optional, #20
  // refinement). Snooze it up front — the enroll nudge is not this smoke's
  // subject. No-op locally, where dev:mfa stamps a factor.
  await db.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', ADMIN_ID);

  // ── 1. Dev-login as the admin, land on /app (desktop sidebar ≥1024px). ──────
  await page.goto(`/auth/dev-login?email=${ADMIN_EMAIL}&next=/app`);
  // First login on a fresh DB hits the terms/privacy gate (#20/#40) once.
  await page.waitForURL(/\/(app|consent)/, { timeout: 60_000 });
  if (page.url().includes('/consent')) {
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Agree & continue' }).click();
  }
  await page.waitForURL('**/app', { timeout: 60_000 });

  // ── 2. Create an event via the Events tab. ──────────────────────────────────
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  await page.getByRole('button', { name: 'New event' }).click({ timeout: 30_000 });

  await page.getByPlaceholder('e.g. FRENZY').fill(EVENT_NAME);
  // Start = +3 days so the event is safely "upcoming" for the quick-add picker.
  const dateField = page.getByLabel('Pick a date').first();
  await dateField.fill(typedDate(3));
  await dateField.press('Enter');
  const timeField = page.getByLabel('Hour').first();
  await timeField.fill('22:00');
  await timeField.press('Enter');
  await page.getByRole('button', { name: 'Create event' }).click();

  // Success replaces the form with the saved event's settings screen.
  await expect(page.getByText('Edit event')).toBeVisible({ timeout: 20_000 });

  // DB truth: the event row exists at the right venue (not just a UI transition).
  const eventId = await expect
    .poll(
      async () => {
        const { data } = await db.from('events').select('id, venue_id').eq('name', EVENT_NAME).maybeSingle();
        return data && data.venue_id === VENUE_ID ? (data.id as string) : null;
      },
      { timeout: 15_000, intervals: [250, 500, 1000] },
    )
    .not.toBeNull()
    .then(async () => {
      const { data } = await db.from('events').select('id').eq('name', EVENT_NAME).single();
      return data!.id as string;
    });

  // ── 3. Add a guest via quick-add (first tier created inline). ───────────────
  await page.getByRole('button', { name: 'Back' }).click(); // form → Events list
  await page.getByRole('button', { name: 'Add guest' }).click();

  // Pin the quick-add to OUR event via the picker (don't rely on sort order).
  // The selected-event row is the one button whose subline says "doors {time}".
  await page.locator('button', { hasText: /doors \d/ }).first().click();
  await expect(page.getByText('Pick an event')).toBeVisible();
  // .last(): when our event is already selected, the row behind the sheet
  // matches too — the sheet renders after it in the DOM.
  await page.getByRole('button', { name: new RegExp(EVENT_NAME) }).last().click();

  // A fresh event has no tiers → the inline create-tier escape hatch.
  await expect(page.getByText('This event has no guest tiers yet.')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Create tier' }).click(); // opens the form (opener unmounts)
  await page.getByPlaceholder('e.g. "Regular" or "Guest list"').fill('Regular');
  await page.getByRole('button', { name: 'Create tier' }).click(); // submits

  // Tier exists in the DB before we type the guest (audited as 'create' too).
  await expect
    .poll(
      async () => {
        const { data } = await db.from('guest_tiers').select('id').eq('event_id', eventId);
        return data?.length ?? 0;
      },
      { timeout: 15_000, intervals: [250, 500, 1000] },
    )
    .toBe(1);

  await page.getByPlaceholder('e.g. "Juri Braakman +2 vip"').fill(GUEST_NAME);
  await page.getByRole('button', { name: `Add · ${GUEST_NAME}` }).click();

  // DB truth: the guest row exists, attributed to the admin, on our event.
  const guestId = await expect
    .poll(
      async () => {
        const { data } = await db
          .from('guests')
          .select('id, added_by, status')
          .eq('event_id', eventId)
          .eq('full_name', GUEST_NAME)
          .maybeSingle();
        return data && data.added_by === ADMIN_ID && data.status === 'approved' ? (data.id as string) : null;
      },
      { timeout: 15_000, intervals: [250, 500, 1000] },
    )
    .not.toBeNull()
    .then(async () => {
      const { data } = await db.from('guests').select('id').eq('event_id', eventId).eq('full_name', GUEST_NAME).single();
      return data!.id as string;
    });

  // Audit truth (#4, trigger-written): the guest INSERT was logged (C7 class).
  const { data: guestAudit } = await db
    .from('audit_log')
    .select('action, actor_id, event_id')
    .eq('entity_type', 'guests')
    .eq('entity_id', guestId)
    .eq('action', 'create');
  expect(guestAudit ?? []).toHaveLength(1);
  expect(guestAudit![0].actor_id).toBe(ADMIN_ID);
  expect(guestAudit![0].event_id).toBe(eventId);

  // ── 4. Door check-in on the standalone door route. ──────────────────────────
  // G2: /door/[eventId] now redirects a DESKTOP viewport straight into /app's
  // Deur tab (the whole point of this suite's step 1-3 desktop UI) — a mobile
  // viewport is what actually stays on the standalone Door-modus this step
  // means to cover.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/door/${eventId}`);
  await page.getByPlaceholder('Search a name…').fill(GUEST_NAME, { timeout: 30_000 });
  await page.getByRole('button', { name: new RegExp(GUEST_NAME) }).click();
  await page.getByRole('button', { name: /Check in · 1 person/ }).click();

  // DB truth: the check_ins row landed with the session user as actor (C15 class:
  // the UI is optimistic — only the database proves RLS accepted the write).
  await expect
    .poll(
      async () => {
        const { data } = await db.from('check_ins').select('id').eq('guest_id', guestId);
        return data?.length ?? 0;
      },
      { timeout: 20_000, intervals: [500, 1000] },
    )
    .toBe(1);
  const { data: checkIns } = await db.from('check_ins').select('id, checked_by').eq('guest_id', guestId);
  const checkIn = checkIns![0];
  expect(checkIn.checked_by).toBe(ADMIN_ID);

  // Audit truth: the check-in trigger fired, scoped to our event and actor.
  const { data: checkInAudit } = await db
    .from('audit_log')
    .select('action, actor_id, event_id')
    .eq('entity_type', 'check_ins')
    .eq('entity_id', checkIn.id)
    .eq('action', 'check_in');
  expect(checkInAudit ?? []).toHaveLength(1);
  expect(checkInAudit![0].actor_id).toBe(ADMIN_ID);
  expect(checkInAudit![0].event_id).toBe(eventId);
});
