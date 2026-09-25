import 'server-only';

// Store-review window (Fase 17 S3, 86ey6bfug). Pure, dependency-free predicates
// shared by /auth/review-login (is the route on?), the middleware and the /app
// layout (must a demo session end?). Kept apart from review-login.ts so those
// hot paths import nothing but a string compare and a date parse (and the
// edge middleware no node:crypto).

/**
 * The ONE account the review login can ever sign in. A code constant, not an
 * env var and never a request parameter: an env var could be mis-set to a real
 * user's address, which would turn a leaked review code into a login as that
 * user. `demo.plus-one.io` is a subdomain we own with no MX record, so nobody
 * can receive mail there, and no real invitee can ever hold this address.
 * scripts/seed-demo-venue.mjs mirrors it (guarded by review-login.test.ts).
 */
export const DEMO_REVIEW_EMAIL = 'app-review@demo.plus-one.io';

/**
 * The demo account's fixed auth user id: the seed creates it with exactly this
 * id. Checks key on the id AND the e-mail, so a rebound address (see
 * updateEmailAction, which refuses the demo account) can never slip past.
 */
export const DEMO_USER_ID = 'de300000-0000-7000-8000-00000000a001';

/** The only venue the demo user may be a member of, by id (the name is display only). */
export const DEMO_VENUE_ID = 'de300000-0000-7000-8000-000000000001';
export const DEMO_VENUE_NAME = 'PlusOne Demo';

/**
 * The exact role set the seed gives the demo membership. The review login
 * refuses any other set: the venue-isolation reads below only see other rows
 * of the venue while the membership carries `admin`, and an admin can edit its
 * own row (venue_memberships_update), so a demoted row would blind the check.
 */
export const DEMO_ROLES: readonly string[] = ['admin', 'doorhost'];

/**
 * Minimum alphanumeric characters in the code (dashes and whitespace do not
 * count). 26 base32 characters carry 130 bits: the code's own entropy is the
 * brute-force bound, the per-client limit and the Vercel Firewall rule sit on
 * top of that.
 */
export const MIN_CODE_CHARS = 26;

/** A review window may be at most this far in the future ("set and forget" guard). */
export const MAX_WINDOW_DAYS = 60;

/** Where the /app layout sends a demo session whose review window has closed. */
export const REVIEW_SESSION_END_PATH = '/auth/review-login/end';

type Env = Record<string, string | undefined>;

// Full ISO-8601 date-time with an explicit zone; nothing Date.parse would also
// accept ("Sep 30 2026", a bare date read as UTC midnight, …).
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * True while REVIEW_LOGIN_EXPIRES_AT is a valid ISO timestamp in the future and
 * no more than MAX_WINDOW_DAYS ahead. Missing, unparseable, past or too far out
 * all read as closed.
 */
export function reviewWindowOpen(env: Env = process.env, now: number = Date.now()): boolean {
  const raw = (env.REVIEW_LOGIN_EXPIRES_AT ?? '').trim();
  if (!ISO_WITH_ZONE.test(raw)) return false;
  const expiresAt = Date.parse(raw);
  if (Number.isNaN(expiresAt)) return false;
  return expiresAt > now && expiresAt - now <= MAX_WINDOW_DAYS * 86_400_000;
}

/**
 * The configured review code, or null when the route must behave as if it
 * does not exist: the window is closed, or the code is unset, blank or too
 * weak (fewer than MIN_CODE_CHARS letters/digits).
 */
export function configuredReviewCode(env: Env = process.env, now: number = Date.now()): string | null {
  if (!reviewWindowOpen(env, now)) return null;
  const code = (env.REVIEW_LOGIN_CODE ?? '').trim();
  const strength = code.replace(/[-\s]/g, '').length;
  return strength >= MIN_CODE_CHARS ? code : null;
}

type MaybeUser = { id?: string | null; email?: string | null } | null | undefined;

/**
 * True when EITHER the id or the e-mail is the demo account's: every gate that
 * must catch the demo account (layout, end route, e-mail change) uses this, so
 * changing one of the two never escapes it.
 */
export function isDemoReviewUser(user: MaybeUser): boolean {
  if (!user) return false;
  return user.id === DEMO_USER_ID || (user.email ?? '').toLowerCase() === DEMO_REVIEW_EMAIL;
}

/** True only when BOTH match: what the review login requires before keeping a session. */
export function isExactDemoAccount(user: MaybeUser): boolean {
  if (!user) return false;
  return user.id === DEMO_USER_ID && (user.email ?? '').toLowerCase() === DEMO_REVIEW_EMAIL;
}

/**
 * A demo-account session may only live while the review login is enabled. When
 * the window closes (or the code is removed), the middleware (updateSession)
 * ends it on the next request, and the /app layout does the same as a second
 * layer: no cron and no migration. Keyed on the user id as well as the e-mail.
 * A plain string compare for everyone else, so no extra query on either hot
 * path. Residual: a pure-API client that never requests the app keeps its
 * session until the next review login or `seed-demo-venue.mjs --end-review`.
 */
export function demoSessionMustEnd(user: MaybeUser, env: Env = process.env, now: number = Date.now()): boolean {
  return isDemoReviewUser(user) && configuredReviewCode(env, now) === null;
}
