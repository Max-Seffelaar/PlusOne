import { beforeEach, describe, expect, it, vi } from 'vitest';

// updateEmailAction must refuse the shared store-review demo account (86ey6bfug),
// independent of the "Secure email change" project setting: a rebound address
// would give its owner a normal OTP login that outlives every review window.
const getSessionUser = vi.fn();
const updateUser = vi.fn();
vi.mock('@/lib/auth/context', () => ({ getSessionUser: () => getSessionUser() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { updateUser } }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const DEMO = { id: 'de300000-0000-7000-8000-00000000a001', email: 'app-review@demo.plus-one.io' };

function formWith(email: string): FormData {
  const f = new FormData();
  f.set('email', email);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  updateUser.mockResolvedValue({ error: null });
});

describe('updateEmailAction — demo account', () => {
  it.each([
    ['by id and e-mail', DEMO],
    ['by id alone (e-mail already differs)', { ...DEMO, email: 'x@venue.com' }],
    ['by e-mail alone', { id: 'other', email: DEMO.email }],
  ])('refuses the demo account %s, without calling GoTrue', async (_label, user) => {
    getSessionUser.mockResolvedValue(user);
    const { updateEmailAction } = await import('./profile-actions');
    const res = await updateEmailAction({ ok: false }, formWith('attacker@example.com'));
    expect(res).toEqual({ ok: false, error: "The demo account's email can't be changed." });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('a normal user can still change their e-mail', async () => {
    getSessionUser.mockResolvedValue({ id: 'u1', email: 'old@venue.com' });
    const { updateEmailAction } = await import('./profile-actions');
    const res = await updateEmailAction({ ok: false }, formWith('new@venue.com'));
    expect(res.ok).toBe(true);
    expect(updateUser).toHaveBeenCalledWith({ email: 'new@venue.com' });
  });
});
