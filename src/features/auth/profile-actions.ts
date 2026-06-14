'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/context';
import { profileSchema, emailChangeSchema } from './schemas';
import { describeAuthError } from './errors';

export interface ActionState {
  ok: boolean;
  error?: string;
  message?: string;
}

/**
 * Update your own profile: first/last name + phone (RLS: user_profiles_update_self,
 * decision #24 — only the user edits their own profile). full_name is kept in
 * sync as a display mirror so existing reads (nav, member lists) stay correct.
 */
export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Je bent niet ingelogd.' };

  const parsed = profileSchema.safeParse({
    firstName: formData.get('firstName'),
    lastName: formData.get('lastName'),
    phone: formData.get('phone'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Controleer de invoer.' };
  }
  const { firstName, lastName, phone } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from('user_profiles')
    .update({
      first_name: firstName,
      last_name: lastName,
      phone,
      full_name: `${firstName} ${lastName}`.trim(),
    })
    .eq('id', user.id);
  if (error) return { ok: false, error: 'Kon je profiel niet opslaan.' };

  revalidatePath('/settings/profile');
  revalidatePath('/', 'layout'); // nav shows the name
  return { ok: true, message: 'Profiel opgeslagen.' };
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
