import 'server-only';

import { getServerSupabaseClient } from './supabase/server-client';

export async function getCurrentUser() {
  const supabase = await getServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return null;
  }

  return user;
}

export async function getAAL2Session() {
  const supabase = await getServerSupabaseClient();
  const { data, error } = await supabase.auth.getSession();

  if (error || !data.session) {
    return { session: null, hasAAL2: false, error: 'no_session' };
  }

  const jwt = data.session.user.user_metadata;
  const hasAAL2 = jwt?.aal === 'aal2' || false;

  return { session: data.session, hasAAL2, error: null };
}

export async function enforceAAL2() {
  const { session, hasAAL2, error } = await getAAL2Session();

  if (error || !session || !hasAAL2) {
    const err = new Error('MFA verification required');
    (err as any).code = 'AAL2_REQUIRED';
    throw err;
  }

  return session;
}

export async function checkVenueMembership(venueId: string, requiredRoles?: string[]) {
  const user = await getCurrentUser();
  if (!user) {
    return { allowed: false, membership: null, error: 'unauthorized' };
  }

  const supabase = await getServerSupabaseClient();
  const { data: membership, error } = await supabase
    .from('venue_memberships')
    .select('*')
    .eq('venue_id', venueId)
    .eq('user_id', user.id)
    .single();

  if (error || !membership) {
    return { allowed: false, membership: null, error: 'no_membership' };
  }

  if (requiredRoles && requiredRoles.length > 0) {
    const hasRequiredRole = requiredRoles.some(role => membership.roles.includes(role as never));
    if (!hasRequiredRole) {
      return { allowed: false, membership, error: 'insufficient_role' };
    }
  }

  return { allowed: true, membership, error: null };
}

export async function checkAAL2(user: any) {
  const aal = user?.user_metadata?.aal || user?.app_metadata?.aal;
  return aal === 'aal2';
}

export async function getUserProfile(userId: string) {
  const supabase = await getServerSupabaseClient();
  const { data: profile, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !profile) {
    return null;
  }

  return profile;
}
