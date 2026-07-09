import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Middleware protects EVERY route by default; public exceptions are listed
// explicitly here (bouwplan Fase 4 §6). Anything not public requires a verified
// session, and protected routes additionally enforce the MFA policy here — so
// it covers every surface (dashboard, app, events), not only the (app) shell.
const PUBLIC_PATHS = new Set<string>(['/', '/login']);
// Auth callback/confirm routes, the public per-event landing pages (#12), the
// bearer-token status (/r, #28) + influencer stats (/i, F2) pages — the token IS
// the auth there, a login redirect would break them for guests/influencers —
// and inbound webhooks (#32 — Stripe authenticates via signature, not a session;
// a login redirect here would make Stripe mark every delivery as failed).
const PUBLIC_PREFIXES = ['/auth/', '/e/', '/r/', '/i/', '/api/webhooks/'];

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
  const publicRoute = isPublic(pathname);

  // MFA is fully OPTIONAL since T1 PR (c) (decision #20 refinement, 2026-07-02):
  // no enrollment gate here anymore. The app shows a skippable recommendation
  // instead (requireAppAccess → /mfa/enroll with snooze), so the middleware only
  // does session refresh + auth routing.
  const { response, user } = await updateSession(request);

  // A signed-in user has no business on the login screen → the one app surface.
  // Same for the marketing root: invite links used to strand a logged-in user
  // on the landing page with an extra "Open the app" click (T1 #1/#5).
  if (user && (pathname === '/login' || pathname === '/')) {
    const url = request.nextUrl.clone();
    url.pathname = '/app';
    url.search = '';
    return redirectWithCookies(url, response);
  }

  // Unauthenticated access to a protected route → login, remembering the target
  // (query string included, so an intent like /app?new=event survives the trip).
  if (!user && !publicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname + request.nextUrl.search);
    return redirectWithCookies(url, response);
  }

  return response;
}

export const config = {
  // Run on everything except Next internals and static assets. `monitoring` is
  // the Sentry tunnel route (D2): it MUST stay excluded — otherwise the auth-gate
  // 307's every ingest envelope to /login and no event ever arrives (the plan's
  // #1 silent failure mode). Matcher-level, not PUBLIC_PREFIXES, so no pointless
  // Supabase session refresh runs per envelope.
  matcher: [
    '/((?!_next/static|_next/image|monitoring|favicon.ico|manifest.json|sw.js|service-worker.js|workbox-|icons/|apple-touch-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|woff2?)$).*)',
  ],
};
