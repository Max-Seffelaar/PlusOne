import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { safeNextPath } from '@/features/auth/next-path';
import { resolveEntryDestination } from '@/features/auth/entry-redirect';
import { devTotpCode } from '@/features/auth/dev-totp';

// LOCAL-ONLY one-hit dev login. Mints a magic-link token with the service role
// and verifies it to set the session cookies — a STABLE, reusable URL so local
// testing never needs Mailpit or a freshly-minted link:
//
//   http://localhost:7000/auth/dev-login?email=manager@plusone.test&next=/app
//
// HARD-GATED — runs only in development AND against a localhost Supabase URL, so
// it can never work in production (prod is NODE_ENV=production with a hosted URL).
//
// MFA: for the seed admin/finance accounts (which carry the FIXED dev TOTP secret
// stamped by scripts/dev-mfa.mjs) it completes the MFA challenge server-side, so
// admin login is one click locally — no authenticator app. Pass ?aal1=1 to skip
// that and land at AAL1 (to exercise the real /mfa/verify wall). This never
// weakens prod: the route 404s there and the fixed secret only exists locally.

// Mirrors scripts/dev-mfa.mjs — the local-only fixed TOTP secret.
const DEV_MFA_SECRET = 'PLUSONELOCALADMINDEVSECRET234567';
function devLoginEnabled(): boolean {
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const onLocalSupabase = /(?:localhost|127\.0\.0\.1)/.test(supaUrl);
  return process.env.NODE_ENV !== 'production' && onLocalSupabase;
}

// A `next` the open-redirect guard refuses silently becomes /app, which reads
// exactly like "the deep link is broken". Say so in the dev-server log instead.
// The drive-letter hint covers the case that actually happened: Git Bash (MSYS)
// rewrites a POSIX-looking CLI argument such as `/app/contacts` into
// `C:/Program Files/Git/app/contacts` before a script ever sees it.
function warnIfNextRejected(raw: string | null, resolved: string): void {
  if (!raw || raw === resolved) return;
  const msysHint = /^[A-Za-z]:[\\/]/.test(raw)
    ? ' This looks like a Windows path: Git Bash rewrites /paths passed as CLI arguments, so set MSYS_NO_PATHCONV=1 (or build the URL inside the script).'
    : '';
  console.warn(
    `[dev-login] ignored next=${JSON.stringify(raw)}: not a safe in-app path, landing on ${resolved}.${msysHint}`,
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!devLoginEnabled()) {
    return new NextResponse('Not found', { status: 404 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  const rawNext = url.searchParams.get('next');
  const next = safeNextPath(rawNext, '/app');
  warnIfNextRejected(rawNext, next);
  if (!email) {
    return NextResponse.redirect(new URL('/login?error=devlogin', request.url));
  }

  // Service role: mint a magic-link token for the seed user.
  const admin = createServiceClient();

  // ?create=1 — mint a FRESH venue-less user on demand (local-only, same hard
  // gate). This is how you test the new-owner flow (account → company → first
  // event) repeatably: any made-up address becomes a brand-new account with no
  // membership, no Mailpit round-trip needed. Existing accounts just log in.
  if (url.searchParams.get('create') === '1') {
    const { error: createError } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (createError && !/already|exists|registered/i.test(createError.message)) {
      return NextResponse.redirect(new URL('/login?error=devlogin', request.url));
    }
  }

  const { data, error: genError } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = data?.properties?.hashed_token;
  if (genError || !tokenHash) {
    return NextResponse.redirect(new URL('/login?error=devlogin', request.url));
  }

  // User-scoped client: verify the token so the session cookies are set. Forward
  // the browser's real User-Agent so the session GoTrue records carries a usable
  // device label ("Chrome · Windows") in the active-sessions list — a server-side
  // verifyOtp otherwise stamps the Node UA, which degrades to a bare "Browser".
  const supabase = await createClient({
    headers: { 'User-Agent': request.headers.get('user-agent') ?? 'PlusOne dev-login' },
  });
  const { data: verified, error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (error || !verified.user) {
    return NextResponse.redirect(new URL('/login?error=devlogin', request.url));
  }

  // One-click AAL2: complete the MFA challenge for a seed account that has a
  // verified TOTP factor on the fixed dev secret, so admin/finance land straight
  // in the app. Best-effort — a self-enrolled factor with another secret just
  // stays AAL1 and hits the normal MFA wall. Opt out with ?aal1=1.
  if (url.searchParams.get('aal1') !== '1') {
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.find((f) => f.status === 'verified');
      if (totp) {
        await supabase.auth.mfa.challengeAndVerify({
          factorId: totp.id,
          code: devTotpCode(DEV_MFA_SECRET, Date.now()),
        });
      }
    } catch {
      /* leave the session at AAL1; the MFA gate handles the step-up */
    }
  }

  await supabase.rpc('accept_pending_invites');

  // Same final hop as the real entry routes (/auth/confirm, /auth/callback):
  // a user who still owes consent goes to /consent?next=<deep link>. Redirecting
  // straight to `next` instead let the /app layout's consent gate catch them,
  // and that gate can only send them back to bare /app (it can't see the
  // requested path), so dev-login deep links landed on Home for any seed user
  // who hadn't accepted the terms yet.
  const dest = await resolveEntryDestination(verified.user.id, next);
  return NextResponse.redirect(new URL(dest, request.url));
}
