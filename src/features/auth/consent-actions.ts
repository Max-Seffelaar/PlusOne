'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/context';
import { TERMS_VERSION } from '@/lib/legal';
import { profileSchema } from './schemas';

export interface ActionState {
  ok: boolean;
  error?: string;
}

export interface AccountDetails {
  firstName: string;
  lastName: string;
  phone: string;
}

/**
 * Record the signed-in user's acceptance of the current Terms + Privacy version
 * (#20/#40 — first-login consent gate). When the screen ran as the account-setup
 * step (T1 #3, first-time user without a name) it passes the account details and
 * they are saved in the SAME write — name required, phone optional — so the
 * whole "create your account" step is one screen, one submit.
 *
 * Security: session verified server-side; details parsed through profileSchema;
 * the write is scoped to the caller's own row by RLS user_profiles_update_self
 * (decision #24) on the user-scoped client — never the service role.
 *
 * We also call accept_pending_invites() first (idempotent). This provisions the
 * user_profiles row + any venue memberships if the auth-callback route was
 * bypassed or failed silently. Without it a brand-new invited user has no profile
 * row yet, so the UPDATE below affects 0 rows and returns an error (#40-fix).
 */
export async function acceptTermsAction(details?: AccountDetails): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };

  let profilePatch: {
    first_name: string;
    last_name: string;
    phone: string | null;
    full_name: string;
  } | null = null;
  if (details) {
    const parsed = profileSchema.safeParse(details);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details.' };
    }
    const { firstName, lastName, phone } = parsed.data;
    profilePatch = {
      first_name: firstName,
      last_name: lastName,
      phone,
      full_name: `${firstName} ${lastName}`.trim(),
    };
  }

  const supabase = await createClient();
  const now = new Date().toISOString();

  // Ensure the profile row + memberships exist before we try to update them.
  const { error: inviteError } = await supabase.rpc('accept_pending_invites');
  if (inviteError) console.error('acceptTerms: accept_pending_invites failed', inviteError.message);

  const { error, count } = await supabase
    .from('user_profiles')
    .update(
      { terms_accepted_at: now, terms_version: TERMS_VERSION, ...(profilePatch ?? {}) },
      { count: 'exact' }
    )
    .eq('id', user.id);

  if (error) {
    console.error('acceptTerms: update failed', error.message);
    return { ok: false, error: "Couldn't save your consent. Please try again." };
  }

  if (!count) {
    // Profile still doesn't exist after accept_pending_invites() (edge case:
    // user arrived via an invite flow that never created their profile row).
    // Create it now so consent is recorded; accept_pending_invites() fills in
    // the real name/email on first post-consent login via the auth callback.
    const fallbackName =
      (user.user_metadata?.full_name as string | undefined) ||
      user.email?.split('@')[0] ||
      'User';
    const { error: insertError } = await supabase.from('user_profiles').insert({
      id: user.id,
      email: user.email?.toLowerCase() ?? '',
      full_name: profilePatch?.full_name ?? fallbackName,
      ...(profilePatch ?? {}),
      terms_accepted_at: now,
      terms_version: TERMS_VERSION,
    });
    if (insertError) {
      console.error('acceptTerms: profile insert failed', insertError.message);
      return { ok: false, error: "Couldn't save your consent. Please try again." };
    }
  }

  // The gate is re-evaluated server-side on the next navigation.
  revalidatePath('/', 'layout');
  return { ok: true };
}
