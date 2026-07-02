import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/features/auth/next-path';

// Handles link-based verification (token_hash), used for the confirmed e-mail
// change flow (decision #24) and any magic-link fallback. On success the
// session cookies are (re)established and we redirect to the target.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  // Invite/magic-link e-mails land in the app flow; only the e-mail-change
  // confirmation belongs on the profile screen (T1 #1 — one flow, no detour).
  const fallback = type === 'email_change' ? '/settings/profile' : '/app';
  const next = safeNextPath(url.searchParams.get('next'), fallback);

  if (!tokenHash || !type) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Forward the browser's real User-Agent so the session GoTrue records carries
  // a usable device label ("Chrome · Windows") in the active-sessions list — a
  // server-side verifyOtp otherwise stamps the Node UA ("Unknown device").
  const supabase = await createClient({
    headers: { 'User-Agent': request.headers.get('user-agent') ?? 'PlusOne' },
  });
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    return NextResponse.redirect(new URL('/login?error=link', request.url));
  }

  // Pick up any invites that became acceptable on this verified session.
  await supabase.rpc('accept_pending_invites');

  return NextResponse.redirect(new URL(next, request.url));
}
