import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Middleware protects EVERY route by default; public exceptions are listed
// explicitly here (bouwplan Fase 4 §6). Anything not public requires a
// verified session — role/MFA gating happens in the authenticated layout.
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
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // A signed-in user has no business on the login screen.
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return redirectWithCookies(url, response);
  }

  // Unauthenticated access to a protected route → login, remembering the target.
  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
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
