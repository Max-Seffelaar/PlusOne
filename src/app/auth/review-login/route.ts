import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { resolveEntryDestination } from '@/features/auth/entry-redirect';
import {
  DEMO_REVIEW_EMAIL,
  DEMO_ROLES,
  DEMO_VENUE_ID,
  configuredReviewCode,
  isExactDemoAccount,
} from '@/features/auth/review-window';
import {
  AttemptLimiter,
  createReviewAuthClient,
  type ReviewAuthClient,
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
//   6. The token is verified on a COOKIE-LESS client, and every check runs
//      there: the session must be the demo account (id AND e-mail), with no
//      verified TOTP factor, no platform-admin flag, exactly one membership
//      (venue_id = DEMO_VENUE_ID) whose roles are exactly DEMO_ROLES, and the
//      demo venue must be isolated (no other member, no open invite into it or
//      to the demo address). The role check comes first: the isolation reads
//      only see the whole venue AS ADMIN. A refusal never
//      wrote a cookie, so it does not depend on a sign-out succeeding.
//   7. Still on that client, the demo user's OTHER sessions are revoked: one
//      live demo session at a time. Only then are the cookies set.
//      Sessions also die with the window: once configuredReviewCode() is null
//      the middleware (updateSession) signs a demo session out globally on its
//      next request to any covered route, and the /app layout sends it to
//      /auth/review-login/end as a second layer.
//   8. Every method other than GET/HEAD/POST answers the same 404.
//
// Service role: GoTrue has no way to start a session for a user without a
// credential except an admin-minted magic link, so this route (like dev-login)
// uses the service client for exactly ONE call, auth.admin.generateLink for the
// constant demo address. Every read after that runs as the demo user, under
// RLS, on the anon-key client.

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

  // Verify on a COOKIE-LESS client: the session exists only in memory until
  // every check below has passed. Only then is it copied onto the cookie client.
  const probe = createReviewAuthClient(request.headers.get('user-agent') ?? 'PlusOne review-login');
  const { data: verified, error: verifyError } = await probe.auth.verifyOtp({
    type: 'magiclink',
    token_hash: tokenHash,
  });
  const user = verified?.user;
  const session = verified?.session;
  if (verifyError || !user || !session) {
    logReviewLogin('mint_failed', client, 'verify');
    return backToForm(request, 'failed');
  }

  const refusal = await demoAccountRefusal(probe, user);
  if (refusal) {
    // No cookie was ever written. Revoking the in-memory session is hygiene only.
    await probe.auth.signOut({ scope: 'local' }).catch(() => undefined);
    logReviewLogin('refused', client, refusal);
    return backToForm(request, 'failed');
  }

  // One live demo session at a time: revoke every OTHER session of the demo
  // user before this one is handed out. If that fails, the older sessions would
  // survive, so fail closed (still nothing written to cookies).
  const { error: othersError } = await probe.auth.signOut({ scope: 'others' });
  if (othersError) {
    await probe.auth.signOut({ scope: 'local' }).catch(() => undefined);
    logReviewLogin('refused', client, 'revoke_others');
    return backToForm(request, 'failed');
  }

  // All checks passed: now, and only now, set the session cookies.
  const supabase = await createClient();
  const { error: setError } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (setError) {
    await probe.auth.signOut({ scope: 'local' }).catch(() => undefined);
    logReviewLogin('mint_failed', client, 'set_session');
    return backToForm(request, 'failed');
  }

  logReviewLogin('success', client);
  // Same final hop as every entry route: the consent gate first, then /app.
  const dest = await resolveEntryDestination(user.id, '/app');
  return withNoStore(NextResponse.redirect(new URL(dest, request.url), 303));
}

// Every other method answers exactly like a disabled route (HEAD maps to GET):
// the route never advertises itself through OPTIONS/405.
export const OPTIONS = notFoundHandler;
export const PUT = notFoundHandler;
export const PATCH = notFoundHandler;
export const DELETE = notFoundHandler;

async function notFoundHandler(): Promise<NextResponse> {
  return notFound();
}

/**
 * Why this session must NOT be kept, or null when it is the demo account in
 * the expected shape. Runs as the demo user on the cookie-less client (RLS),
 * no service role.
 */
async function demoAccountRefusal(
  probe: ReviewAuthClient,
  user: { id: string; email?: string | null },
): Promise<string | null> {
  if (!isExactDemoAccount(user)) return 'account';

  // A verified TOTP factor would strand the reviewer on the AAL2 wall, and
  // would mean someone enrolled their own authenticator on the shared account.
  const { data: factors, error: factorError } = await probe.auth.mfa.listFactors();
  if (factorError) return 'factors_unreadable';
  if ((factors?.totp ?? []).some((f) => f.status === 'verified')) return 'mfa_enrolled';

  const { data: isAdmin, error: adminError } = await probe.rpc('is_platform_admin');
  if (adminError) return 'platform_flag_unreadable';
  if (isAdmin !== false) return 'platform_admin';

  // User isolation, by id (a venue admin can rename a venue, not re-key it).
  const { data: own, error: ownError } = await probe
    .from('venue_memberships')
    .select('venue_id, roles')
    .eq('user_id', user.id);
  if (ownError || !own) return 'memberships_unreadable';
  if (own.length !== 1) return 'membership_count';
  if (own[0]?.venue_id !== DEMO_VENUE_ID) return 'membership_venue';
  // Exactly the seeded roles, BEFORE the counts below are trusted: those reads
  // see other members and the venue's invites only while this row carries
  // `admin` (venue_memberships_select / invites_select), and an admin can
  // rewrite its own row. A demoted row would make the counts look clean.
  if (!sameRoles(own[0]?.roles, DEMO_ROLES)) return 'roles_changed';

  // Venue isolation: nobody else in the demo venue (a code holder, as admin,
  // could invite a real address that outlives every window), and no open
  // invite into the demo venue or addressed to the demo e-mail (consent would
  // accept that one AFTER this check). As admin of the venue (checked just
  // above) the demo user can read all of this under RLS: every membership of
  // its venue, its venue's invites, and invites to its own address
  // (invites_select, via the JWT e-mail).
  const { data: members, error: membersError } = await probe
    .from('venue_memberships')
    .select('user_id')
    .eq('venue_id', DEMO_VENUE_ID);
  if (membersError || !members) return 'venue_members_unreadable';
  if (members.length !== 1 || members[0]?.user_id !== user.id) return 'venue_not_isolated';

  const nowIso = new Date().toISOString();
  const [venueInvites, addressedInvites] = await Promise.all([
    probe.from('invites').select('id').eq('venue_id', DEMO_VENUE_ID).is('accepted_at', null).gt('expires_at', nowIso),
    probe.from('invites').select('id').ilike('email', DEMO_REVIEW_EMAIL).is('accepted_at', null).gt('expires_at', nowIso),
  ]);
  if (venueInvites.error || addressedInvites.error) return 'invites_unreadable';
  if ((venueInvites.data?.length ?? 0) > 0 || (addressedInvites.data?.length ?? 0) > 0) return 'venue_not_isolated';

  return null;
}

function sameRoles(actual: readonly string[] | null | undefined, expected: readonly string[]): boolean {
  if (!actual || actual.length !== expected.length) return false;
  const want = new Set(expected);
  return new Set(actual).size === want.size && actual.every((r) => want.has(r));
}
