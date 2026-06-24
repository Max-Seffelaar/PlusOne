'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/context';
import { TERMS_VERSION } from '@/lib/legal';

export interface ActionState {
  ok: boolean;
  error?: string;
}

/**
 * Record the signed-in user's acceptance of the current Terms + Privacy version
 * (#20/#40 — first-login consent gate). Security: session verified server-side;
 * the write is scoped to the caller's own row by RLS user_profiles_update_self
 * (decision #24) on the user-scoped client — never the service role. The profile
 * row already exists (accept_pending_invites creates it on first login).
 */
export async function acceptTermsAction(): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from('user_profiles')
    .update(
      { terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION },
      { count: 'exact' }
    )
    .eq('id', user.id);

  if (error || !count) {
    if (error) console.error('acceptTerms: update failed', error.message);
    return { ok: false, error: "Couldn't save your consent. Please try again." };
  }

  // The gate is re-evaluated server-side on the next navigation.
  revalidatePath('/', 'layout');
  return { ok: true };
}
