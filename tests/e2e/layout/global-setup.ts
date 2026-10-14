import { chromium, type FullConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptConsent, adminClient } from '../helpers/supabase-admin';
import { AUTH_DIR_ENV, authStatePath } from './auth-state';
import { SEED, USERS, type LayoutUser } from './screens';

/**
 * Clear everything that would bounce a seed user off the screen under test:
 * the first-login consent gate and the admin MFA-enroll nudge. Same two steps
 * `app-shell-no-remount.spec.ts` takes for the doorhost; done ONCE here so the
 * parallel workers never write to the database at all.
 *
 * Plus one event template: the seed has none, and an empty Templates list
 * deliberately jumps straight to "New template" (templates.tsx), so without it
 * the list screen itself could never be measured. Fixed id → idempotent.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const db = adminClient();
  for (const u of Object.values(USERS)) {
    await acceptConsent(u.email);
    const { error } = await db.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', u.id);
    if (error) throw new Error(`layout setup: snoozing the MFA nudge for ${u.email} failed: ${error.message}`);
  }
  const { error } = await db
    .from('event_templates')
    .upsert({ id: SEED.templateId, venue_id: SEED.venueId, name: 'QA-1 layout template', capacity: 400 }, { onConflict: 'id' });
  if (error) throw new Error(`layout setup: seeding the event template failed: ${error.message}`);

  await mintSessions(config);
}

/**
 * ONE signed-in session per seed user, minted here — serially, before any
 * worker starts — and handed to every screen context as Playwright storage
 * state (`auth-state.ts`). Never a dev-login per screen: admin@ carries the
 * fixed dev TOTP factor, so each dev-login ends in an MFA verify, and GoTrue
 * revokes every OTHER session of that user still at AAL1 on each successful
 * verify (`InvalidateSessionsWithAALLessThan(user, aal2)` in its TOTP verify).
 * Parallel workers logging admin@ in at once therefore killed each other's
 * fresh session between `verifyOtp` and the MFA step; the victim's redirect
 * then bounced to /login (layout-suite on PR #507). A shared AAL2 session is
 * never touched by that sweep, and nothing in this suite signs out or
 * refreshes it: the run stays far inside the 1 h access-token lifetime
 * (supabase/config.toml `jwt_expiry`), so the middleware never rotates it.
 */
async function mintSessions(config: FullConfig): Promise<void> {
  const { baseURL, launchOptions } = config.projects[0]?.use ?? {};
  if (!baseURL) throw new Error('layout setup: no baseURL to log the seed users in against');
  const dir = mkdtempSync(join(tmpdir(), 'plusone-layout-auth-'));
  // Workers inherit the environment global setup leaves behind.
  process.env[AUTH_DIR_ENV] = dir;
  const browser = await chromium.launch(launchOptions);
  try {
    for (const user of Object.keys(USERS) as LayoutUser[]) {
      const context = await browser.newContext({ baseURL });
      try {
        const page = await context.newPage();
        const { email } = USERS[user];
        await page.goto(`/auth/dev-login?email=${encodeURIComponent(email)}&next=%2Fapp`, {
          waitUntil: 'domcontentloaded',
          // The first request of a run pays the dev server's cold compile.
          timeout: 180_000,
        });
        // Consent is accepted above and both seed users have a venue, so a
        // working login lands on /app itself — anything else is a real failure.
        await page.waitForURL((u) => u.pathname === '/app' || u.pathname === '/login', { timeout: 120_000 });
        const landed = new URL(page.url());
        if (landed.pathname !== '/app') throw new Error(`layout setup: dev-login as ${email} landed on ${landed.pathname}`);
        await context.storageState({ path: authStatePath(user) });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}
