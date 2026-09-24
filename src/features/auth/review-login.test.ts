import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AttemptLimiter,
  DEMO_REVIEW_EMAIL,
  DEMO_VENUE_NAME,
  MIN_CODE_LENGTH,
  configuredReviewCode,
  renderReviewForm,
  reviewClientKey,
  reviewCodeMatches,
} from './review-login';

const CODE = 'k7p2-x9qm-4hzt-8wva';

describe('configuredReviewCode — unset and weak codes read as "route does not exist"', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['whitespace', '   \t\n '],
    ['too short', 'a'.repeat(MIN_CODE_LENGTH - 1)],
  ])('%s → null', (_label, value) => {
    expect(configuredReviewCode({ REVIEW_LOGIN_CODE: value })).toBeNull();
  });

  it('a long enough code is returned trimmed', () => {
    expect(configuredReviewCode({ REVIEW_LOGIN_CODE: `  ${CODE}\n` })).toBe(CODE);
  });

  it('short padding cannot lift a short code over the minimum', () => {
    const short = 'x'.repeat(MIN_CODE_LENGTH - 2);
    expect(configuredReviewCode({ REVIEW_LOGIN_CODE: `   ${short}   ` })).toBeNull();
  });
});

describe('reviewCodeMatches', () => {
  it('accepts the exact code, tolerating surrounding whitespace from a paste', () => {
    expect(reviewCodeMatches(CODE, CODE)).toBe(true);
    expect(reviewCodeMatches(` ${CODE} `, CODE)).toBe(true);
  });

  it.each([
    ['wrong code', 'k7p2-x9qm-4hzt-8wvb'],
    ['prefix', CODE.slice(0, -1)],
    ['case changed', CODE.toUpperCase()],
    ['empty', ''],
    ['huge', 'a'.repeat(10_000)],
  ])('refuses %s', (_label, submitted) => {
    expect(reviewCodeMatches(submitted, CODE)).toBe(false);
  });

  it('refuses non-strings (missing form field)', () => {
    expect(reviewCodeMatches(null, CODE)).toBe(false);
    expect(reviewCodeMatches(undefined, CODE)).toBe(false);
    expect(reviewCodeMatches(42, CODE)).toBe(false);
  });
});

describe('AttemptLimiter (per instance)', () => {
  it('allows perKey attempts per window, then refuses until the window rolls', () => {
    const limiter = new AttemptLimiter(3, 100, 1000);
    expect([1, 2, 3].map(() => limiter.consume('a', 0))).toEqual([true, true, true]);
    expect(limiter.consume('a', 10)).toBe(false);
    expect(limiter.consume('b', 10)).toBe(true); // another client is unaffected
    expect(limiter.consume('a', 1000)).toBe(true); // new window
  });

  it('enforces the instance-wide cap across clients', () => {
    const limiter = new AttemptLimiter(10, 2, 1000);
    expect(limiter.consume('a', 0)).toBe(true);
    expect(limiter.consume('b', 0)).toBe(true);
    expect(limiter.consume('c', 0)).toBe(false);
  });

  it('stays bounded under a spray of distinct clients', () => {
    const limiter = new AttemptLimiter(1, 1_000_000, 1000, 50);
    for (let i = 0; i < 500; i += 1) limiter.consume(`ip-${i}`, 0);
    const size = (limiter as unknown as { buckets: Map<string, unknown> }).buckets.size;
    expect(size).toBeLessThanOrEqual(50);
  });
});

describe('reviewClientKey', () => {
  it('hashes the first forwarded IP and never contains it', () => {
    const key = reviewClientKey(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('203.0.113.7');
    expect(key).toBe(reviewClientKey(new Headers({ 'x-forwarded-for': '203.0.113.7' })));
    expect(key).not.toBe(reviewClientKey(new Headers({ 'x-forwarded-for': '203.0.113.8' })));
  });
});

describe('renderReviewForm', () => {
  it('posts the code in the body to the route itself, never via GET', () => {
    const html = renderReviewForm(null);
    expect(html).toContain('<form method="post" action="/auth/review-login">');
    expect(html).toContain('name="code"');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toMatch(/<script/i);
  });

  it('shows the generic error for a failed attempt', () => {
    expect(renderReviewForm('code')).toContain('role="alert"');
  });
});

describe('demo constants mirrored in scripts/seed-demo-venue.mjs', () => {
  const script = readFileSync(path.resolve(process.cwd(), 'scripts/seed-demo-venue.mjs'), 'utf8');

  it('uses the same demo e-mail and venue name as the route', () => {
    expect(script).toContain(`const DEMO_REVIEW_EMAIL = '${DEMO_REVIEW_EMAIL}';`);
    expect(script).toContain(`const DEMO_VENUE_NAME = '${DEMO_VENUE_NAME}';`);
  });

  it('never makes the demo user a platform admin and never runs in CI', () => {
    expect(script).not.toMatch(/is_platform_admin\s*:\s*true/);
    expect(script).not.toContain('set_platform_admin(');
    expect(script).toContain('process.env.CI');
  });

  it('refuses a non-local target without --prod', () => {
    expect(script).toContain("process.argv.includes('--prod')");
  });
});
