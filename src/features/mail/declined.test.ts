/**
 * notifyInviteDeclined (z8uq9m2yvp): reads the decline context with the service
 * role, mails the inviter (typed address, no profile name) and the decliner, both
 * with no venue, and NEVER throws: a failed read or send leaves the recorded
 * decline untouched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: H.rpc }) }));
vi.mock('./send', () => ({ sendTeamMail: H.send }));

const { notifyInviteDeclined } = await import('./declined');

const INVITE_ID = '11111111-1111-4111-8111-111111111111';
const ctx = {
  inviter_email: 'admin@club.test',
  invitee_email: 'Tom@Crew.test',
  company_name: 'Club Vesper',
  is_crew: true,
  event_name: 'Friday Late',
};

beforeEach(() => {
  H.rpc.mockReset();
  H.send.mockReset();
  H.send.mockResolvedValue({ ok: true });
});

describe('notifyInviteDeclined', () => {
  it('asks the service-role RPC for ONE invite id and sends two venue-less mails', async () => {
    H.rpc.mockResolvedValue({ data: [ctx], error: null });
    await notifyInviteDeclined(INVITE_ID);
    expect(H.rpc).toHaveBeenCalledWith('declined_invite_mail_context', { p_invite_id: INVITE_ID });
    expect(H.send).toHaveBeenCalledTimes(2);
    expect(H.send).toHaveBeenNthCalledWith(1, {
      template: 'team_invite_declined',
      to: 'admin@club.test',
      inviteeEmail: 'Tom@Crew.test',
      venueId: null,
      companyName: 'Club Vesper',
      crew: true,
      eventName: 'Friday Late',
    });
    expect(H.send).toHaveBeenNthCalledWith(2, {
      template: 'team_invite_declined_confirm',
      to: 'Tom@Crew.test',
      venueId: null,
      companyName: 'Club Vesper',
      crew: true,
      eventName: 'Friday Late',
    });
  });

  it('an inviter whose account is gone: only the confirmation goes out', async () => {
    H.rpc.mockResolvedValue({ data: [{ ...ctx, inviter_email: null }], error: null });
    await notifyInviteDeclined(INVITE_ID);
    expect(H.send).toHaveBeenCalledTimes(1);
    expect(H.send.mock.calls[0]![0]).toMatchObject({ template: 'team_invite_declined_confirm' });
  });

  it('no context (not declined / unknown id): nothing is sent', async () => {
    H.rpc.mockResolvedValue({ data: [], error: null });
    await notifyInviteDeclined(INVITE_ID);
    expect(H.send).not.toHaveBeenCalled();
  });

  it('a failed read or a throwing send never throws', async () => {
    H.rpc.mockResolvedValue({ data: null, error: { code: 'XX000' } });
    await expect(notifyInviteDeclined(INVITE_ID)).resolves.toBeUndefined();
    H.rpc.mockResolvedValue({ data: [ctx], error: null });
    H.send.mockRejectedValue(new Error('boom'));
    await expect(notifyInviteDeclined(INVITE_ID)).resolves.toBeUndefined();
  });

  it('the inviter mail is never addressed to the decliner, and carries no profile name field', async () => {
    H.rpc.mockResolvedValue({ data: [ctx], error: null });
    await notifyInviteDeclined(INVITE_ID);
    const toInviter = H.send.mock.calls[0]![0] as Record<string, unknown>;
    expect(toInviter.to).not.toBe(ctx.invitee_email);
    expect(Object.keys(toInviter).sort()).toEqual(
      ['companyName', 'crew', 'eventName', 'inviteeEmail', 'template', 'to', 'venueId'].sort()
    );
  });
});
