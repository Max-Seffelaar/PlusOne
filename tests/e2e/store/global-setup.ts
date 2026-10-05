import { rmSync } from 'node:fs';
import { acceptConsent, adminClient } from '../helpers/supabase-admin';
import { STORE_DIR } from './capture';
import { STORE_DEMO } from './sets';

/**
 * Before any shot: the demo data must exist (`scripts/store-screenshot-seed.mjs`,
 * which `pnpm store:screenshots` runs first), and nothing may bounce the demo
 * user off the screen — the first-login consent gate and the admin MFA-enroll
 * nudge, cleared with the same shared helper + snooze the layout suite uses.
 * The output folder starts empty so an artifact never mixes two runs.
 */
export default async function globalSetup(): Promise<void> {
  const db = adminClient();
  const { data: event, error } = await db.from('events').select('id').eq('id', STORE_DEMO.liveEventId).maybeSingle();
  if (error || !event) {
    throw new Error('store setup: the demo night is missing — run `node scripts/store-screenshot-seed.mjs` (or `pnpm store:screenshots`).');
  }
  await acceptConsent(STORE_DEMO.email);
  const { error: snoozeError } = await db
    .from('user_profiles')
    .update({ mfa_snooze_until: 'infinity' })
    .eq('id', STORE_DEMO.userId);
  if (snoozeError) throw new Error(`store setup: snoozing the MFA nudge failed: ${snoozeError.message}`);
  rmSync(STORE_DIR, { recursive: true, force: true });
}
