import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { resolveEntryDestination } from '@/features/auth/entry-redirect';
import {
  DEMO_REVIEW_EMAIL,
  DEMO_VENUE_ID,
  configuredReviewCode,
  isDemoReviewUser,
} from '@/features/auth/review-window';
import {
  AttemptLimiter,
  logReviewLogin,
  renderReviewForm,
  reviewClientKey,
  reviewCodeMatches,
  type ReviewFormError,
} from '@/features/auth/review-login';

// PROD store-review login (Fase 17 S3, 86ey6bfug; capacitor-plan §2 decision 6).
// App Store / Play reviewers need a working login, but the app is invite-only +
// passwordless and /auth/dev-login is hard non-prod-gated. This route signs in
// exactly ONE account, the demo user of the "PLUSONE Demo" venue, when the
// reviewer submits the per-submission REVIEW_LOGIN_CODE.
//
//   GET  /auth/review-login  → the code form (static HTML, no JS)
//   POST /auth/review-login  → code in the form body → session → /app
//
// Gates, in order (runbook: docs/review-login.md):
//   1. The review window is closed → 404 on GET and POST alike, no hint. Closed
//      = REVIEW_LOGIN_EXPIRES_AT missing/unparseable/past/more than 60 days out,
//      or REVIEW_LOGIN_CODE unset/blank/under 26 letters+digits
//      (review-window.ts). The window closes by itself; nothing to unset.
//   2. POST only: a cross-site Origin → 404 (no login CSRF into the demo account).
//   3. Per-client attempt limiter BEFORE the compare, so every guess burns the
//      sender's own budget. No global cap: nobody can lock the reviewer out.
//   4. Constant-time code compare. The code is never read from a query string.
//   5. The account is DEMO_REVIEW_EMAIL, a code constant. Nothing in the request
//      selects a user, and the destination is fixed (/app via the entry gate), so
//      there is no `next=` to redirect through.
//   6. After sign-in, fail closed unless the session really is the demo user
//      with exactly one membership (venue_id = DEMO_VENUE_ID), no platform-admin
//      flag and no verified TOTP factor; otherwise sign that session out again.
//   7. On success, sign out the demo user's OTHER sessions: one live demo
//      session at a time, so a leaked earlier session dies at the next login.
//      Sessions also die with the window: the /app layout sends a demo session
//      to /auth/review-login/end once configuredReviewCode() is null.
//
// Service role: GoTrue has no way to start a session for a user without a
// credential except an admin-minted magic link, so this route (like dev-login)
// uses the service client for exactly ONE call, auth.admin.generateLink for the
// constant demo address. Every read after that goes through the user-scoped
// client, under RLS, as the demo user.

export const dynamic = 'force-dynamic';

// 5 attempts per client per 15 min (in-memory, so per serverless instance; see
// AttemptLimiter for why there is no global cap).
const WINDOW_MS = 15 * 60 * 1000;
const limiter = new AttemptLimiter(5, WINDOW_MS);

const formSchema = z.object({ code: z.string().max(256) });

const NO_STORE = {
  'Cache-Control': 'no-store, private, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
} as const;

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404, headers: NO_STORE });
}

function backToForm(request: NextRequest, error: Exclude<ReviewFormError, null>): NextResponse {
  const url = new URL('/auth/review-login', request.url);
  url.searchParams.set('error', error);
  return withNoStore(NextResponse.redirect(url, 303));
}

function withNoStore(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(NO_STORE)) res.headers.set(k, v);
  return res;
}

function formError(raw: string | null): ReviewFormError {
  return raw === 'code' || raw === 'wait' || raw === 'failed' ? raw : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!configuredReviewCode()) return notFound();
  const error = formError(request.nextUrl.searchParams.get('error'));
  return new NextResponse(renderReviewForm(error), {
    status: 200,
    headers: { ...NO_STORE, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = configuredReviewCode();
  if (!expected) return notFound();

  const client = reviewClientKey(request.headers);

  // A form POST from a browser always carries Origin; a foreign one is a
  // cross-site submit (login CSRF). Absent Origin = a non-browser client, which
  // gains nothing over typing the code into the form itself.
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== request.nextUrl.origin) {
    logReviewLogin('bad_origin', client);
    return notFound();
  }

  if (!limiter.consume(client)) {
    logReviewLogin('rate_limited', client);
    return backToForm(request, 'wait');
  }

  let submitted: string | null = null;
  try {
    const form = await request.formData();
    const parsed = formSchema.safeParse({ code: form.get('code') });
    submitted = parsed.success ? parsed.data.code : null;
  } catch {
    submitted = null; // not a form body
  }
  if (!reviewCodeMatches(submitted, expected)) {
    logReviewLogin('bad_code', client);
    return backToForm(request, 'code');
  }

  // The one service-role call (see header): mint a magic-link token for the
  // constant demo address. Never a request-supplied address.
  const admin = createServiceClient();
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: DEMO_REVIEW_EMAIL,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    logReviewLogin('mint_failed', client, 'generate_link');
    return backToForm(request, 'failed');
  }

  const supabase = await createClient({
    headers: { 'User-Agent': request.headers.get('user-agent') ?? 'PlusOne review-login' },
  });
  const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  const user = verified?.user;
  if (verifyError || !user) {
    logReviewLogin('mint_failed', client, 'verify');
    return backToForm(request, 'failed');
  }

  const refusal = await demoAccountRefusal(supabase, user.id, user.email);
  if (refusal) {
    // Fail closed: drop the session this request just created.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    logReviewLogin('refused', client, refusal);
    return backToForm(request, 'failed');
  }

  // One live demo session at a time: revoke every other session of the demo
  // user. If that fails, the older sessions would survive, so fail closed.
  const { error: othersError } = await supabase.auth.signOut({ scope: 'others' });
  if (othersError) {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    logReviewLogin('refused', client, 'revoke_others');
    return backToForm(request, 'failed');
  }

  logReviewLogin('success', client);
  // Same final hop as every entry route: the consent gate first, then /app.
  const dest = await resolveEntryDestination(user.id, '/app');
  return withNoStore(NextResponse.redirect(new URL(dest, request.url), 303));
}

type UserClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Why this session must NOT be kept, or null when it is the demo account in
 * the expected shape. Runs as the demo user (RLS), no service role.
 */
async function demoAccountRefusal(
  supabase: UserClient,
  userId: string,
  email: string | undefined,
): Promise<string | null> {
  if (!isDemoReviewUser(email)) return 'email';

  // A verified TOTP factor would strand the reviewer on the AAL2 wall, and
  // would mean someone enrolled their own authenticator on the shared account.
  const { data: factors, error: factorError } = await supabase.auth.mfa.listFactors();
  if (factorError) return 'factors_unreadable';
  if ((factors?.totp ?? []).some((f) => f.status === 'verified')) return 'mfa_enrolled';

  const { data: isAdmin, error: adminError } = await supabase.rpc('is_platform_admin');
  if (adminError) return 'platform_flag_unreadable';
  if (isAdmin !== false) return 'platform_admin';

  // By id, never by name: a venue admin can rename a venue, not re-key it.
  const { data: memberships, error: memberError } = await supabase
    .from('venue_memberships')
    .select('venue_id')
    .eq('user_id', userId);
  if (memberError || !memberships) return 'memberships_unreadable';
  if (memberships.length !== 1) return 'membership_count';
  if (memberships[0]?.venue_id !== DEMO_VENUE_ID) return 'membership_venue';

  return null;
}
