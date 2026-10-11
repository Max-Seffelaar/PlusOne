import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient } from '../e2e/helpers/supabase-admin';

/**
 * Flow: the who-did-what chip on the DOOR row holds at phone width
 * (spec #62a, review #466 V1b). A guest with a long name and a long custom tier,
 * added with no adder (a request-link sign-up → the compact "System" chip), on
 * the offline-outbox door. At 375/390 the row must not scroll sideways, the
 * chip must stay inside its caption (border intact, it may collapse to the
 * icon), and the caption inside the row.
 *
 * Phone variants only: the desktop cockpit renders the list differently.
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const VENUE = 'aa000000-0000-7000-8000-000000000001'; // Club Vesper

async function provision(variant: string): Promise<{ eventId: string; name: string }> {
  const a = adminClient();
  const tag = `${variant.split('-')[0]}${Date.now().toString(36).slice(-4)}`;
  const now = Date.now();
  const { data: ev, error: evErr } = await a
    .from('events')
    .insert({
      venue_id: VENUE,
      name: `Chip ${tag}`,
      starts_at: new Date(now - 30 * 60_000).toISOString(),
      ends_at: new Date(now + 5 * 3600_000).toISOString(),
      status: 'open',
      landing_slug: `chip-${tag}`,
      default_member_quota: 0,
    })
    .select('id')
    .single();
  if (evErr || !ev) throw new Error(`flow setup: event (${evErr?.message})`);
  const { data: tier, error: tErr } = await a
    .from('guest_tiers')
    .insert({ event_id: ev.id, name: 'VIP + fles op tafel extra lang', color: '#D4AF7A' })
    .select('id')
    .single();
  if (tErr || !tier) throw new Error(`flow setup: tier (${tErr?.message})`);
  // A landing guest without an adder must come through a request link
  // (CHECK guests_added_by_check). Creating the event already made its default
  // link (slug = landing_slug), so use that one.
  const { data: link, error: lErr } = await a
    .from('request_links')
    .select('id')
    .eq('event_id', ev.id)
    .eq('is_default', true)
    .single();
  if (lErr || !link) throw new Error(`flow setup: request link (${lErr?.message})`);
  const name = `Maximiliaan van Oldenbarnevelt-Spaarndam ${tag}`;
  const { error: gErr } = await a
    .from('guests')
    // added_by null = a request-link guest → the door names it with a typed chip.
    .insert({
      event_id: ev.id,
      tier_id: tier.id,
      full_name: name,
      plus_ones: 2,
      added_by: null,
      source: 'landing',
      request_link_id: link.id,
    });
  if (gErr) throw new Error(`flow setup: guest (${gErr.message})`);
  return { eventId: ev.id, name };
}

test('door row: the actor chip stays inside its caption and the row at phone width', async ({ page, flow }) => {
  if (flow.variant === 'desktop-browser') {
    flow.skip(1, 'Door row chip (phone door only; the desktop cockpit renders the list differently)');
    flow.skip(2, 'No sideways scroll (phone door only)');
    return;
  }
  const fx = await provision(flow.variant);
  await acceptConsent('door@plusone.test');
  await page.goto(`/auth/dev-login?email=door@plusone.test&next=${encodeURIComponent(`/app/door?event=${fx.eventId}`)}`);
  await page.waitForURL(/\/app\/door/);
  await expect(page.getByText(fx.name).first()).toBeVisible();
  await flow.shot('door-row-chip');

  await flow.check(1, 'The compact chip ends inside its caption (border intact) and the caption inside the row', async () => {
    const caption = page.locator('[data-actor-caption="chip"]').first();
    const chip = caption.locator('[data-actor-kind]').first();
    await expect(chip).toBeVisible();
    const row = caption.locator('xpath=ancestor::button[1]');
    const [cb, kb, rb] = await Promise.all([caption.boundingBox(), chip.boundingBox(), row.boundingBox()]);
    expect(cb && kb && rb).toBeTruthy();
    expect(kb!.x + kb!.width).toBeLessThanOrEqual(cb!.x + cb!.width + 0.5);
    expect(cb!.x + cb!.width).toBeLessThanOrEqual(rb!.x + rb!.width + 0.5);
    // The chip keeps at least its icon + border (min-w-[22px]).
    expect(kb!.width).toBeGreaterThanOrEqual(20);
  });

  await flow.check(2, 'The door list does not scroll sideways', async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    expectNoHorizontalOverflow(flow);
  });
});
