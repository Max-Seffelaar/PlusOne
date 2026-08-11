import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/features/auth/next-path';
import { resolveEntryDestination } from '@/features/auth/entry-redirect';
import { emailOtpTypeSchema } from '@/features/auth/schemas';

// Handles link-based verification (token_hash), used for the confirmed e-mail
// change flow (decision #24) and any magic-link fallback. On success the
// session cookies are (re)established and we redirect to the target.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  if (!tokenHash) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const parsedType = emailOtpTypeSchema.safeParse(url.searchParams.get('type'));
  if (!parsedType.success) {
    // A token_hash without a recognized type used to reach verifyOtp anyway
    // (GoTrue rejected it) and bounce to /login?error=link with a visible
    // message; failing the shape check earlier must land on the same visible
    // outcome, not a silent bare /login that looks like "no link at all".
    return NextResponse.redirect(new URL('/login?error=link', request.url));
  }
  const type = parsedType.data;

  // Invite/magic-link e-mails land in the app flow; only the e-mail-change
  // confirmation belongs on the profile screen (T1 #1 — one flow, no detour).
  const fallback = type === 'email_change' ? '/settings/profile' : '/app';
  const next = safeNextPath(url.searchParams.get('next'), fallback);

  // Forward the browser's real User-Agent so the session GoTrue records carries
  // a usable device label ("Chrome · Windows") in the active-sessions list — a
  // server-side verifyOtp otherwise stamps the Node UA ("Unknown device").
  const supabase = await createClient({
    headers: { 'User-Agent': request.headers.get('user-agent') ?? 'PlusOne' },
  });
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error || !data.user) {
    return NextResponse.redirect(new URL('/login?error=link', request.url));
  }

  // Pick up any invites that became acceptable on this verified session.
  await supabase.rpc('accept_pending_invites');

  // One redirect straight to where the gates would land them anyway (consent /
  // onboarding), instead of a 3-hop chain of serverless round-trips.
  const dest = await resolveEntryDestination(data.user.id, next);
  return NextResponse.redirect(new URL(dest, request.url));
}
