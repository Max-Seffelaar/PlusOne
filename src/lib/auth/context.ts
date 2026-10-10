import 'server-only';

import { cache } from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export type Aal = 'aal1' | 'aal2' | null;

export interface AuthContext {
  user: User;
  /** AAL of the current session. */
  currentLevel: Aal;
  /** Highest AAL the user could reach (aal2 once they have a verified factor). */
  nextLevel: Aal;
  isAal2: boolean;
  /** True when the user holds a role that mandates MFA (admin/finance). */
  requiresMfa: boolean;
  /** True when the user has at least one verified TOTP factor. */
  hasVerifiedTotp: boolean;
}

// Always verify server-side with getUser() (CLAUDE.md: never trust getSession
// alone on the server).
//
// Wrapped in React `cache()` (Snelheid P1, perf audit 2026-10 finding 2): one
// GoTrue round-trip per server request instead of one per helper. Before this,
// a single `/app` document load called getUser 8-9 times in series (layout →
// onboarding → memberships ×3 → organizer venues → MFA context → listFactors,
// plus the root not-found boundary). `cache()` is scoped to ONE request: it is
// never shared across requests or users, and outside a React server render
// (route handlers) it simply calls through. Within a request every caller sees
// the same verified answer — the first getUser of the request decides.
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
});

/** The caller's own profile fields the `/app` gates and shell read. */
export interface MyProfile {
  full_name: string | null;
  terms_accepted_at: string | null;
  terms_version: string | null;
  mfa_snooze_until: string | null;
}

/**
 * The signed-in user's own `user_profiles` row (via `my_profile()`), read ONCE
 * per request for the `/app` layout: the shell name, the consent gate and the
 * MFA recommendation all used to read it separately (perf audit finding 2).
 * Null when signed out or the row is missing — callers treat that exactly like
 * the old `maybeSingle()` null.
 */
export const getMyProfile = cache(async (): Promise<MyProfile | null> => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  // An RPC, not a table read: terms_version and mfa_snooze_until are outside
  // `authenticated`'s column grant on user_profiles (20261014120100).
  const { data } = await supabase
    .rpc('my_profile')
    .select('full_name, terms_accepted_at, terms_version, mfa_snooze_until')
    .eq('id', user.id)
    .maybeSingle();
  return data ?? null;
});

// Full auth context for layout/guards: identity + AAL + MFA state in one pass.
// Cached per request like getSessionUser. Reuses the cached user instead of a
// second getUser, and reads the factors off `user.factors` — exactly what
// `auth.mfa.listFactors()` returns, minus the extra getUser it makes to get
// them. `getAuthenticatorAssuranceLevel()` reads the local session (no network).
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;

  const supabase = await createClient();
  const [{ data: aal }, { data: requiresMfa }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.rpc('current_user_requires_mfa'),
  ]);

  const hasVerifiedTotp = (user.factors ?? []).some(
    (f) => f.factor_type === 'totp' && f.status === 'verified'
  );
  const currentLevel = (aal?.currentLevel ?? null) as Aal;

  return {
    user,
    currentLevel,
    nextLevel: (aal?.nextLevel ?? null) as Aal,
    isAal2: currentLevel === 'aal2',
    requiresMfa: requiresMfa ?? false,
    hasVerifiedTotp,
  };
});
