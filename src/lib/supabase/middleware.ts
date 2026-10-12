import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '../database.types';
import { AUTH_COOKIE_MAX_AGE } from './cookie-options';
import { requiredServerEnv } from '../env';
import { demoSessionMustEnd } from '@/features/auth/review-window';

export interface MfaGate {
  isAal2: boolean;
  /** Has a verified factor available to step up to AAL2. */
  hasFactor: boolean;
  /** Holds a role (admin/finance) that mandates MFA. */
  requiresMfa: boolean;
}

// No-gate default: a route that should not redirect for MFA.
const OPEN_GATE: MfaGate = { isAal2: true, hasFactor: false, requiresMfa: false };

/**
 * Who the middleware routes on: the subject and e-mail of a verified token.
 * Deliberately not a full `User` — the middleware only decides "signed in or
 * not" (and the demo-account check). Every route, layout and server action that
 * reads data or authorizes still calls getUser() itself (CLAUDE.md security
 * checklist); RLS is the boundary.
 */
export interface MiddlewareUser {
  id: string;
  email?: string;
}

type AuthClient = Pick<ReturnType<typeof createServerClient<Database>>['auth'], 'getSession' | 'getClaims' | 'getUser'>;

/** True when the access token is signed with an asymmetric key that getClaims() can verify locally. */
function isAsymmetricToken(accessToken: string): boolean {
  try {
    const part = accessToken.split('.')[0] ?? '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    const header = JSON.parse(json) as { alg?: unknown; kid?: unknown };
    return typeof header.alg === 'string' && !header.alg.startsWith('HS') && typeof header.kid === 'string' && header.kid !== '';
  } catch {
    return false;
  }
}

async function userFromGoTrue(auth: AuthClient): Promise<MiddlewareUser | null> {
  const {
    data: { user },
  } = await auth.getUser();
  return user ? { id: user.id, email: user.email } : null;
}

/**
 * Resolve the signed-in user for routing (perf audit finding 9). Fast path:
 * getClaims() verifies the access token's signature and `exp` locally against
 * the project's JWKS (cached per instance for 10 minutes), so a request costs
 * no GoTrue round-trip. Any other case is the previous behaviour, unchanged: a
 * strict route, a symmetric (HS256) token as on the local stack, no session, a
 * JWKS fetch error, a bad signature or an expired token all go to getUser().
 * getSession() first runs the same cookie refresh getUser() used to trigger,
 * so token rotation is untouched. What the fast path does NOT see until the
 * token expires (≤ the JWT expiry): a revoked session (sign-out elsewhere,
 * remote logout), a revoked refresh token, a deleted or banned user. The same
 * token is already accepted by PostgREST and Realtime until `exp`, so a
 * middleware getUser() never closed that window; layouts, pages with server
 * data and every server action keep their own getUser().
 */
export async function resolveMiddlewareUser(auth: AuthClient, { strict = false }: { strict?: boolean } = {}): Promise<MiddlewareUser | null> {
  if (strict) return userFromGoTrue(auth);
  const {
    data: { session },
  } = await auth.getSession();
  if (!session?.access_token || !isAsymmetricToken(session.access_token)) return userFromGoTrue(auth);
  try {
    const { data, error } = await auth.getClaims();
    const sub = data?.claims?.sub;
    if (!error && data && typeof sub === 'string' && sub !== '') {
      const email = data.claims.email;
      return { id: sub, email: typeof email === 'string' ? email : undefined };
    }
  } catch {
    // Fall through to GoTrue: never fail open, never fail closed on a JWKS outage.
  }
  return userFromGoTrue(auth);
}

// Canonical @supabase/ssr middleware helper: refreshes the auth cookies on
// every request and returns the verified user via resolveMiddlewareUser above
// (local JWT verification, getUser() fallback). Never trust an unverified
// cookie: getSession() alone is never the answer (CLAUDE.md security checklist).
// `strict` forces getUser() for routes where the middleware ACTS on "signed in"
// (redirecting away from /login and /): a revoked-but-unexpired token there
// would bounce between /login and the /app layout's own getUser().
//
// When `checkMfa` is set and there is a user, it also computes the MFA gate
// using the SAME authenticated client (the one getUser succeeds on), so the
// role lookup runs as the signed-in user. Only done for protected routes, and
// the role lookup is skipped once the session is already AAL2.
export async function updateSession(
  request: NextRequest,
  { checkMfa = false, strict = false }: { checkMfa?: boolean; strict?: boolean } = {}
): Promise<{ response: NextResponse; user: MiddlewareUser | null; gate: MfaGate; demoSessionEnded?: true }> {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    requiredServerEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredServerEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
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

  const user = await resolveMiddlewareUser(supabase.auth, { strict });

  // Store-review demo account (86ey6bfug) outside its review window: end the
  // session on EVERY route the middleware covers (/door/*, server actions, …),
  // not only on /app, whose layout has the same gate. Same pure predicate
  // (demo id OR e-mail, window closed), on the user resolved just above: no
  // extra query, and for any other user it is one string compare.
  if (user && demoSessionMustEnd(user)) {
    return { ...(await endDemoSession(supabase, request, () => response)), user: null, gate: OPEN_GATE, demoSessionEnded: true };
  }

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

const NO_STORE = 'no-store, private, max-age=0';

/**
 * Global sign-out of the demo account, then /login. signOut() clears the auth
 * cookies through setAll above, so they are copied from the (reassigned)
 * pass-through response onto the redirect. If the sign-out fails, a 503
 * instead of a redirect: with the cookies still set, /login would bounce a
 * signed-in user back to /app and loop.
 */
async function endDemoSession(
  supabase: { auth: { signOut: (o: { scope: 'global' }) => Promise<{ error: unknown }> } },
  request: NextRequest,
  current: () => NextResponse
): Promise<{ response: NextResponse }> {
  let failed: boolean;
  try {
    failed = Boolean((await supabase.auth.signOut({ scope: 'global' })).error);
  } catch {
    failed = true;
  }
  const out = failed
    ? new NextResponse('Service unavailable', { status: 503 })
    : NextResponse.redirect(new URL('/login', request.url), 303);
  current().cookies.getAll().forEach((cookie) => out.cookies.set(cookie));
  out.headers.set('Cache-Control', NO_STORE);
  // Same shape as the review-login log lines (no e-mail, no IP; the client
  // hash needs node:crypto, which the edge runtime does not have).
  console.warn(
    JSON.stringify({ event: 'review_login', outcome: 'session_ended', reason: failed ? 'middleware_signout_failed' : 'middleware_window_closed' })
  );
  return { response: out };
}
