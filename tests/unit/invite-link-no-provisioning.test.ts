import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// PR #324 security review (S1). `scripts/invite-link.mjs` runs against PROD by
// design, with the service role. `admin.generateLink({type:'invite'})` CREATES
// the auth user when the address does not exist — the service role bypasses
// "signups disabled" — so a typo in a nazorg run would mint a real account
// outside the invite-only invariant (#20), one that can walk through
// /onboarding and create a venue. The script must therefore look the account up
// and abort BEFORE it can mint anything.
//
// The script is a top-level-await CLI that calls process.exit, so it cannot be
// imported in a unit test; this asserts the guard's presence and its ordering
// in the source. The three live states (never-confirmed → invite link,
// confirmed → magiclink, unknown → exit 1) were exercised against the local
// stack by hand and both printed links verified end to end.
const RAW = readFileSync(resolve(process.cwd(), 'scripts/invite-link.mjs'), 'utf8');
// Comments discuss both the guard and the rejected `signup` tier, so assert on
// code only — otherwise the prose about the trap would satisfy the test.
const SOURCE = RAW.split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');

describe('scripts/invite-link.mjs never provisions an account', () => {
  it('looks the account up and exits before any generateLink call', () => {
    const lookup = SOURCE.indexOf('/auth/v1/admin/users');
    const abort = SOURCE.indexOf('No account found for');
    const mint = SOURCE.indexOf('admin.generateLink(');

    expect(lookup).toBeGreaterThan(-1);
    expect(abort).toBeGreaterThan(lookup);
    expect(mint).toBeGreaterThan(abort);
  });

  it('aborts with a non-zero exit when no account exists', () => {
    const abort = SOURCE.indexOf('No account found for');
    expect(SOURCE.slice(abort, abort + 200)).toContain('process.exit(1)');
  });

  it('offers no link type that requires (or invents) a password', () => {
    // generateLink({type:'signup'}) requires a password and would only produce
    // a misleading validation error; it must not be a tier.
    expect(SOURCE).not.toMatch(/LINK_TYPES\s*=\s*\[[^\]]*'signup'/);
    expect(SOURCE).not.toMatch(/generateLink\(\{\s*type:\s*'signup'/);
  });
});
