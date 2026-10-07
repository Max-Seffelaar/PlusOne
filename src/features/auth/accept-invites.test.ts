/**
 * The banner's accept is the EXPLICIT accept (z8uq9m2yvp): accept_my_invites,
 * which includes crew invites. The login path (accept_pending_invites) leaves an
 * existing account's crew invites open for exactly this tap.
 */
import { describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: H.rpc }) }));
vi.mock('@/lib/auth/context', () => ({
  getSessionUser: async () => ({ id: '55555555-5555-4555-8555-555555555555', email: 'staff@plusone.test' }),
  getMyProfile: async () => null,
}));

const { acceptInvitesAction } = await import('./invite-actions');

describe('acceptInvitesAction', () => {
  it('calls accept_my_invites (crew included), not the login path', async () => {
    H.rpc.mockResolvedValue({ data: 1, error: null });
    expect(await acceptInvitesAction()).toMatchObject({ ok: true });
    expect(H.rpc).toHaveBeenCalledWith('accept_my_invites');
    expect(H.rpc).not.toHaveBeenCalledWith('accept_pending_invites');
  });

  it('a failed accept is a generic error', async () => {
    H.rpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
    expect(await acceptInvitesAction()).toEqual({ ok: false, error: "Couldn't accept the invite." });
  });
});
