import { test, expect, expectNoHorizontalOverflow, reportsNative, PURCHASE_COPY } from './harness';
import type { Request } from '@playwright/test';
import { acceptConsent, adminClient } from '../e2e/helpers/supabase-admin';

/**
 * Flow: Share-import S2 (z8uq9m43m8), in all four variants.
 *
 * What the OS share sheet does for an installed PWA (manifest `share_target`,
 * method GET) is open `/app/share?title=…&text=…`; this flow opens exactly that
 * URL as staff@ (Club Vesper, a quota-bound list builder) with a list as WhatsApp/Notes/Sheets would
 * send it: a column header, a bullet, +N, an e-mail and a tab-separated row.
 *
 *   share URL → Paste a list with the text, URL stripped → event + tier picked
 *   → preview + count → Add → the event's guest list (rows in the database)
 *   → a reload of /app/share is empty (the text lived in memory only)
 *
 * Every request is recorded. The shared text may travel in exactly one request
 * after the share launch itself: the import (the existing bulk-add server
 * action). Bare names additionally reach the two existing Paste a list lookups
 * (contact match, K3; the duplicate check at Add, 86ey8xg4p) — those are
 * allow-listed by name, anything else carrying a name fails Q6.
 *
 * Guests get a per-run suffix so a re-run never trips the duplicate prompt;
 * they stay on the seed event like every other flow's fixtures (soft delete
 * only, rule #3). Numbered checks = the ✅ half of the PR's test handoff.
 */

const VESPER = 'aa000000-0000-7000-8000-000000000001';
const SEED_EVENT = 'ee000000-0000-7000-8000-000000000001';
const VIP_TIER = 'dd000000-0000-7000-8000-000000000002';
const STAFF = 'staff@plusone.test';
const STAFF_ID = '55555555-5555-4555-8555-555555555555';
// user_manager only: manages the team, has no guest rights (can_write_guests).
const MANAGER = 'manager@plusone.test';

/** staff@'s per-event slot override on the seed event (event_quotas; the seed
 *  sets 12). Every run adds guests there, so the flow sets its own allowance
 *  and puts the seed's value back afterwards. */
async function setStaffOverride(count: number | null): Promise<void> {
  const a = adminClient();
  const { error } =
    count === null
      ? await a.from('event_quotas').delete().eq('event_id', SEED_EVENT).eq('user_id', STAFF_ID)
      : await a.from('event_quotas').upsert({ event_id: SEED_EVENT, user_id: STAFF_ID, quota_override: count }, { onConflict: 'event_id,user_id' });
  if (error) throw new Error(`share flow quota fixture: ${error.message}`);
}

let overrideBefore: number | null = null;

test.beforeAll(async () => {
  await acceptConsent(STAFF);
  await acceptConsent(MANAGER);
  const { data } = await adminClient()
    .from('event_quotas')
    .select('quota_override')
    .eq('event_id', SEED_EVENT)
    .eq('user_id', STAFF_ID)
    .maybeSingle();
  overrideBefore = data?.quota_override ?? null;
  await setStaffOverride(1000);
});

test.afterAll(async () => {
  await setStaffOverride(overrideBefore);
});

test('share import: shared text lands on Paste a list, imports once, never leaks', async ({ page, context, flow, baseURL }) => {
  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  await context.addCookies([{ name: 'po_active_venue', value: VESPER, domain: host, path: '/' }]);
  const a = adminClient();

  // Per-run, per-variant names: "Milan Hendriks mvbaucpd". Letters only — a
  // token with 3+ digits reads as a broken phone number in the preview.
  const tag = `${Date.now().toString(36).replace(/\d/g, (d) => 'abcdefghij'[Number(d)])}${flow.variant.slice(0, 1)}`;
  const MILAN = `Milan Hendriks ${tag}`;
  const FLEUR = `Fleur Janssen ${tag}`;
  const SEM = `Sem de Vries ${tag}`;
  const NOOR = `Noor Bakker ${tag}`;
  const NAMES = [MILAN, FLEUR, SEM, NOOR];
  const LINES = [`${MILAN} +2`, `${FLEUR} fleur.${tag}@example.com`, `${SEM}\tsem.${tag}@example.com\t1`, NOOR];
  const SHARED = ['Name\tEmail', `- ${LINES[0]}`, `• ${LINES[1]}`, LINES[2], LINES[3]].join('\n');

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(STAFF)}&next=/app`);
  await page.waitForURL(/\/app/);
  await page.waitForLoadState('networkidle').catch(() => {});

  // ── Record every request from the share launch on ──────────────────────────
  const seen: Request[] = [];
  page.on('request', (r) => seen.push(r));
  const shareUrl = `/app/share?${new URLSearchParams({ title: 'Guest list Friday', text: SHARED }).toString()}`;
  await page.goto(shareUrl);
  const box = page.locator('textarea');
  await expect(box).toBeVisible();
  await expect(page.getByText('Paste a list').first()).toBeVisible();
  await flow.shot('shared-landing');

  await flow.check(1, 'Sharing a list opens Paste a list with the shared text already in the box', async () => {
    await expect(box).toHaveValue(SHARED);
  });
  await flow.check(2, 'Right after landing the address bar is just /app/share: the text is not in the URL', async () => {
    const u = new URL(page.url());
    expect(u.pathname + u.search + u.hash).toBe('/app/share');
  });

  const [eventSelect, tierSelect] = [page.getByRole('combobox', { name: 'Event' }), page.getByRole('combobox', { name: 'Tier' })];
  await flow.check(3, 'Event defaults to the next upcoming event (top of the list); the tier picker shows the default tier', async () => {
    const first = await eventSelect.locator('option').first().getAttribute('value');
    await expect(eventSelect).toHaveValue(first ?? '');
    await expect(tierSelect.locator('option:checked')).toHaveText('Regular');
  });

  await eventSelect.selectOption(SEED_EVENT);
  await tierSelect.selectOption(VIP_TIER);
  await expect(page.getByTestId('paste-summary')).toBeVisible();
  await flow.shot('preview-vip');

  await flow.check(4, 'Preview: header row skipped, bullets gone, +N and e-mails read; count says "4 entries · 7 guests total · 2 with e-mail"', async () => {
    await expect(page.getByTestId('paste-summary')).toHaveText('4 entries · 7 guests total · 2 with e-mail');
    await expect(page.getByText('Preview · 4 lines')).toBeVisible();
    for (const n of NAMES) await expect(page.getByText(n, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/^Name\s*Email$/)).toHaveCount(0);
  });

  await flow.check(8, 'Pickers: no sideways scroll; on touch the event and tier pickers are at least 44px tall', async () => {
    const touch = flow.variant !== 'desktop-browser';
    for (const s of [eventSelect, tierSelect]) {
      const b = await s.boundingBox(); // the <select> itself is the tap target
      expect(b).not.toBeNull();
      if (touch) expect(b!.height).toBeGreaterThanOrEqual(44);
    }
  });

  const add = page.getByRole('button', { name: 'Add 4 guests' });
  await expect(add).toBeEnabled();
  const importsBefore = seen.length;
  await add.click();
  await page.waitForURL(new RegExp(`/app/events/${SEED_EVENT}/guests`));
  await expect(page.getByText(MILAN).first()).toBeVisible();
  await flow.shot('guest-list-after-import');

  await flow.check(5, 'Add puts all four on the picked event with the picked tier, +N and e-mail (database), and opens that guest list', async () => {
    const { data, error } = await a
      .from('guests')
      .select('full_name, plus_ones, email, tier_id, status, event_id')
      .eq('event_id', SEED_EVENT)
      .like('full_name', `%${tag}`);
    expect(error).toBeNull();
    const byName = new Map((data ?? []).map((g) => [g.full_name, g]));
    expect([...byName.keys()].sort()).toEqual([...NAMES].sort());
    expect(byName.get(MILAN)).toMatchObject({ plus_ones: 2, email: null, tier_id: VIP_TIER });
    expect(byName.get(FLEUR)).toMatchObject({ plus_ones: 0, email: `fleur.${tag}@example.com`, tier_id: VIP_TIER });
    expect(byName.get(SEM)).toMatchObject({ plus_ones: 1, email: `sem.${tag}@example.com`, tier_id: VIP_TIER });
    expect(byName.get(NOOR)).toMatchObject({ plus_ones: 0, tier_id: VIP_TIER });
  });

  await flow.check(6, 'Network: after the share launch, only the import request carries the shared text; names reach only the existing Paste a list lookups', async () => {
    const launch = seen.filter((r) => r.isNavigationRequest() && r.url().includes('text='));
    expect(launch, 'the share launch is one document request, no redirect re-carrying it').toHaveLength(1);
    const rest = seen.filter((r) => !launch.includes(r));
    const body = (r: Request): string => {
      try {
        return decodeURIComponent(`${r.url()}\n${r.postData() ?? ''}`);
      } catch {
        return `${r.url()}\n${r.postData() ?? ''}`;
      }
    };
    // The text itself: the whole blob, any shared line that is more than a bare
    // name (+N, e-mail, Sheets columns), or an e-mail from it. Noor's line IS
    // her bare name, which the name rule below covers.
    const textLines = [SHARED, ...LINES.slice(0, 3)];
    const carriesText = rest.filter((r) => textLines.some((l) => body(r).includes(l)) || body(r).includes(`.${tag}@example.com`));
    const importReqs = rest.filter((r) => r.method() === 'POST' && new URL(r.url()).origin === origin && !!r.headers()['next-action']);
    expect(carriesText.filter((r) => !importReqs.includes(r)).map((r) => r.url())).toEqual([]);
    expect(seen.indexOf(importReqs[0])).toBeGreaterThanOrEqual(importsBefore);
    // Bare names: the import, plus the two existing lookups (K3 contact match,
    // duplicate check) — on Supabase, never on our own server.
    const carriesName = rest.filter((r) => NAMES.some((n) => body(r).includes(n)));
    const unexpected = carriesName.filter((r) => {
      if (importReqs.includes(r)) return false;
      const u = new URL(r.url());
      if (u.origin === origin) return true;
      return !(u.pathname === '/rest/v1/contacts' || u.pathname === '/rest/v1/rpc/find_event_guests_by_names');
    });
    expect(unexpected.map((r) => `${r.method()} ${new URL(r.url()).pathname}`)).toEqual([]);
  });

  await page.goto('/app/share');
  await expect(page.locator('textarea')).toBeVisible();
  await flow.shot('share-reload-empty');
  await flow.check(7, 'Opening /app/share again shows an empty box: the shared text was kept in memory only', async () => {
    await expect(page.locator('textarea')).toHaveValue('');
  });

  // ── Over quota: the preview blocks the batch and Add imports nothing ────────
  await setStaffOverride(1);
  const OVER = `Daan Visser ${tag}`;
  await page.goto(`/app/share?${new URLSearchParams({ text: `${OVER} +1` }).toString()}`);
  await expect(page.locator('textarea')).toHaveValue(`${OVER} +1`);
  await eventSelect.selectOption(SEED_EVENT);
  await expect(page.getByText(/The whole batch is blocked/)).toBeVisible();
  await flow.shot('over-quota');
  await flow.check(11, 'Over quota: the preview says the whole batch is blocked and Add puts nobody on the list', async () => {
    await page.getByRole('button', { name: 'Add 1 guest' }).click();
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).pathname).toBe('/app/share');
    const { count } = await a.from('guests').select('id', { count: 'exact', head: true }).eq('event_id', SEED_EVENT).eq('full_name', OVER);
    expect(count).toBe(0);
  });
  await setStaffOverride(1000);

  await flow.check(9, 'Native shell: the app reports native exactly in the native variants, and the share screen shows no purchase copy and no target=_blank link', async () => {
    expect(await reportsNative(page)).toBe(flow.native);
    await expect(page.locator('body')).not.toHaveText(PURCHASE_COPY);
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
  });

  // ── A role without guest rights: the share lands, Add is refused ──────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(MANAGER)}&next=/app`);
  await page.waitForURL(/\/app/);
  const DENIED = `Lotte Smit ${tag}`;
  await page.goto(`/app/share?${new URLSearchParams({ text: DENIED }).toString()}`);
  await expect(page.locator('textarea')).toHaveValue(DENIED);
  await page.getByRole('combobox', { name: 'Event' }).selectOption(SEED_EVENT);
  await page.getByRole('button', { name: 'Add 1 guest' }).click();
  await expect(page.getByText("You don't have rights for this.")).toBeVisible();
  await flow.shot('no-guest-rights');
  await flow.check(12, 'manager@ (user manager, no guest rights): Add says "You don\'t have rights for this." and nobody is added', async () => {
    const { count } = await a.from('guests').select('id', { count: 'exact', head: true }).eq('event_id', SEED_EVENT).eq('full_name', DENIED);
    expect(count).toBe(0);
    expect(new URL(page.url()).pathname).toBe('/app/share');
  });

  await flow.check(10, 'No step scrolls sideways and the page threw no uncaught errors', async () => {
    expectNoHorizontalOverflow(flow);
    expect(flow.pageErrors).toEqual([]);
  });
});
