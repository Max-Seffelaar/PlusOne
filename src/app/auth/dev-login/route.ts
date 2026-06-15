import { NextResponse, type NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { safeNextPath } from '@/features/auth/next-path';

// DEV-ONLY frictionless login. Lets us sign in as any seed user with one click
// so we can click through every screen on real, RLS-scoped data without the OTP
// round-trip through Inbucket. It mints a magic-link token_hash via the service
// client (server-side only) and hands off to the existing /auth/confirm route,
// which runs the real verifyOtp + accept-invites plumbing — so the session it
// establishes is identical to a production OTP login.
//
// Hard-gated to non-production. In production this responds 404 and the service
// client is never reached. Never linked from any production surface.
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('Not found', { status: 404 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  const next = safeNextPath(url.searchParams.get('next'), '/app');

  if (!email || !email.endsWith('@plusone.test')) {
    // Only the seed users — never an arbitrary address.
    return NextResponse.redirect(new URL('/login?error=devlogin', request.url));
  }

  const svc = createServiceClient();
  const { data, error } = await svc.auth.admin.generateLink({ type: 'magiclink', email });

  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) {
    return NextResponse.redirect(new URL('/login?error=devlogin', request.url));
  }

  const confirm = new URL('/auth/confirm', request.url);
  confirm.searchParams.set('token_hash', tokenHash);
  confirm.searchParams.set('type', 'magiclink');
  confirm.searchParams.set('next', next);
  return NextResponse.redirect(confirm);
}
