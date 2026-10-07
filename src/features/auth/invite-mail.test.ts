/**
 * sendInviteEmail branch matrix (Mail-infra F0, z8uq9m2yvt):
 *   - new / unconfirmed address → inviteUserByEmail only (Supabase template);
 *   - confirmed address + team context + team mail active → Resend team mail,
 *     NO magic link;
 *   - confirmed address without context (platform invites) → magic link,
 *     exactly as before;
 *   - confirmed address with context but team mail inactive (prod without a
 *     key) → magic link, so prod never regresses.
 * The InviteMailResult contract (provision / notify) is unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  inviteUserByEmail: vi.fn(),
  signInWithOtp: vi.fn(),
  sendTeamMail: vi.fn(),
  active: true,
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ auth: { admin: { inviteUserByEmail: H.inviteUserByEmail } } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signInWithOtp: H.signInWithOtp } }),
}));
vi.mock('@/lib/env', () => ({ requiredServerEnv: (n: string) => `env:${n}` }));
vi.mock('@/features/mail/config', () => ({ teamMailActive: () => H.active }));
vi.mock('@/features/mail/send', () => ({ sendTeamMail: H.sendTeamMail }));

import { sendInviteEmail } from './invite-mail';
import type { TeamMailContent } from '@/features/mail/templates';

const EXISTS = { code: 'email_exists', status: 422, message: 'A user with this email address has already been registered' };
const CONTEXT: TeamMailContent = {
  template: 'team_join',
  venueId: '3f1c8a52-9d6b-4f2e-8a11-7c0d5e9b4a63',
  inviterName: 'Max',
  companyName: 'Club Vesper',
};

beforeEach(() => {
  H.active = true;
  H.inviteUserByEmail.mockReset().mockResolvedValue({ data: {}, error: null });
  H.signInWithOtp.mockReset().mockResolvedValue({ error: null });
  H.sendTeamMail.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => vi.restoreAllMocks());

describe('sendInviteEmail', () => {
  it('a new address is provisioned + invited by Supabase only', async () => {
    expect(await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT })).toEqual({ ok: true });
    expect(H.inviteUserByEmail).toHaveBeenCalledWith('new@example.test', { data: { full_name: 'new' } });
    expect(H.sendTeamMail).not.toHaveBeenCalled();
    expect(H.signInWithOtp).not.toHaveBeenCalled();
  });

  it('a confirmed account with team context gets the team mail instead of a magic link', async () => {
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: EXISTS });
    expect(await sendInviteEmail('staff@example.test', { existingAccountMail: CONTEXT })).toEqual({ ok: true });
    expect(H.sendTeamMail).toHaveBeenCalledWith({ ...CONTEXT, to: 'staff@example.test' });
    expect(H.signInWithOtp).not.toHaveBeenCalled();
  });

  it('a failed team mail is a notify failure (never provision), and does not fall back', async () => {
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: EXISTS });
    H.sendTeamMail.mockResolvedValue({ ok: false, reason: 'failed' });
    expect(await sendInviteEmail('staff@example.test', { existingAccountMail: CONTEXT })).toEqual({
      ok: false,
      reason: 'notify',
    });
    expect(H.signInWithOtp).not.toHaveBeenCalled();
  });

  it('platform invites (seedName:false, no context) keep the magic link exactly as before', async () => {
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: EXISTS });
    expect(await sendInviteEmail('klant@venue.test', { seedName: false })).toEqual({ ok: true });
    expect(H.inviteUserByEmail).toHaveBeenCalledWith('klant@venue.test', undefined);
    expect(H.signInWithOtp).toHaveBeenCalledWith({
      email: 'klant@venue.test',
      options: { shouldCreateUser: false },
    });
    expect(H.sendTeamMail).not.toHaveBeenCalled();
  });

  it('with team mail inactive (prod without a key) a confirmed account keeps the magic link', async () => {
    H.active = false;
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: EXISTS });
    expect(await sendInviteEmail('staff@example.test', { existingAccountMail: CONTEXT })).toEqual({ ok: true });
    expect(H.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(H.sendTeamMail).not.toHaveBeenCalled();
  });

  it('a non-"exists" provisioning error stays a provision failure, no mail of any kind', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: { status: 500, message: 'smtp down' } });
    expect(await sendInviteEmail('x@example.test', { existingAccountMail: CONTEXT })).toEqual({
      ok: false,
      reason: 'provision',
    });
    expect(H.sendTeamMail).not.toHaveBeenCalled();
    expect(H.signInWithOtp).not.toHaveBeenCalled();
  });
});
