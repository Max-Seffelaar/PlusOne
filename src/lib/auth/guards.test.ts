import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { recommendMfaIfDue } from './guards';
import { createClient } from '@/lib/supabase/server';
import { getAuthContext, type AuthContext } from './context';

// recommendMfaIfDue calls createClient() (Next cookies() under the hood) and,
// when due, next/navigation's redirect() — mock both so the due-logic (UX/IA
// 9/7: ask-first, not on the first session) is testable without a request context.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

// The production call site (src/app/app/layout.tsx) invokes recommendMfaIfDue
// WITHOUT a ctx argument, relying on the internal `getAuthContext()` fallback —
// mock it so that codepath (not just the ctx-supplied shortcut every other
// test here uses) has coverage too.
vi.mock('./context', () => ({
  getAuthContext: vi.fn(),
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

const USER_ID = '00000000-0000-0000-0000-000000000001';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function makeClient(opts: { snoozeUntil?: string | null; acceptedAt?: string | null }) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({
        data: {
          mfa_snooze_until: opts.snoozeUntil ?? null,
          terms_accepted_at: opts.acceptedAt ?? null,
        },
      })),
    })),
  };
}

function makeCtx(opts: { requiresMfa?: boolean; hasVerifiedTotp?: boolean }): AuthContext {
  return {
    user: { id: USER_ID } as AuthContext['user'],
    currentLevel: 'aal1',
    nextLevel: 'aal1',
    isAal2: false,
    requiresMfa: opts.requiresMfa ?? true,
    hasVerifiedTotp: opts.hasVerifiedTotp ?? false,
  };
}

describe('recommendMfaIfDue', () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it('terms accepted <24h ago: never redirects, even with no factor and no snooze', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ acceptedAt: new Date(Date.now() - ONE_DAY_MS / 2).toISOString() })
    );
    await expect(recommendMfaIfDue('/app', makeCtx({}))).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('terms not yet accepted (null): never redirects (fail open)', async () => {
    (createClient as Mock).mockResolvedValue(makeClient({ acceptedAt: null }));
    await expect(recommendMfaIfDue('/app', makeCtx({}))).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('terms_accepted_at is an unparseable string (not null): never redirects (fail open)', async () => {
    // A DIFFERENT code path than the null case above: this goes through the
    // ternary's truthy branch into `new Date(garbage).getTime()` -> NaN,
    // rather than the null->NaN literal branch — pins Number.isNaN(sinceAcceptedMs)
    // against a mutant that only strips the null-check path.
    (createClient as Mock).mockResolvedValue(makeClient({ acceptedAt: 'not-a-date' }));
    await expect(recommendMfaIfDue('/app', makeCtx({}))).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('terms accepted >24h ago, no factor, no snooze: redirects to /mfa/enroll', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ acceptedAt: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString() })
    );
    await expect(recommendMfaIfDue('/app', makeCtx({}))).rejects.toThrow(
      'REDIRECT:/mfa/enroll?next=%2Fapp'
    );
  });

  it('snoozed (future timestamp): does not redirect', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({
        acceptedAt: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString(),
        snoozeUntil: new Date(Date.now() + ONE_DAY_MS).toISOString(),
      })
    );
    await expect(recommendMfaIfDue('/app', makeCtx({}))).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('snoozed forever ("Don\'t ask again"): does not redirect', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({
        acceptedAt: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString(),
        snoozeUntil: '9999-12-31T00:00:00Z',
      })
    );
    await expect(recommendMfaIfDue('/app', makeCtx({}))).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('mfa_snooze_until literal "infinity": does not redirect', async () => {
    // Distinct from the far-future-timestamp case above — pins the explicit
    // raw === 'infinity' branch, which the e2e smoke actually writes
    // (tests/e2e/core-flow.spec.ts).
    (createClient as Mock).mockResolvedValue(
      makeClient({
        acceptedAt: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString(),
        snoozeUntil: 'infinity',
      })
    );
    await expect(recommendMfaIfDue('/app', makeCtx({}))).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('verified factor present: never redirects regardless of acceptance age', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ acceptedAt: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString() })
    );
    await expect(
      recommendMfaIfDue('/app', makeCtx({ hasVerifiedTotp: true }))
    ).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('role does not require MFA: never redirects', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ acceptedAt: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString() })
    );
    await expect(recommendMfaIfDue('/app', makeCtx({ requiresMfa: false }))).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('no ctx supplied (production codepath, src/app/app/layout.tsx): falls back to getAuthContext()', async () => {
    (getAuthContext as Mock).mockResolvedValue(
      makeCtx({ requiresMfa: true, hasVerifiedTotp: false })
    );
    (createClient as Mock).mockResolvedValue(
      makeClient({ acceptedAt: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString() })
    );
    await expect(recommendMfaIfDue('/app')).rejects.toThrow('REDIRECT:/mfa/enroll?next=%2Fapp');
    expect(getAuthContext).toHaveBeenCalled();
  });
});
