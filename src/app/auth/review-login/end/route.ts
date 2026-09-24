import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { demoSessionMustEnd } from '@/features/auth/review-window';
import { logReviewLogin, reviewClientKey } from '@/features/auth/review-login';

// Ends a demo-account session once the review window has closed (Fase 17 S3,
// 86ey6bfug). The /app layout redirects here for the demo user when
// demoSessionMustEnd() is true; the layout itself cannot sign out, because a
// Server Component cannot clear cookies, and a signed-in user on /login is
// bounced back to /app by the middleware (a loop).
//
// Side effects are narrow on purpose: this acts ONLY on a session that belongs
// to the demo account AND whose window is closed. Anyone else, or the demo
// user during an open window, is just sent on to /app with the session
// untouched, so a cross-site GET can never sign a real user out.
//
// scope 'global' revokes every demo session, not just this device's: once the
// window is closed no demo session may live anywhere.

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store, private, max-age=0' } as const;

function redirectTo(request: NextRequest, path: string): NextResponse {
  const res = NextResponse.redirect(new URL(path, request.url), 303);
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redirectTo(request, '/login');
  if (!demoSessionMustEnd(user)) return redirectTo(request, '/app');

  const client = reviewClientKey(request.headers);
  const { error } = await supabase.auth.signOut({ scope: 'global' });
  if (error) {
    // The cookies were not cleared: redirecting to /login would bounce back to
    // /app and here again. Stop with a plain error instead of a redirect loop.
    logReviewLogin('session_ended', client, 'signout_failed');
    return new NextResponse('Service unavailable', { status: 503, headers: NO_STORE });
  }
  logReviewLogin('session_ended', client, 'window_closed');
  return redirectTo(request, '/login');
}
