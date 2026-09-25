import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AttemptLimiter, renderReviewForm, reviewClientKey, reviewCodeMatches } from './review-login';
import { DEMO_REVIEW_EMAIL, DEMO_ROLES, DEMO_USER_ID, DEMO_VENUE_ID, DEMO_VENUE_NAME } from './review-window';

const CODE = 'k7p2-x9qm-4hzt-8wva-3bcd-efgh-jk';

describe('reviewCodeMatches', () => {
  it('accepts the exact code, tolerating surrounding whitespace from a paste', () => {
    expect(reviewCodeMatches(CODE, CODE)).toBe(true);
    expect(reviewCodeMatches(` ${CODE} `, CODE)).toBe(true);
  });

  it.each([
    ['wrong code', 'k7p2-x9qm-4hzt-8wva-3bcd-efgh-jm'],
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

describe('AttemptLimiter (per client, no global cap)', () => {
  it('allows perKey attempts per window, then refuses until the window rolls', () => {
    const limiter = new AttemptLimiter(3, 1000);
    expect([1, 2, 3].map(() => limiter.consume('a', 0))).toEqual([true, true, true]);
    expect(limiter.consume('a', 10)).toBe(false);
    expect(limiter.consume('b', 10)).toBe(true); // another client is unaffected
    expect(limiter.consume('a', 1000)).toBe(true); // new window
  });

  it('a spray from many clients can never exhaust a fresh client (no lockout)', () => {
    const limiter = new AttemptLimiter(5, 1000);
    for (let i = 0; i < 10_000; i += 1) limiter.consume(`attacker-${i % 500}`, 0);
    expect(limiter.consume('reviewer', 0)).toBe(true);
  });

  it('stays bounded under a spray of distinct clients', () => {
    const limiter = new AttemptLimiter(1, 1000, 50);
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
  // Normalised once so every slice below holds on a CRLF (Windows) checkout too.
  const script = readFileSync(path.resolve(process.cwd(), 'scripts/seed-demo-venue.mjs'), 'utf8').replace(/\r\n/g, '\n');

  it('uses the same demo e-mail, user id, venue id, venue name and roles as the route', () => {
    expect(script).toContain(`const DEMO_ROLES = [${DEMO_ROLES.map((r) => `'${r}'`).join(', ')}];`);
    expect(script).toMatch(/roles: DEMO_ROLES,/);
    expect(script).toContain(`const DEMO_REVIEW_EMAIL = '${DEMO_REVIEW_EMAIL}';`);
    expect(script).toContain(`const DEMO_USER_ID = '${DEMO_USER_ID}';`);
    expect(script).toMatch(/createUser\(\{\s*id: DEMO_USER_ID,/);
    expect(script).toContain(`const VENUE_ID = '${DEMO_VENUE_ID}';`);
    expect(script).toContain(`const DEMO_VENUE_NAME = '${DEMO_VENUE_NAME}';`);
  });

  it('--end-review revokes every demo session (scope global) and seeds nothing', () => {
    const block = script.slice(script.indexOf('if (END_REVIEW) {'), script.indexOf('process.exit(0);\n}', script.indexOf('if (END_REVIEW) {')));
    expect(block).toContain("signOut({ scope: 'global' })");
    expect(block).not.toMatch(/insertMissing|upsert|update\(|delete\(/);
    // Runs before the user can be created or anything seeded.
    expect(script.indexOf('if (END_REVIEW) {')).toBeLessThan(script.indexOf("'createUser'"));
  });

  it('keeps the demo events off the public landing page', () => {
    expect(script).not.toMatch(/landing_active:\s*true/);
    expect(script).toMatch(/update\(\{ \.\.\.window, landing_active: false \}\)/);
  });

  it('never makes the demo user a platform admin and never runs in CI', () => {
    expect(script).not.toMatch(/is_platform_admin\s*:\s*true/);
    expect(script).not.toContain('set_platform_admin(');
    expect(script).toContain('process.env.CI');
  });

  it('snoozes the MFA nudge for good and checks venue isolation', () => {
    expect(script).toContain("mfa_snooze_until: 'infinity'");
    expect(script).toContain('--reset-members');
    expect(script).toContain("from('invites')");
  });

  it('lists venues a stray member created, and never deletes them', () => {
    expect(script).toContain("'settings->onboarding->>created_by'");
    expect(script).not.toMatch(/from\('venues'\)\s*\.delete\(/);
  });

  it('audit tripwire also catches demo-actor rows with no venue (NULL is never <> anything)', () => {
    const block = script.slice(script.indexOf("'audit tripwire'"), script.indexOf('if (foreignAudit.length > 0)'));
    expect(block).toContain(".eq('actor_id', DEMO_USER_ID)");
    expect(block).toContain('.or(`venue_id.is.null,venue_id.neq.${VENUE_ID}`)');
    expect(block).not.toContain(".neq('venue_id'");
  });

  it('re-asserts settings.onboarding.completed = true on the demo venue on every run, keeping the other keys', () => {
    // The demo admin can PATCH the flag back to false; the wizard's steps are
    // venue creation and invites, both refused for it (86ey6bfug).
    const block = script.slice(script.indexOf("'venue read'"), script.indexOf("'subscription read'"));
    expect(block).toContain("select('name, settings')");
    expect(block).toContain('if (onboarding.completed !== true)');
    expect(block).toMatch(/settings: \{ \.\.\.settings, onboarding: \{ \.\.\.onboarding, completed: true/);
    expect(block).toContain(".eq('id', VENUE_ID)");
    // Not only on first insert: the check sits outside insertMissing.
    expect(script.indexOf('if (onboarding.completed !== true)')).toBeGreaterThan(script.indexOf("insertMissing('venues'"));
  });

  it('stops when the demo user is crew on any event (defence in depth for the round-10 trigger)', () => {
    const block = script.slice(script.indexOf("'crew seats read'"), script.indexOf('// Tripwire: anything'));
    expect(block).toContain(".from('event_organizers').select('event_id').eq('user_id', userId)");
    expect(block).toMatch(/if \(crewSeats\.length > 0\) \{\s*fail\(/);
  });

  it('refuses a non-local target without --prod', () => {
    expect(script).toContain("process.argv.includes('--prod')");
  });
});
