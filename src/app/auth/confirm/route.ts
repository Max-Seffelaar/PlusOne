import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNextPath } from '@/features/auth/next-path';
import { resolveEntryDestination } from '@/features/auth/entry-redirect';
import { emailOtpTypeSchema } from '@/features/auth/schemas';
import { linkVerifyTypes, verifyWithFallback } from '@/features/auth/verify-fallback';

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
  // The live profile screen is /app/profile (po routes.ts) — /settings/profile
  // was a dead route (86ey9ea00 #56): it 307'd through the /app catch-all guard
  // straight back to /app, so a confirmed e-mail change silently dropped the
  // user on the home screen instead of their profile.
  const fallback = type === 'email_change' ? '/app/profile' : '/app';
  const next = safeNextPath(url.searchParams.get('next'), fallback);

  // Forward the browser's real User-Agent so the session GoTrue records carries
  // a usable device label ("Chrome · Windows") in the active-sessions list — a
  // server-side verifyOtp otherwise stamps the Node UA ("Unknown device").
  const supabase = await createClient({
    headers: { 'User-Agent': request.headers.get('user-agent') ?? 'PlusOne' },
  });
  // A mail's declared type is a hint, not a fact: GoTrue files an invite for an
  // already-existing-but-unconfirmed account in the *confirmation* slot and
  // sends the "Confirm signup" mail for it, so a link that says `type=invite`
  // can only be verified as `signup` (and vice versa). Try the declared type
  // first, then at most its confirmation-slot sibling (P-01).
  const { data, error } = await verifyWithFallback(linkVerifyTypes(type), async (candidate) => {
    const result = await supabase.auth.verifyOtp({ type: candidate, token_hash: tokenHash });
    // A verify that succeeded but produced no user is TERMINAL, never a slot
    // miss: GoTrue consumed the token and the SSR client may already have
    // written session cookies, so retrying another slot would burn a second
    // token for a state we cannot recover anyway (PR #324 review). The error
    // shape below carries no retryable status on purpose — verifyWithFallback
    // stops on it.
    if (!result.error && !result.data.user) {
      return { error: { message: 'Verification returned no user' } };
    }
    return { data: result.data, error: result.error };
  });

  if (error || !data?.user) {
    // Details stay server-side; the user gets a readable screen with a way out.
    return NextResponse.redirect(new URL('/login?error=link', request.url));
  }

  // Pick up any invites that became acceptable on this verified session.
  await supabase.rpc('accept_pending_invites');

  // One redirect straight to where the gates would land them anyway (consent /
  // onboarding), instead of a 3-hop chain of serverless round-trips.
  const dest = await resolveEntryDestination(data.user.id, next);
  return NextResponse.redirect(new URL(dest, request.url));
}
