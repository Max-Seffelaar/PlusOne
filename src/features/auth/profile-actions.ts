'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/context';
import { profileNameSchema, emailChangeSchema } from './schemas';
import { describeAuthError } from './errors';

export interface ActionState {
  ok: boolean;
  error?: string;
  message?: string;
}

/** Update your own display name (RLS: user_profiles_update_self). */
export async function updateNameAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Je bent niet ingelogd.' };

  const parsed = profileNameSchema.safeParse({ fullName: formData.get('fullName') });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Ongeldige naam.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('user_profiles')
    .update({ full_name: parsed.data.fullName })
    .eq('id', user.id);
  if (error) return { ok: false, error: 'Kon je naam niet opslaan.' };

  revalidatePath('/settings/profile');
  return { ok: true, message: 'Naam opgeslagen.' };
}

/**
 * Change your own e-mail (decision #24: only the user does this). Supabase
 * sends a confirmation to both the old and the new address (double opt-in when
 * "Secure email change" is on). The profile mirror is updated by the
 * sync_profile_email trigger once the change is confirmed.
 */
export async function updateEmailAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Je bent niet ingelogd.' };

  const parsed = emailChangeSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Ongeldig e-mailadres.' };
  }
  if (parsed.data.email === user.email) {
    return { ok: false, error: 'Dit is al je huidige e-mailadres.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email: parsed.data.email });
  if (error) return { ok: false, error: describeAuthError(error).message };

  return {
    ok: true,
    message: 'Bevestig de wijziging via de link die we naar je oude én nieuwe e-mailadres sturen.',
  };
}
