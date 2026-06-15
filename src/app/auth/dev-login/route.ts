import { NextResponse, type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { safeNextPath } from '@/features/auth/next-path';
import { generateTotp } from '@/features/auth/dev/totp';

// DEV-ONLY frictionless login. Signs in as any seed user with one click so we
// can click through every screen on real, RLS-scoped data. For admin/finance
// (who MUST have MFA, CLAUDE.md §Auth) it also steps the session up to AAL2 by
// enrolling a fresh TOTP factor and verifying it with a computed code — so the
// real MFA gate is satisfied genuinely, not bypassed. The whole thing runs in
// one public /auth/ request, so the middleware MFA gate never preempts it.
//
// Hard-gated to non-production: responds 404 and the service client is never
// reached. Never linked from any production surface.
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse('Not found', { status: 404 });
  }

  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  const next = safeNextPath(url.searchParams.get('next'), '/app');
  const fail = () => NextResponse.redirect(new URL('/login?error=devlogin', request.url));

  if (!email || !email.endsWith('@plusone.test')) return fail(); // seed users only

  // Mint a magic-link token_hash with the service client, then verify it on the
  // user-scoped client so the session cookies are established here.
  const svc = createServiceClient();
  const { data: link, error: linkErr } = await svc.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) return fail();

  const supabase = await createClient();
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  if (verifyErr) return fail();

  // Provision profile + memberships from any pending invites (idempotent).
  await supabase.rpc('accept_pending_invites');

  // Step up to AAL2 for roles that require MFA (admin/finance) — unless the dev
  // MFA gate is skipped, in which case there is nothing to step up to and we
  // avoid the enroll/verify churn entirely (keeps the session clean + stable).
  if (process.env.DEV_AUTH_SKIP_MFA !== 'true') {
    await devStepUpMfa(supabase);
  }

  return NextResponse.redirect(new URL(next, request.url));
}

/**
 * Brings the current dev session to AAL2 when the user's roles require MFA.
 * First clears any existing factors with the SERVICE client (enrolling an
 * ADDITIONAL factor needs AAL2, so we always start from zero and enroll a fresh
 * FIRST factor at AAL1), then enrolls TOTP and verifies it with a computed code.
 * Best-effort: on any error we log and leave the session at AAL1 (the gate then
 * redirects to /mfa/enroll, which is at least not a crash).
 */
async function devStepUpMfa(supabase: SupabaseClient<Database>): Promise<void> {
  try {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === 'aal2') return;

    const { data: requiresMfa } = await supabase.rpc('current_user_requires_mfa');
    if (!requiresMfa) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Clear existing factors (service privileges) so the enroll below is always
    // a fresh first factor — allowed at AAL1, unlike adding a second factor.
    const svc = createServiceClient();
    const { data: existing } = await svc.auth.admin.mfa.listFactors({ userId: user.id });
    for (const f of existing?.factors ?? []) {
      await svc.auth.admin.mfa.deleteFactor({ id: f.id, userId: user.id });
    }

    const { data: enroll, error: enrollErr } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `dev-${Date.now()}`,
    });
    if (enrollErr || !enroll) throw enrollErr ?? new Error('enroll failed');

    const factorId = enroll.id;
    const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
    if (chErr || !challenge) throw chErr ?? new Error('challenge failed');

    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: generateTotp(enroll.totp.secret),
    });
    if (vErr) throw vErr;
  } catch (e) {
    console.error('[dev-login] MFA step-up failed:', e);
  }
}
