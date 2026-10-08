import { test, expect, expectNoHorizontalOverflow, reportsNative } from './harness';
import type { Locator, Page } from '@playwright/test';
import { acceptConsent, adminClient } from '../e2e/helpers/supabase-admin';

/**
 * Flow: group-first check-in at the door (z8uq9m2vg6), as door@ (Lisa —
 * doorhost + staff on Club Vesper), in all four variants:
 *
 *   phone / phone-native / iPad-native → the Deur tab's offline-outbox door
 *     (coarse pointer, decision 14): header shows the event location; a party of
 *     four gets "Check in all (4)" + "Check in 1"; three taps on "Check in 1"
 *     read 3/4; "Check in all (1)" finishes the party — one check_ins row
 *     throughout. Then the undo: the setting is switched off while door@ is
 *     looking at an inside guest, the queued undo is refused by the database,
 *     settles quietly with a toast, and the guest stays inside; reopened, the
 *     undo button is gone and the note says who can.
 *   desktop-browser → the Event-dag cockpit (fine pointer ≥1024): the same two
 *     buttons in the check-in modal, 3/4 on the way, and the ✗ locked for door@
 *     with the setting off.
 *
 * Each variant provisions its OWN live event through the service-role helper
 * (one event per variant, flows run serially), so toggling the per-event undo
 * override never touches the seed company or another variant. The company
 * default itself is off since z8uq9m2vg6; the event override switches it on for
 * the first half.
 *
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const VENUE = 'aa000000-0000-7000-8000-000000000001'; // Club Vesper
const ADMIN = '11111111-1111-4111-8111-111111111111';
const LISA = '66666666-6666-4666-8666-666666666666';
const LOCATION = 'Paradiso';

interface Fixture {
  eventId: string;
  eventName: string;
  group: { id: string; name: string };
  inside: { id: string; name: string };
}

async function provision(variant: string): Promise<Fixture> {
  const a = adminClient();
  const tag = `${variant.split('-')[0]}${Date.now().toString(36).slice(-4)}`;
  const eventName = `Door D ${tag}`;
  const now = Date.now();
  const { data: ev, error: evErr } = await a
    .from('events')
    .insert({
      venue_id: VENUE,
      name: eventName,
      starts_at: new Date(now - 30 * 60_000).toISOString(),
      ends_at: new Date(now + 5 * 3600_000).toISOString(),
      status: 'open',
      landing_slug: `door-d-${tag}`,
      default_member_quota: 0,
      location_name: LOCATION,
      // On for now: door@ must see "Reverse check-in" before the switch-off.
      allow_uncheck: true,
    })
    .select('id')
    .single();
  if (evErr || !ev) throw new Error(`flow setup: event (${evErr?.message})`);
  const { data: tier, error: tErr } = await a
    .from('guest_tiers')
    .insert({ event_id: ev.id, name: 'Regular', color: '#8A8A93' })
    .select('id')
    .single();
  if (tErr || !tier) throw new Error(`flow setup: tier (${tErr?.message})`);
  const group = { name: `Groep ${tag}`, id: '' };
  const inside = { name: `Binnen ${tag}`, id: '' };
  const { data: guests, error: gErr } = await a
    .from('guests')
    .insert([
      { event_id: ev.id, tier_id: tier.id, full_name: group.name, plus_ones: 3, added_by: ADMIN },
      { event_id: ev.id, tier_id: tier.id, full_name: inside.name, plus_ones: 1, added_by: ADMIN },
    ])
    .select('id, full_name');
  if (gErr || !guests) throw new Error(`flow setup: guests (${gErr?.message})`);
  group.id = guests.find((g) => g.full_name === group.name)!.id;
  inside.id = guests.find((g) => g.full_name === inside.name)!.id;
  const { error: cErr } = await a.from('check_ins').insert({
    guest_id: inside.id,
    event_id: ev.id,
    checked_by: LISA,
    plus_ones_arrived: 1,
    client_timestamp: new Date(now - 10 * 60_000).toISOString(),
  });
  if (cErr) throw new Error(`flow setup: check-in (${cErr.message})`);
  return { eventId: ev.id, eventName, group, inside };
}

async function checkInsOf(guestId: string): Promise<{ plus_ones_arrived: number; voided_at: string | null }[]> {
  const { data } = await adminClient()
    .from('check_ins')
    .select('plus_ones_arrived, voided_at')
    .eq('guest_id', guestId);
  return data ?? [];
}

async function setEventUndo(eventId: string, on: boolean): Promise<void> {
  const { error } = await adminClient().from('events').update({ allow_uncheck: on }).eq('id', eventId);
  if (error) throw new Error(`flow: toggle undo (${error.message})`);
}

/** The cockpit row for a guest (CockpitGuestRow's two-column grid). */
function cockpitRow(page: Page, name: string): Locator {
  return page.locator('div[class*="grid-cols-[1fr_96px]"]', { hasText: name }).first();
}

test('door check-in: Check in all / Check in 1 (3/4), one row, undo refused with the setting off', async ({ page, flow }) => {
  const fx = await provision(flow.variant);
  // The plain seed has not accepted Terms yet; the consent gate is not what
  // this flow is about (the onboarding flow covers it).
  await acceptConsent('door@plusone.test');
  const cockpit = flow.variant === 'desktop-browser';

  await page.goto(`/auth/dev-login?email=door@plusone.test&next=${encodeURIComponent(`/app/door?event=${fx.eventId}`)}`);
  await page.waitForURL(/\/app\/door/);
  await expect(page.getByText(fx.group.name).first()).toBeVisible();

  if (!cockpit) {
    await flow.check(1, 'Door header shows the event and its location ("… · Paradiso")', async () => {
      await expect(page.getByText(`${fx.eventName} · ${LOCATION}`).first()).toBeVisible();
    });
  } else {
    flow.skip(1, 'Door header location (phone door only; the cockpit header is unchanged)');
  }
  await flow.shot(cockpit ? 'cockpit' : 'door-list');

  // ── Open the party of four ────────────────────────────────────────────────
  if (cockpit) {
    await cockpitRow(page, fx.group.name).getByTitle(/Check in/i).first().click();
  } else {
    await page.getByText(fx.group.name).first().click();
  }
  await flow.check(2, 'A party of four gets "Check in all (4)" and "Check in 1" (0/4); no "how many?" question', async () => {
    await expect(page.getByRole('button', { name: /Check in all \(4\)/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Check in 1/ })).toContainText('0/4');
    await expect(page.getByText(/How many/i)).toHaveCount(0);
  });
  await flow.shot(cockpit ? 'checkin-modal' : 'guest-party-of-4');

  // ── "Check in 1" three times → 3/4 ────────────────────────────────────────
  for (let i = 0; i < 3; i++) {
    if (cockpit && i > 0) await cockpitRow(page, fx.group.name).getByTitle(/add more/).click();
    await page.getByRole('button', { name: /Check in 1/ }).click();
    if (cockpit) await expect(page.getByRole('button', { name: /Check in 1/ })).toHaveCount(0);
  }
  if (cockpit) await cockpitRow(page, fx.group.name).getByTitle(/add more/).click();
  await flow.check(3, '"Check in 1" three times reads 3/4, and "Check in all" now offers the last one (1)', async () => {
    await expect(page.getByRole('button', { name: /Check in 1/ })).toContainText('3/4');
    await expect(page.getByRole('button', { name: /Check in all \(1\)/ })).toBeVisible();
  });
  await flow.shot('check-in-1-three-of-four');

  await flow.check(4, 'Database: ONE check_ins row for the party, plus_ones_arrived 2 (3 people)', async () => {
    await expect.poll(async () => checkInsOf(fx.group.id)).toEqual([{ plus_ones_arrived: 2, voided_at: null }]);
  });

  await page.getByRole('button', { name: /Check in all \(1\)/ }).click();
  await flow.check(5, '"Check in all (1)" completes the party: still one row, now 4 of 4', async () => {
    await expect.poll(async () => checkInsOf(fx.group.id)).toEqual([{ plus_ones_arrived: 3, voided_at: null }]);
  });
  await flow.shot('party-complete');

  // ── Undo with the setting off ─────────────────────────────────────────────
  if (cockpit) {
    await setEventUndo(fx.eventId, false);
    await page.reload();
    await expect(page.getByText(fx.inside.name).first()).toBeVisible();
    flow.skip(6, 'Refused undo toast (outbox door only; the cockpit is online-only and locks the ✗)');
    flow.skip(7, 'Refused undo leaves the row active (outbox door only)');
    await flow.check(8, 'With the setting off, door@ cannot undo: the ✗ is locked', async () => {
      const out = cockpitRow(page, fx.inside.name).locator('button[disabled]');
      await expect(out).toHaveCount(1);
    });
    await flow.shot('undo-locked');
  } else {
    await page.getByText(fx.inside.name).first().click();
    await expect(page.getByRole('button', { name: 'Reverse check-in' })).toBeVisible();
    // An admin switches undo off while door@ is looking at the guest.
    await setEventUndo(fx.eventId, false);
    await page.getByRole('button', { name: 'Reverse check-in' }).click();
    await flow.check(6, 'The refused undo is reported once: "Undo not saved. Only admins and user managers…"', async () => {
      await expect(page.getByText(/Undo not saved/).first()).toBeVisible();
    });
    await flow.shot('undo-refused');
    await flow.check(7, 'Database: the check-in is NOT voided; the outbox holds no error entry', async () => {
      await expect.poll(async () => checkInsOf(fx.inside.id)).toEqual([{ plus_ones_arrived: 1, voided_at: null }]);
      const stuck = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const open = indexedDB.open('plusone-door');
            open.onerror = () => resolve(0);
            open.onsuccess = () => {
              try {
                const tx = open.result.transaction(open.result.objectStoreNames[0], 'readonly');
                const get = tx.objectStore(open.result.objectStoreNames[0]).get('door-outbox');
                get.onsuccess = () => {
                  const env = get.result as { entries?: { status: string }[] } | undefined;
                  resolve((env?.entries ?? []).filter((e) => e.status === 'error' || e.status === 'pending').length);
                };
                get.onerror = () => resolve(0);
              } catch {
                resolve(0);
              }
            };
          }),
      );
      expect(stuck).toBe(0);
    });
    await page.getByText(fx.inside.name).first().click();
    await flow.check(8, 'Reopened: no "Reverse check-in" for door@, the note says who can undo', async () => {
      await expect(page.getByText('Only admins and user managers can undo check-ins here.').first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reverse check-in' })).toHaveCount(0);
    });
    await flow.shot('undo-hidden');
  }

  await flow.check(9, 'No screenshotted step scrolls sideways', async () => {
    expectNoHorizontalOverflow(flow);
  });
  await flow.check(10, 'No uncaught page errors', async () => {
    expect(flow.pageErrors).toEqual([]);
  });
  if (flow.native) {
    await flow.check(11, 'Native-shell simulation is live (Capacitor reports native)', async () => {
      expect(await reportsNative(page)).toBe(true);
    });
  } else {
    flow.skip(11, 'Native-shell simulation (native variants only)');
  }
});
