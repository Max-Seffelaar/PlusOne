import 'server-only';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { TERMS_VERSION } from '@/lib/legal';

// First-login consent gate (#20/#40): every user must accept the Terms + Privacy
// Policy before using the app. State lives on their own user_profiles row (created
// on first login by accept_pending_invites), read under RLS user_profiles_select.

interface ConsentRow {
  terms_accepted_at: string | null;
  terms_version: string | null;
}

/** True when a profile row reflects acceptance of the CURRENT terms version. */
export function acceptedCurrentTerms(row: ConsentRow | null | undefined): boolean {
  return Boolean(row?.terms_accepted_at) && row?.terms_version === TERMS_VERSION;
}

/** Read the signed-in user's consent state (RLS: own profile). */
export async function hasAcceptedCurrentTerms(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('user_profiles')
    .select('terms_accepted_at, terms_version')
    .eq('id', userId)
    .maybeSingle();
  return acceptedCurrentTerms(data);
}

/**
 * Page guard: bounce to the consent screen unless the user has accepted the
 * current Terms + Privacy version. `nextPath` is where to return after accepting.
 */
export async function requireConsent(userId: string, nextPath: string): Promise<void> {
  if (!(await hasAcceptedCurrentTerms(userId))) {
    redirect(`/consent?next=${encodeURIComponent(nextPath)}`);
  }
}
