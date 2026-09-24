import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { t } from '@/lib/i18n';
import { landingIpSalt } from '@/features/requests/ip-hash';

// Store-review login (Fase 17 S3, 86ey6bfug; capacitor-plan §2 decision 6).
// Pure helpers for src/app/auth/review-login/route.ts, split out because a
// Route Handler file may only export the names Next.js recognises.

/** Upper bound on a submitted code; anything longer is refused unhashed. */
const MAX_INPUT_LENGTH = 256;

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Constant-time comparison. Both sides are hashed first so the buffers
 * handed to timingSafeEqual always have equal length (it throws otherwise),
 * and a length mismatch is not observable through timing either.
 */
export function reviewCodeMatches(submitted: unknown, expected: string): boolean {
  if (typeof submitted !== 'string') return false;
  const candidate = submitted.trim();
  if (candidate.length === 0 || candidate.length > MAX_INPUT_LENGTH) return false;
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

/**
 * Salted SHA-256 of the client IP, the same salt and stance as the landing
 * throttle (src/features/requests/ip-hash.ts): never a reversible IP in memory
 * or logs. Reads the request headers directly so the route stays testable.
 */
export function reviewClientKey(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  const ip = (forwarded ? forwarded.split(',')[0] : headers.get('x-real-ip') ?? '').trim();
  return createHash('sha256').update(`${landingIpSalt()}:review:${ip || 'no-ip'}`).digest('hex');
}

/**
 * Fixed-window attempt limiter, PER CLIENT only. There is deliberately no
 * instance-wide cap: a global bucket would let anyone lock the reviewer out by
 * spraying junk attempts from many IPs. Junk attempts now burn only the
 * sender's own budget; the brute-force bound is the code's entropy
 * (MIN_CODE_CHARS, 130 bits) plus the Vercel Firewall rule in
 * docs/review-login.md. The map is in-memory and therefore per serverless
 * instance, and bounded: a spray of distinct clients evicts expired buckets
 * first and resets the map only when every bucket is still live.
 */
export class AttemptLimiter {
  private readonly buckets = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly perKey: number,
    private readonly windowMs: number,
    private readonly maxKeys = 5000,
  ) {}

  /** Consumes one attempt; false once this client is over budget. */
  consume(key: string, now: number = Date.now()): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.start >= this.windowMs) {
      if (this.buckets.size >= this.maxKeys) this.prune(now);
      this.buckets.set(key, { start: now, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= this.perKey;
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.start >= this.windowMs) this.buckets.delete(key);
    }
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }
}

export type ReviewLoginOutcome =
  | 'success'
  | 'bad_code'
  | 'rate_limited'
  | 'bad_origin'
  | 'mint_failed'
  | 'refused'
  | 'session_ended';

/**
 * The audit trail for this route: one structured server-log line per POST
 * attempt. No e-mail, no code, no raw IP, only a truncated salted IP hash for
 * correlation. App code never writes audit_log (CLAUDE.md rule #4); GoTrue's
 * own auth audit log additionally records the magic-link issue + login.
 */
export function logReviewLogin(outcome: ReviewLoginOutcome, clientKey: string, reason?: string): void {
  const line = JSON.stringify({
    event: 'review_login',
    outcome,
    ...(reason ? { reason } : {}),
    client: clientKey.slice(0, 12),
  });
  if (outcome === 'success') console.info(line);
  else console.warn(line);
}

export type ReviewFormError = 'code' | 'wait' | 'failed' | null;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The review sign-in form: a static HTML page (no JS, same-origin POST), so the
 * code travels in the request body and never in a URL, history or access log.
 * Colours are the design-system tokens (design-system.md).
 */
export function renderReviewForm(error: ReviewFormError): string {
  const copy = t.auth;
  const message =
    error === 'code' ? copy.reviewErrorCode : error === 'wait' ? copy.reviewErrorWait : error === 'failed' ? copy.reviewErrorFailed : null;
  const alert = message ? `<p role="alert" class="err">${escapeHtml(message)}</p>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(copy.reviewTitle)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0B0B0D; color: #F4F4F6;
    font: 16px/1.5 "Hanken Grotesk", system-ui, -apple-system, sans-serif;
    padding: env(safe-area-inset-top) 16px env(safe-area-inset-bottom); }
  main { width: 100%; max-width: 360px; }
  h1 { font-family: "Bricolage Grotesque", system-ui, sans-serif; font-size: 28px; margin: 0 0 8px; }
  p { color: #A1A1AA; margin: 0 0 24px; }
  label { display: block; font-size: 14px; margin-bottom: 8px; }
  input { box-sizing: border-box; width: 100%; min-height: 48px; padding: 12px 14px; border-radius: 12px;
    border: 1px solid #2A2A30; background: #16161A; color: inherit; font-size: 16px; }
  button { margin-top: 16px; width: 100%; min-height: 48px; border: 0; border-radius: 12px; background: #B5A6FF;
    color: #0B0B0D; font-weight: 600; font-size: 16px; }
  .err { color: #FF8A8A; margin: 0 0 16px; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(copy.reviewTitle)}</h1>
<p>${escapeHtml(copy.reviewHelp)}</p>
${alert}
<form method="post" action="/auth/review-login">
<label for="code">${escapeHtml(copy.reviewCodeLabel)}</label>
<input id="code" name="code" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="${MAX_INPUT_LENGTH}">
<button type="submit">${escapeHtml(copy.reviewSubmit)}</button>
</form>
</main>
</body>
</html>`;
}
