/**
 * /mfa/enroll never shows the enrolment card to the store-review demo account
 * (86ey6bfug): a factor on the shared account locks the next reviewer out
 * (review-login refuses `mfa_enrolled`). A normal user still gets the card.
 */
import { describe, it, expect, vi } from 'vitest';

const H = vi.hoisted(() => ({ user: { id: '', email: '' } }));

class Redirect extends Error {}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock('@/lib/auth/context', () => ({
  getAuthContext: async () => ({ user: H.user, hasVerifiedTotp: false, isAal2: false }),
}));
vi.mock('@/lib/auth/consent', () => ({ requireConsent: vi.fn() }));
vi.mock('@/features/auth/components/MfaEnrollCard', () => ({ MfaEnrollCard: () => null }));

const { default: MfaEnrollPage } = await import('./page');

async function run(): Promise<unknown> {
  try {
    return await MfaEnrollPage({ searchParams: Promise.resolve({}) });
  } catch (e) {
    return e;
  }
}

describe('/mfa/enroll', () => {
  it('sends the demo account back to the app', async () => {
    H.user = { id: 'de300000-0000-7000-8000-00000000a001', email: 'app-review@demo.plus-one.io' };
    const out = await run();
    expect(out).toBeInstanceOf(Redirect);
    expect((out as Error).message).toBe('/app');
  });

  it('renders the card for a normal user', async () => {
    H.user = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@plusone.test' };
    expect(await run()).not.toBeInstanceOf(Error);
  });
});
