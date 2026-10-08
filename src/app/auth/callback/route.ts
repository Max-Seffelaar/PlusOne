import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/features/auth/next-path';
import { resolveEntryDestination } from '@/features/auth/entry-redirect';

// First stop after a successful OTP verification. With the session cookies now
// present server-side, we make sure the user's profile row exists, then land
// them at their destination. Login accepts NO invite, team or crew: an invite
// becomes access only when the person taps Accept (Home banner, or the invite
// step on /onboarding), so a company can never read an account's profile just
// because its admin typed that address (z8uq9m2yvp).
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));

  // Forward the browser UA so a session minted here gets a usable device label
  // in the active-sessions list (see /auth/confirm).
  const supabase = await createClient({
    headers: { 'User-Agent': request.headers.get('user-agent') ?? 'PlusOne' },
  });

  // PKCE links land here with ?code= (same-browser flow, verifier cookie
  // present) — exchange it so the session cookies exist before the gate below.
  // E-mail links from another browser use /auth/confirm (token_hash) instead.
  const code = url.searchParams.get('code');
  if (code) {
    await supabase.auth.exchangeCodeForSession(code);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Idempotent: a no-op once the profile row exists.
  await supabase.rpc('ensure_my_profile');

  // One redirect straight to where the gates would land them anyway (consent /
  // onboarding), instead of a 3-hop chain of serverless round-trips.
  const dest = await resolveEntryDestination(user.id, next);
  return NextResponse.redirect(new URL(dest, request.url));
}
