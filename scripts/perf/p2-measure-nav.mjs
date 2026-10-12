/**
 * Snelheid P2 finding 1 — what a tab tap costs. LOCAL STACK ONLY.
 *
 * Instrument (identical both sides): real Chromium, signed in as admin@ on Club
 * Vesper, desktop 1280×900 and phone 390×844. From Home it taps Events → Guests
 * → More → Events → Guests (first visits AND revisits) and records, per tap,
 * the document/RSC requests the page sends and the time from the click until
 * the new URL is live. Run against a dev server on origin/main (before) and one
 * on this branch (after):
 *   node --env-file=.env.local scripts/perf/p2-measure-nav.mjs http://localhost:7000
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:7000';
const VENUE = 'aa000000-0000-7000-8000-000000000001';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321';
if (!/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) throw new Error('local stack only');
const TERMS_VERSION = /TERMS_VERSION = '([^']+)'/.exec(readFileSync(new URL('../../src/lib/legal.ts', import.meta.url), 'utf8'))?.[1];
const db = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const TAPS = [
  ['Events', /\/app\/events$/],
  ['Guests', /\/app\/guests$/],
  ['More', /\/app\/more$/],
  ['Events', /\/app\/events$/],
  ['Guests', /\/app\/guests$/],
];

async function run(device) {
  const browser = await chromium.launch(process.env.PW_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } : {});
  const context = await browser.newContext(device);
  await context.addCookies([{ name: 'po_active_venue', value: VENUE, url: BASE }]);
  const page = await context.newPage();
  let n = 0;
  page.on('request', (r) => {
    if (r.resourceType() === 'document' || r.headers()['rsc'] === '1' || r.url().includes('_rsc=')) n += 1;
  });
  await page.goto(`${BASE}/auth/dev-login?email=admin%40plusone.test&next=/app`);
  await page.waitForURL(/\/app$/);
  await page.getByRole('button', { name: 'Events', exact: true }).filter({ visible: true }).first().waitFor({ timeout: 60_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  const rows = [];
  for (const [name, url] of TAPS) {
    n = 0;
    const button = name === 'More'
      ? page.getByRole('button', { name: /^(\d+\s*)?More$/ })
      : page.getByRole('button', { name, exact: true });
    const t0 = performance.now();
    await button.filter({ visible: true }).first().click();
    await page.waitForURL(url);
    const ms = performance.now() - t0;
    await page.waitForLoadState('networkidle').catch(() => {});
    rows.push({ name, ms, serverRequests: n });
  }
  await browser.close();
  return rows;
}

async function main() {
  const { error } = await db.from('user_profiles')
    .update({ terms_accepted_at: new Date(0).toISOString(), terms_version: TERMS_VERSION, mfa_snooze_until: 'infinity' })
    .eq('id', ADMIN_ID);
  if (error) throw error;
  for (const [label, device] of [
    ['desktop 1280', { viewport: { width: 1280, height: 900 } }],
    ['phone 390', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ]) {
    const rows = await run(device);
    const total = rows.reduce((s, r) => s + r.serverRequests, 0);
    const avg = rows.reduce((s, r) => s + r.ms, 0) / rows.length;
    console.log(`| ${label} | ${rows.map((r) => `${r.name} ${r.serverRequests}/${Math.round(r.ms)}ms`).join(' · ')} | ${total} | ${Math.round(avg)} ms |`);
  }
}

main().catch((err) => {
  console.error(`[p2-measure-nav] FAILED: ${err.message ?? err}`);
  process.exit(1);
});
