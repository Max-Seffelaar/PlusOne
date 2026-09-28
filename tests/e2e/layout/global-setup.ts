import { acceptConsent, adminClient } from '../helpers/supabase-admin';
import { USERS } from './screens';

/**
 * Clear everything that would bounce a seed user off the screen under test:
 * the first-login consent gate and the admin MFA-enroll nudge. Same two steps
 * `app-shell-no-remount.spec.ts` takes for the doorhost; done ONCE here so the
 * parallel workers never write to the database at all.
 */
export default async function globalSetup(): Promise<void> {
  const db = adminClient();
  for (const u of Object.values(USERS)) {
    await acceptConsent(u.email);
    const { error } = await db.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', u.id);
    if (error) throw new Error(`layout setup: snoozing the MFA nudge for ${u.email} failed: ${error.message}`);
  }
}
