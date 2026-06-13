import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/features/auth/next-path';

// First stop after a successful OTP verification. With the session cookies now
// present server-side, we accept any pending invites — which provisions the
// user's profile + venue membership(s) (decision #24, "accepteren = eerste
// OTP-login") — then land the user at their destination.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Idempotent: a no-op when there is nothing pending (decision #25).
  await supabase.rpc('accept_pending_invites');

  return NextResponse.redirect(new URL(next, request.url));
}
