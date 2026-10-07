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
  recordAuthInviteMail: vi.fn(),
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
vi.mock('@/features/mail/limits', () => ({ recordAuthInviteMail: H.recordAuthInviteMail }));

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
  H.recordAuthInviteMail.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

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

// The 60-second per-address window and the send-time cap get their own
// reasons (z8uq9m2yvp, decision Max 2026-10-07), so the actions can say which.
describe('sendInviteEmail — recent and cap', () => {
  it('our per-recipient window on the team mail is "recent"', async () => {
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: EXISTS });
    H.sendTeamMail.mockResolvedValue({ ok: false, reason: 'recipient_window' });
    expect(await sendInviteEmail('staff@example.test', { existingAccountMail: CONTEXT })).toEqual({ ok: false, reason: 'recent' });
  });

  it('the company cap hit at send time is "cap"', async () => {
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: EXISTS });
    H.sendTeamMail.mockResolvedValue({ ok: false, reason: 'venue_cap' });
    expect(await sendInviteEmail('staff@example.test', { existingAccountMail: CONTEXT })).toEqual({ ok: false, reason: 'cap' });
  });

  it("GoTrue's own resend limit on the invite (429) is \"recent\", not a provisioning failure", async () => {
    H.inviteUserByEmail.mockResolvedValue({
      data: null,
      error: { status: 429, code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 52 seconds.' },
    });
    expect(await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT, mailCapVenueId: CONTEXT.venueId })).toEqual({
      ok: false,
      reason: 'recent',
    });
    expect(H.recordAuthInviteMail).not.toHaveBeenCalled();
  });

  it('the same limit on the magic-link fallback is "recent" too', async () => {
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: EXISTS });
    H.signInWithOtp.mockResolvedValue({ error: { status: 429, message: 'rate limited' } });
    expect(await sendInviteEmail('klant@venue.test', { seedName: false })).toEqual({ ok: false, reason: 'recent' });
  });
});

// Daily company cap (decision Max 2026-10-07): a Supabase invite mail sent for a
// company counts toward its cap; a platform invite counts nowhere; the team
// mail for an existing account is logged by sendTeamMail itself.
describe('sendInviteEmail — invitation-mail cap bookkeeping', () => {
  const VENUE = '3f1c8a52-9d6b-4f2e-8a11-7c0d5e9b4a63';

  it('records a Supabase invite mail against the company', async () => {
    await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT, mailCapVenueId: VENUE });
    expect(H.recordAuthInviteMail).toHaveBeenCalledWith(VENUE, 'new@example.test');
  });

  it('a platform invite (no company) is never recorded', async () => {
    await sendInviteEmail('klant@venue.test', { seedName: false });
    expect(H.recordAuthInviteMail).not.toHaveBeenCalled();
  });

  it('the existing-account team mail is not double-counted here', async () => {
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: EXISTS });
    await sendInviteEmail('staff@example.test', { existingAccountMail: CONTEXT, mailCapVenueId: VENUE });
    expect(H.sendTeamMail).toHaveBeenCalledTimes(1);
    expect(H.recordAuthInviteMail).not.toHaveBeenCalled();
  });

  it('a failed provisioning call records nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: { status: 500, message: 'down' } });
    await sendInviteEmail('x@example.test', { mailCapVenueId: VENUE });
    expect(H.recordAuthInviteMail).not.toHaveBeenCalled();
  });
});
