import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Middleware protects EVERY route by default; public exceptions are listed
// explicitly here (bouwplan Fase 4 §6). Anything not public requires a verified
// session, and protected routes additionally enforce the MFA policy here — so
// it covers every surface (dashboard, app, events), not only the (app) shell.
const PUBLIC_PATHS = new Set<string>(['/', '/login']);
// Auth callback/confirm routes and the public per-event landing pages (#12).
const PUBLIC_PREFIXES = ['/auth/', '/e/'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Carry the refreshed auth cookies onto a redirect so token rotation is not
// lost when we bounce the request.
function redirectWithCookies(url: URL, source: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  source.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  return redirect;
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const onMfaRoute = pathname.startsWith('/mfa/');
  // Onboarding is reachable before MFA: a fresh owner becomes admin the moment
  // they create their venue (#40a), which would otherwise trip the mandatory-MFA
  // gate mid-flow. MFA enrollment happens naturally on the first /app hit
  // once onboarding is complete (the Team step's invites stay AAL2-gated).
  const onOnboarding = pathname === '/onboarding';
  const publicRoute = isPublic(pathname);

  const { response, user, gate } = await updateSession(request, {
    checkMfa: !publicRoute && !onMfaRoute && !onOnboarding,
  });

  // A signed-in user has no business on the login screen → the one app surface.
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/app';
    url.search = '';
    return redirectWithCookies(url, response);
  }

  // Unauthenticated access to a protected route → login, remembering the target.
  if (!user && !publicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname);
    return redirectWithCookies(url, response);
  }

  // MFA ENROLLMENT gate on protected routes (not /mfa/* or /onboarding, to avoid
  // bouncing a new owner mid-flow). Enrollment stays mandatory for admin/finance
  // (CLAUDE.md §Auth, #20). AAL2 itself is required only for specific sensitive
  // actions (invite / revoke-invite / member add-remove-rolechange / remote-logout),
  // which step the session up IN PLACE via the app's MFA sheet — so we no longer
  // bounce an AAL1 session to /mfa/verify just to browse (that caused the
  // "re-MFA on every visit" friction). Anyone without a factor that needs one is
  // still sent to enroll.
  if (user && !publicRoute && !onMfaRoute && !onOnboarding && gate.requiresMfa && !gate.hasFactor) {
    const url = request.nextUrl.clone();
    url.pathname = '/mfa/enroll';
    url.search = '';
    url.searchParams.set('next', pathname);
    return redirectWithCookies(url, response);
  }

  return response;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|service-worker.js|workbox-|icons/|apple-touch-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|woff2?)$).*)',
  ],
};
