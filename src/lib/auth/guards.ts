import 'server-only';

import { redirect } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getAuthContext, getSessionUser, type AuthContext } from './context';
import { requireConsent } from './consent';

function loginRedirect(nextPath?: string): string {
  return nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login';
}

/** Page guard: require a verified session, else bounce to login. */
export async function requireUser(currentPath?: string): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect(loginRedirect(currentPath));
  return user;
}

/**
 * MFA is fully OPTIONAL (decision #20 refinement, 2026-07-02 — T1 PR c). For
 * roles where we still RECOMMEND it (admin/finance, `requiresMfa`) and no factor
 * is enrolled, redirect once to the skippable recommendation screen — unless the
 * user snoozed it ("Ask me in 7 days" → timestamp, "Don't ask again" → far
 * future) via user_profiles.mfa_snooze_until. Never a hard gate.
 */
export async function recommendMfaIfDue(currentPath: string, ctx?: AuthContext | null): Promise<void> {
  const resolved = ctx ?? (await getAuthContext());
  if (!resolved) return;
  if (!resolved.requiresMfa || resolved.hasVerifiedTotp) return;

  const supabase = await createClient();
  const { data } = await supabase
    .from('user_profiles')
    .select('mfa_snooze_until')
    .eq('id', resolved.user.id)
    .maybeSingle();
  const raw = data?.mfa_snooze_until;
  if (raw) {
    // 'infinity' (or any unparseable value) reads as snoozed-forever — fail open
    // so a weird stored value can never wedge the user in a recommendation loop.
    if (raw === 'infinity') return;
    const until = new Date(raw).getTime();
    if (Number.isNaN(until) || until > Date.now()) return;
  }
  redirect(`/mfa/enroll?next=${encodeURIComponent(currentPath)}`);
}

/**
 * Page guard for the authenticated app shell. MFA is optional (#20 refinement):
 * instead of forcing enrollment it surfaces the skippable recommendation via
 * recommendMfaIfDue. Returns the full context to render.
 */
export async function requireAppAccess(currentPath?: string): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect(loginRedirect(currentPath));

  await recommendMfaIfDue(currentPath ?? '/app', ctx);
  // First-login consent gate (#20/#40): accept Terms + Privacy before the app.
  await requireConsent(ctx.user.id, currentPath ?? '/app');
  return ctx;
}

// assertAal2/AuthorizationError were removed with the optional-MFA refinement
// (#20, 2026-07-02): no action requires AAL2 anymore — venue roles are the
// boundary (RLS). The MFA plumbing that remains (enroll/verify/step-up sheet)
// is voluntary account protection, not an access gate.
