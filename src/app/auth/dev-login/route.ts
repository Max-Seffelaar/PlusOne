import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { safeNextPath } from '@/features/auth/next-path';

// LOCAL-ONLY one-hit dev login. Mints a magic-link token with the service role
// and verifies it to set the session cookies — a STABLE, reusable URL so local
// testing never needs Mailpit or a freshly-minted link:
//
//   http://localhost:7000/auth/dev-login?email=manager@plusone.test&next=/app
//
// HARD-GATED — runs only in development AND against a localhost Supabase URL, so
// it can never work in production (prod is NODE_ENV=production with a hosted URL).
// It does NOT bypass MFA: the minted session is AAL1, so admin/finance still hit
// the MFA gate afterwards. It only skips the OTP step for the no-MFA seed users
// (manager/staff/door@plusone.test).
function devLoginEnabled(): boolean {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const onLocalSupabase = /(?:localhost|127\.0\.0\.1)/.test(supaUrl);
  return process.env.NODE_ENV !== 'production' && onLocalSupabase;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!devLoginEnabled()) {
    return new NextResponse('Not found', { status: 404 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  const next = safeNextPath(url.searchParams.get('next'), '/app');
  if (!email) {
    return NextResponse.redirect(new URL('/login?error=devlogin', request.url));
  }

  // Service role: mint a magic-link token for the seed user.
  const admin = createServiceClient();
  const { data, error: genError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = data?.properties?.hashed_token;
  if (genError || !tokenHash) {
    return NextResponse.redirect(new URL('/login?error=devlogin', request.url));
  }

  // User-scoped client: verify the token so the session cookies are set.
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (error) {
    return NextResponse.redirect(new URL('/login?error=devlogin', request.url));
  }

  await supabase.rpc('accept_pending_invites');
  return NextResponse.redirect(new URL(next, request.url));
}
