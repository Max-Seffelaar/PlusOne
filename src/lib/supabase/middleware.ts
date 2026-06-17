import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { User } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { AUTH_COOKIE_MAX_AGE } from './cookie-options';

export interface MfaGate {
  isAal2: boolean;
  /** Has a verified factor available to step up to AAL2. */
  hasFactor: boolean;
  /** Holds a role (admin/finance) that mandates MFA. */
  requiresMfa: boolean;
}

// No-gate default: a route that should not redirect for MFA.
const OPEN_GATE: MfaGate = { isAal2: true, hasFactor: false, requiresMfa: false };

// Canonical @supabase/ssr middleware helper: refreshes the auth cookies on
// every request and returns the verified user. getUser() (not getSession) hits
// the Auth server, so the session is always validated server-side — never
// trust an unverified cookie (CLAUDE.md security checklist).
//
// When `checkMfa` is set and there is a user, it also computes the MFA gate
// using the SAME authenticated client (the one getUser succeeds on), so the
// role lookup runs as the signed-in user. Only done for protected routes, and
// the role lookup is skipped once the session is already AAL2.
export async function updateSession(
  request: NextRequest,
  { checkMfa = false }: { checkMfa?: boolean } = {}
): Promise<{ response: NextResponse; user: User | null; gate: MfaGate }> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Persist the session across browser restarts (ClickUp "30 dagen onthouden").
      cookieOptions: { maxAge: AUTH_COOKIE_MAX_AGE },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let gate: MfaGate = OPEN_GATE;
  if (user && checkMfa) {
    try {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const isAal2 = aal?.currentLevel === 'aal2';
      const hasFactor = aal?.nextLevel === 'aal2';
      let requiresMfa = false;
      if (!isAal2) {
        const { data, error } = await supabase.rpc('current_user_requires_mfa');
        if (error) console.error('[mfa-gate] rpc error:', error.message);
        requiresMfa = data ?? false;
      }
      gate = { isAal2, hasFactor, requiresMfa };
    } catch (e) {
      // Fail closed at the shell (the (app) layout still enforces); for routes
      // outside the shell we keep the user out of an error loop by not gating.
      console.error('[mfa-gate] compute failed:', e);
      gate = OPEN_GATE;
    }
  }

  return { response, user, gate };
}
