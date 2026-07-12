import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { recommendMfaIfDue } from './guards';
import { createClient } from '@/lib/supabase/server';
import type { AuthContext } from './context';

// recommendMfaIfDue calls createClient() (Next cookies() under the hood) and,
// when due, next/navigation's redirect() — mock both so the due-logic (UX/IA
// 9/7: ask-first, not on the first session) is testable without a request context.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

const USER_ID = '00000000-0000-0000-0000-000000000001';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function makeClient(snoozeUntil: string | null) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: { mfa_snooze_until: snoozeUntil } })),
    })),
  };
}

function makeCtx(opts: {
  createdAt: string;
  requiresMfa?: boolean;
  hasVerifiedTotp?: boolean;
}): AuthContext {
  return {
    user: { id: USER_ID, created_at: opts.createdAt } as AuthContext['user'],
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

  it('young account (<24h): never redirects, even with no factor and no snooze', async () => {
    (createClient as Mock).mockResolvedValue(makeClient(null));
    const ctx = makeCtx({ createdAt: new Date(Date.now() - ONE_DAY_MS / 2).toISOString() });
    await expect(recommendMfaIfDue('/app', ctx)).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('account >24h old, no factor, no snooze: redirects to /mfa/enroll', async () => {
    (createClient as Mock).mockResolvedValue(makeClient(null));
    const ctx = makeCtx({ createdAt: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString() });
    await expect(recommendMfaIfDue('/app', ctx)).rejects.toThrow('REDIRECT:/mfa/enroll?next=%2Fapp');
  });

  it('snoozed (future timestamp): does not redirect', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient(new Date(Date.now() + ONE_DAY_MS).toISOString())
    );
    const ctx = makeCtx({ createdAt: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString() });
    await expect(recommendMfaIfDue('/app', ctx)).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('snoozed forever ("Don\'t ask again"): does not redirect', async () => {
    (createClient as Mock).mockResolvedValue(makeClient('9999-12-31T00:00:00Z'));
    const ctx = makeCtx({ createdAt: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString() });
    await expect(recommendMfaIfDue('/app', ctx)).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('verified factor present: never redirects regardless of account age', async () => {
    (createClient as Mock).mockResolvedValue(makeClient(null));
    const ctx = makeCtx({
      createdAt: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString(),
      hasVerifiedTotp: true,
    });
    await expect(recommendMfaIfDue('/app', ctx)).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('role does not require MFA: never redirects', async () => {
    (createClient as Mock).mockResolvedValue(makeClient(null));
    const ctx = makeCtx({
      createdAt: new Date(Date.now() - 2 * ONE_DAY_MS).toISOString(),
      requiresMfa: false,
    });
    await expect(recommendMfaIfDue('/app', ctx)).resolves.toBeUndefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
