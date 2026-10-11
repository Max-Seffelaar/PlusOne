'use server';

// Save the caller's own team notification preferences (6b). The RPC writes
// auth.uid()'s row only (there is no user argument); the table grants no app
// role anything, so this is the one write path besides the token unsubscribe.

import { createClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth/context';
import { invalidInput, mapMutationError, unauthorized, type MutationError } from '@/lib/db-errors';
import { notificationPrefsSchema, toNotificationPrefs, type NotificationPrefs } from './prefs-schema';

export type SavePrefsResult = { ok: true; prefs: NotificationPrefs } | MutationError;

export async function saveNotificationPrefsAction(input: unknown): Promise<SavePrefsResult> {
  const parsed = notificationPrefsSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('set_my_notification_prefs', { p_prefs: parsed.data });
  if (error) return mapMutationError(error);
  return { ok: true, prefs: toNotificationPrefs(data) };
}
