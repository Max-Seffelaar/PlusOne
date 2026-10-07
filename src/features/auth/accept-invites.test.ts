/**
 * Accept and decline are EXPLICIT and PER INVITE (z8uq9m2yvp): the Home banner and
 * the onboarding invite step call accept_invite / decline_invite with one id.
 * Neither login nor these actions ever touch the accept-all or login-path RPCs.
 * A decline mails the inviter and the decliner, exactly once: only when the
 * database reports the open -> declined transition.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ rpc: vi.fn(), notify: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: H.rpc }) }));
vi.mock('@/lib/auth/context', () => ({
  getSessionUser: async () => ({ id: '55555555-5555-4555-8555-555555555555', email: 'staff@plusone.test' }),
  getMyProfile: async () => null,
}));
vi.mock('@/features/mail/declined', () => ({ notifyInviteDeclined: H.notify }));

const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const { acceptInviteAction, declineInviteAction } = await import('./invite-actions');

beforeEach(() => {
  H.rpc.mockReset();
  H.notify.mockReset();
});

describe('acceptInviteAction', () => {
  it('accepts exactly the one invite, never accept-all or the login path', async () => {
    H.rpc.mockResolvedValue({ data: true, error: null });
    expect(await acceptInviteAction(INVITE_ID)).toMatchObject({ ok: true });
    expect(H.rpc).toHaveBeenCalledTimes(1);
    expect(H.rpc).toHaveBeenCalledWith('accept_invite', { p_invite_id: INVITE_ID });
    expect(H.notify).not.toHaveBeenCalled();
  });

  it('an invite that is no longer open is a plain refusal', async () => {
    H.rpc.mockResolvedValue({ data: false, error: null });
    expect(await acceptInviteAction(INVITE_ID)).toEqual({ ok: false, error: 'This invite is no longer open.' });
  });

  it('a failed accept is a generic error', async () => {
    H.rpc.mockResolvedValue({ data: null, error: { message: 'nope', code: 'XX000' } });
    expect(await acceptInviteAction(INVITE_ID)).toEqual({ ok: false, error: "Couldn't accept the invite." });
  });

  it('a malformed id never reaches the database', async () => {
    expect(await acceptInviteAction('not-a-uuid')).toMatchObject({ ok: false });
    expect(H.rpc).not.toHaveBeenCalled();
  });
});

describe('declineInviteAction', () => {
  it('closes the one invite, then mails once', async () => {
    H.rpc.mockResolvedValue({ data: true, error: null });
    expect(await declineInviteAction(INVITE_ID)).toMatchObject({ ok: true });
    expect(H.rpc).toHaveBeenCalledWith('decline_invite', { p_invite_id: INVITE_ID });
    expect(H.notify).toHaveBeenCalledTimes(1);
    expect(H.notify).toHaveBeenCalledWith(INVITE_ID);
  });

  it('no transition (already declined, accepted, expired, not theirs): no mail', async () => {
    H.rpc.mockResolvedValue({ data: false, error: null });
    expect(await declineInviteAction(INVITE_ID)).toEqual({ ok: false, error: 'This invite is no longer open.' });
    expect(H.notify).not.toHaveBeenCalled();
  });

  it('a database error is a generic error and sends no mail', async () => {
    H.rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } });
    expect(await declineInviteAction(INVITE_ID)).toEqual({ ok: false, error: "Couldn't decline the invite. Try again." });
    expect(H.notify).not.toHaveBeenCalled();
  });

  it('a malformed id never reaches the database', async () => {
    expect(await declineInviteAction('nope')).toMatchObject({ ok: false });
    expect(H.rpc).not.toHaveBeenCalled();
  });
});
