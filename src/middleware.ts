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
  const publicRoute = isPublic(pathname);

  const { response, user, gate } = await updateSession(request, {
    checkMfa: !publicRoute && !onMfaRoute,
  });

  // A signed-in user has no business on the login screen.
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
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

  // MFA gate on protected routes (not /mfa/* itself, to avoid a loop). Mandatory
  // for admin/finance (CLAUDE.md §Auth); anyone with a factor must step up.
  if (user && !publicRoute && !onMfaRoute && !gate.isAal2 && (gate.requiresMfa || gate.hasFactor)) {
    const url = request.nextUrl.clone();
    url.pathname = gate.requiresMfa && !gate.hasFactor ? '/mfa/enroll' : '/mfa/verify';
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
