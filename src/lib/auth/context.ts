import 'server-only';

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
export async function getSessionUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

// Full auth context for layout/guards: identity + AAL + MFA state in one pass.
export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: aal }, { data: factors }, { data: requiresMfa }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
    supabase.rpc('current_user_requires_mfa'),
  ]);

  const hasVerifiedTotp = (factors?.all ?? []).some(
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
}
