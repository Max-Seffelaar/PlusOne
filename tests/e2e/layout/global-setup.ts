import { acceptConsent, adminClient } from '../helpers/supabase-admin';
import { SEED, USERS } from './screens';

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
export default async function globalSetup(): Promise<void> {
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
}
