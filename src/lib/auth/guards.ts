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

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * MFA is fully OPTIONAL (decision #20 refinement, 2026-07-02 — T1 PR c). For
 * roles where we still RECOMMEND it (admin/finance, `requiresMfa`) and no factor
 * is enrolled, redirect once to the skippable recommendation screen — unless the
 * user snoozed it ("Ask me in 7 days" → timestamp, "Don't ask again" → far
 * future) via user_profiles.mfa_snooze_until. Never a hard gate.
 *
 * Ask-first (UX/IA 9/7, decided 2026-07-09): never nudge until 24h after the
 * user's FIRST REAL SESSION — anchored on `terms_accepted_at`, not
 * `user.created_at`. The auth row is created the moment an invite is *sent*
 * (`inviteUserByEmail`), so created_at could be days before anyone opens the
 * app; terms_accepted_at is stamped at their actual first login. No
 * terms_accepted_at yet reads as "too early" — fail open (the real /app path
 * gates consent before this runs anyway, so that's not expected in practice).
 * Self-service enroll (Profile) is unaffected.
 */
export async function recommendMfaIfDue(currentPath: string, ctx?: AuthContext | null): Promise<void> {
  const resolved = ctx ?? (await getAuthContext());
  if (!resolved) return;
  if (!resolved.requiresMfa || resolved.hasVerifiedTotp) return;

  const supabase = await createClient();
  const { data } = await supabase
    .from('user_profiles')
    .select('mfa_snooze_until, terms_accepted_at')
    .eq('id', resolved.user.id)
    .maybeSingle();

  const acceptedAt = data?.terms_accepted_at ? new Date(data.terms_accepted_at).getTime() : NaN;
  const sinceAcceptedMs = Date.now() - acceptedAt;
  if (Number.isNaN(sinceAcceptedMs) || sinceAcceptedMs < ONE_DAY_MS) return;

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
 *
 * NOT currently called by any route (code-review finding, UX/IA 9/7 PR): the
 * live `/app` surface duplicates this consent-then-MFA order inline in
 * `src/app/app/layout.tsx` (see the comment there) rather than calling this
 * function, so this ordering fix has no live effect today. Kept as the
 * canonical guard for a future route that needs the full app-access check in
 * one call — if you wire a route to it, this is the order to preserve.
 */
export async function requireAppAccess(currentPath?: string): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect(loginRedirect(currentPath));

  // First-login consent gate (#20/#40): accept Terms + Privacy before the app.
  // Runs BEFORE the MFA recommendation (UX/IA 9/7) — a fresh invitee sees the
  // terms first, a security nudge is not the first thing they meet.
  await requireConsent(ctx.user.id, currentPath ?? '/app');
  await recommendMfaIfDue(currentPath ?? '/app', ctx);
  return ctx;
}

// assertAal2/AuthorizationError were removed with the optional-MFA refinement
// (#20, 2026-07-02): no action requires AAL2 anymore — venue roles are the
// boundary (RLS). The MFA plumbing that remains (enroll/verify/step-up sheet)
// is voluntary account protection, not an access gate.
