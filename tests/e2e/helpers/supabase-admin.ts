import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role client for e2e test setup/teardown ONLY (never shipped to the
// browser). Used to provision invites and reset MFA state deterministically.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// Seed admin (Max) — invites are attributed to this profile in setup.
const SEED_ADMIN_PROFILE = '11111111-1111-4111-8111-111111111111';

export function adminClient(): SupabaseClient {
  return createClient(URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getUserIdByEmail(email: string): Promise<string | null> {
  const a = adminClient();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await a.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data) return null;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Remove every MFA factor for a user so MFA tests start from a known state. */
export async function clearMfaFactors(email: string): Promise<void> {
  const a = adminClient();
  const userId = await getUserIdByEmail(email);
  if (!userId) return;
  const { data } = await a.auth.admin.mfa.listFactors({ userId });
  for (const factor of data?.factors ?? []) {
    await a.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
  }
}

/** Provision a pending invite (and the auth identity) for the invite-accept e2e. */
export async function ensureInvite(
  email: string,
  venueId: string,
  roles: string[]
): Promise<void> {
  const a = adminClient();
  await a.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: email.split('@')[0] },
  });
  // Reset to a single pending invite for idempotent re-runs.
  await a.from('invites').delete().ilike('email', email).is('accepted_at', null);
  await a.from('invites').insert({
    venue_id: venueId,
    email,
    roles,
    invited_by: SEED_ADMIN_PROFILE,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
}

/**
 * Reset an invitee so the test can re-run: drop the membership + pending
 * invites. The auth user, profile and audit history are intentionally LEFT
 * (audit_log is append-only and references the actor — decision #4).
 */
export async function resetInvitee(email: string, venueId: string): Promise<void> {
  const a = adminClient();
  const userId = await getUserIdByEmail(email);
  if (userId) {
    await a.from('venue_memberships').delete().eq('user_id', userId).eq('venue_id', venueId);
  }
  await a.from('invites').delete().ilike('email', email).is('accepted_at', null);
}
