// Promo app screens: every real PlusOne screen the storyboard needs, captured on the
// Kelder Nord demo data (scripts/promo-seed.mjs) with stable file names, for the
// edit (type C shots) and for keying into the green screens (type B shots).
// Run via screens.config.mjs; see the header there.
//
// Files: <out>/<device>/<nn>-<slug>.png. A screen that needs an interaction
// (refuse sheet, typed quick-add) is best effort: if the UI changed, the plain
// screen is still captured and the run reports it.
import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OUT = process.env.PROMO_SCREENS_DIR ?? join(homedir(), 'Documents', 'PlusOne promo', 'app-screens');

// Fixed ids from scripts/promo-seed.mjs.
const LIVE = 'b0300000-0000-7000-8000-000000000001'; // Velvet Hours, live now
const UPCOMING = 'b0300000-0000-7000-8000-000000000002'; // Afterglow
const PAST = 'b0300000-0000-7000-8000-000000000003'; // Season Opening
const GUEST_PLUS_TWO = 'b0600000-0000-7000-8000-000000000100'; // approved, +2, not yet inside
const GUEST_PAID = 'b0600000-0000-7000-8000-000000000115'; // Paid tier (EUR 17.50 at the door), +3, not yet inside

const OWNER = 'owner@kelder-nord.test'; // Robin Vermeer, admin
const DOOR = 'lotte@kelder-nord.test'; // Lotte Visser, head of door
const PROMOTER = 'mara@kelder-nord.test'; // Mara Jansen, staff with quota

const BOTH = ['phone', 'ipad-landscape'];
const PHONE = ['phone'];

/** nn-slug · who · where · devices · optional interaction before the shot. */
const SCREENS = [
  { slug: '01-home-owner', as: OWNER, path: '/app', devices: BOTH },
  { slug: '02-event-live', as: OWNER, path: `/app/events/${LIVE}`, devices: BOTH },
  { slug: '03-guest-list-live', as: OWNER, path: `/app/events/${LIVE}/guests`, devices: BOTH },
  { slug: '04-door-checkin', as: DOOR, path: `/app/door?event=${LIVE}`, devices: BOTH },
  { slug: '05-door-guest-detail', as: DOOR, path: `/app/door?event=${LIVE}&guest=${GUEST_PLUS_TWO}`, devices: PHONE },
  {
    slug: '06-door-refuse-reason',
    as: DOOR,
    path: `/app/door?event=${LIVE}&guest=${GUEST_PLUS_TWO}`,
    devices: PHONE,
    act: async (page) => {
      await page.getByRole('button', { name: /refuse/i }).first().click({ timeout: 10_000 });
      // Placeholder from src/lib/i18n/surfaces/door.ts (refusePlaceholder).
      await page.getByPlaceholder(/not on the list/i).fill('Too intoxicated', { timeout: 10_000 });
    },
  },
  {
    slug: '07-door-offline',
    as: DOOR,
    path: `/app/door?event=${LIVE}`,
    devices: PHONE,
    act: async (page) => {
      await page.context().setOffline(true);
      await page.waitForTimeout(2500);
    },
  },
  { slug: '08-add-guests-quota', as: PROMOTER, path: `/app/events/${UPCOMING}/add`, devices: PHONE },
  {
    slug: '09-add-guests-typed',
    as: PROMOTER,
    path: `/app/events/${UPCOMING}/add`,
    devices: PHONE,
    act: async (page) => {
      await page.getByPlaceholder(/John Doe/).first().fill('Sam de Wit +3', { timeout: 10_000 });
    },
  },
  { slug: '10-add-guests-paste', as: OWNER, path: `/app/events/${UPCOMING}/bulk`, devices: PHONE },
  { slug: '11-guest-list-locked-staff', as: PROMOTER, path: `/app/events/${LIVE}/guests`, devices: PHONE },
  { slug: '12-event-edit-lock', as: OWNER, path: `/app/events/${LIVE}/edit`, devices: PHONE },
  { slug: '13-requests', as: OWNER, path: '/app/requests', devices: BOTH },
  { slug: '14-requests-quota', as: OWNER, path: '/app/requests/quota', devices: PHONE },
  { slug: '15-audit-log', as: OWNER, path: '/app/audit', devices: BOTH },
  { slug: '16-landing-request', as: null, path: '/e/afterglow', devices: PHONE },
  { slug: '17-promotion-overview', as: OWNER, path: '/app/promotion', devices: BOTH },
  { slug: '18-analytics', as: OWNER, path: '/app/analytics', devices: BOTH },
  { slug: '19-recap-past', as: OWNER, path: `/app/events/${PAST}/recap`, devices: BOTH },
  { slug: '20-home-door', as: DOOR, path: '/app', devices: PHONE },
  { slug: '21-home-promoter', as: PROMOTER, path: '/app', devices: PHONE },
  { slug: '23-event-tiers-price', as: OWNER, path: `/app/events/${LIVE}/tiers`, devices: BOTH },
  { slug: '22-door-paid-guest', as: DOOR, path: `/app/door?event=${LIVE}&guest=${GUEST_PAID}`, devices: PHONE },
];

async function open(page, as, path) {
  if (!as) {
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 150_000 });
  } else {
    const login = `/auth/dev-login?email=${encodeURIComponent(as)}&next=${encodeURIComponent(path)}`;
    await page.goto(login, { waitUntil: 'domcontentloaded', timeout: 150_000 });
    const expected = path.split('?')[0];
    await page.waitForURL((u) => u.pathname === expected || u.pathname === '/login' || u.pathname === '/consent', { timeout: 90_000 });
    const landed = new URL(page.url()).pathname;
    if (landed !== expected) throw new Error(`dev-login as ${as} landed on ${landed} — did pnpm promo:seed run on this stack?`);
    // The /app shell is mounted once the boot screen is gone and real controls exist.
    await page.waitForFunction(() => !document.querySelector('[data-po-boot]') && !!document.querySelector('aside, button'), undefined, {
      timeout: 120_000,
    });
  }
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => document.querySelectorAll('.animate-pulse').length === 0, undefined, { timeout: 15_000 })
    .catch(() => undefined);
}

async function clean(page) {
  // Next's dev-tools badge never belongs in a promo; toasts get time to leave.
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('nextjs-portal'))) el.style.setProperty('display', 'none', 'important');
  });
  await page.waitForFunction(() => !document.querySelector('.po-anim-toast'), undefined, { timeout: 8_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

for (const s of SCREENS) {
  test(s.slug, async ({ page }, info) => {
    test.skip(!s.devices.includes(info.project.name), `not captured on ${info.project.name}`);
    await open(page, s.as, s.path);
    if (s.act) {
      try {
        await s.act(page);
        await page.waitForTimeout(600);
      } catch (err) {
        info.annotations.push({ type: 'interaction-skipped', description: String(err).slice(0, 200) });
      }
    }
    await clean(page);
    const dir = join(OUT, info.project.name);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${s.slug}.png`), animations: 'disabled', caret: 'hide' });
  });
}
