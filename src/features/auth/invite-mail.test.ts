/**
 * sendInviteEmail branch matrix (Mail-infra F0, z8uq9m2yvt; one invite mail,
 * z8uq9m2yvp):
 *   - team/crew context + team mail active → OUR mail for every address: a
 *     new or never-confirmed one gets a one-time sign-in link (generateLink,
 *     resolved only after the send is logged), a confirmed one the /login
 *     button. GoTrue sends nothing: no inviteUserByEmail, no magic link;
 *   - platform invites (no context) → the Supabase path exactly as before;
 *   - team mail inactive (prod without a key) → the Supabase path too, so
 *     prod never regresses to "no mail".
 * The InviteMailResult contract (provision / notify / recent / cap) is the
 * same for a new and an existing address, so it never reveals an account.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamMailCta, TeamMailOptions, TeamMailResult } from '@/features/mail/send';

const H = vi.hoisted(() => ({
  inviteUserByEmail: vi.fn(),
  generateLink: vi.fn(),
  signInWithOtp: vi.fn(),
  sendTeamMail: vi.fn(),
  recordAuthInviteMail: vi.fn(),
  active: true,
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ auth: { admin: { inviteUserByEmail: H.inviteUserByEmail, generateLink: H.generateLink } } }),
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
const TOKEN_HASH = 'pkce_9f2c0d7e41b84a5f9c3e6d1a2b7f8e05';
const linkFor = (verification_type: string) => ({
  data: { properties: { hashed_token: TOKEN_HASH, verification_type, action_link: `https://x/verify?token=${TOKEN_HASH}` }, user: {} },
  error: null,
});

/** The send outcome the mocked sendTeamMail reports once its cta resolved. */
let sendOutcome: TeamMailResult = { ok: true };
/** The cta the mocked sendTeamMail resolved (what the mail's button became). */
let resolvedCta: TeamMailCta | null = null;

beforeEach(() => {
  H.active = true;
  sendOutcome = { ok: true };
  resolvedCta = null;
  H.inviteUserByEmail.mockReset().mockResolvedValue({ data: {}, error: null });
  H.generateLink.mockReset().mockResolvedValue(linkFor('invite'));
  H.signInWithOtp.mockReset().mockResolvedValue({ error: null });
  // Mirrors sendTeamMail's order: the window/cap refusals happen BEFORE the cta
  // is resolved (no token minted), the cta before the provider send.
  H.sendTeamMail.mockReset().mockImplementation(async (_mail: unknown, options: TeamMailOptions = {}) => {
    if (!sendOutcome.ok && (sendOutcome.reason === 'recipient_window' || sendOutcome.reason === 'venue_cap')) return sendOutcome;
    resolvedCta = options.cta ? await options.cta() : { kind: 'login' };
    if (resolvedCta.kind === 'unavailable') return { ok: false, reason: 'cta_unavailable' };
    return sendOutcome;
  });
  H.recordAuthInviteMail.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendInviteEmail — one invite mail (team mail active, team/crew context)', () => {
  it('a new address: generateLink provisions it, our mail carries the link, GoTrue sends nothing', async () => {
    expect(await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT, mailCapVenueId: CONTEXT.venueId })).toEqual({ ok: true });
    expect(H.generateLink).toHaveBeenCalledWith({ type: 'invite', email: 'new@example.test', options: { data: { full_name: 'new' } } });
    expect(H.sendTeamMail).toHaveBeenCalledWith({ ...CONTEXT, to: 'new@example.test' }, { cta: expect.any(Function) });
    expect(resolvedCta).toEqual({ kind: 'invite', link: { tokenHash: TOKEN_HASH, verifyType: 'invite' } });
    expect(H.inviteUserByEmail).not.toHaveBeenCalled();
    expect(H.signInWithOtp).not.toHaveBeenCalled();
    // Counted through its own mail_log row, never a second time here.
    expect(H.recordAuthInviteMail).not.toHaveBeenCalled();
  });

  it('a never-confirmed address keeps the slot GoTrue filed the token in (signup)', async () => {
    H.generateLink.mockResolvedValue(linkFor('signup'));
    await sendInviteEmail('pending@example.test', { existingAccountMail: CONTEXT });
    expect(resolvedCta).toEqual({ kind: 'invite', link: { tokenHash: TOKEN_HASH, verifyType: 'signup' } });
  });

  it('a confirmed account gets the same mail with the /login button, no magic link', async () => {
    H.generateLink.mockResolvedValue({ data: { properties: null, user: null }, error: EXISTS });
    expect(await sendInviteEmail('staff@example.test', { existingAccountMail: CONTEXT })).toEqual({ ok: true });
    expect(H.sendTeamMail).toHaveBeenCalledWith({ ...CONTEXT, to: 'staff@example.test' }, { cta: expect.any(Function) });
    expect(resolvedCta).toEqual({ kind: 'login' });
    expect(H.signInWithOtp).not.toHaveBeenCalled();
    expect(H.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['sent', { ok: true }, { ok: true }],
    ['the 60-second window', { ok: false, reason: 'recipient_window' }, { ok: false, reason: 'recent' }],
    ['the company cap at send time', { ok: false, reason: 'venue_cap' }, { ok: false, reason: 'cap' }],
    ['a failed send', { ok: false, reason: 'failed' }, { ok: false, reason: 'notify' }],
  ] as const)('%s: the same answer for a new and an existing address', async (_label, outcome, expected) => {
    sendOutcome = outcome as TeamMailResult;
    H.generateLink.mockResolvedValue(linkFor('invite'));
    expect(await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT })).toEqual(expected);
    H.generateLink.mockResolvedValue({ data: { properties: null, user: null }, error: EXISTS });
    expect(await sendInviteEmail('staff@example.test', { existingAccountMail: CONTEXT })).toEqual(expected);
  });

  it('the window and the cap refuse before any token is minted', async () => {
    for (const reason of ['recipient_window', 'venue_cap'] as const) {
      sendOutcome = { ok: false, reason };
      await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT });
    }
    expect(H.generateLink).not.toHaveBeenCalled();
  });

  it('a non-"exists" provisioning error is a provision failure and nothing is sent', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    H.generateLink.mockResolvedValue({ data: { properties: null, user: null }, error: { status: 500, code: 'unexpected_failure', message: 'db down for new@example.test' } });
    expect(await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT })).toEqual({ ok: false, reason: 'provision' });
    expect(resolvedCta).toEqual({ kind: 'unavailable' });
    expect(H.inviteUserByEmail).not.toHaveBeenCalled();
    // Codes only: a GoTrue message can echo the address.
    expect(JSON.stringify(error.mock.calls)).not.toContain('new@example.test');
  });

  it('a throwing generateLink is a provision failure too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    H.generateLink.mockRejectedValue(new TypeError('fetch failed'));
    expect(await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT })).toEqual({ ok: false, reason: 'provision' });
  });

  it('a link without a usable token or slot is never mailed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    H.generateLink.mockResolvedValue(linkFor('magiclink'));
    expect(await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT })).toEqual({ ok: false, reason: 'provision' });
  });

  it('the sign-in link never reaches a log line', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {})
    );
    await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT });
    sendOutcome = { ok: false, reason: 'failed' };
    await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT });
    const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    expect(logged).not.toContain(TOKEN_HASH);
  });
});

// The Supabase path: platform invites, and prod without a Resend key.
describe('sendInviteEmail — the Supabase path (platform invites, team mail inactive)', () => {
  it('team mail inactive: a new address is provisioned + invited by Supabase only', async () => {
    H.active = false;
    expect(await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT })).toEqual({ ok: true });
    expect(H.inviteUserByEmail).toHaveBeenCalledWith('new@example.test', { data: { full_name: 'new' } });
    expect(H.generateLink).not.toHaveBeenCalled();
    expect(H.sendTeamMail).not.toHaveBeenCalled();
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
    expect(H.generateLink).not.toHaveBeenCalled();
  });

  it('with team mail inactive (prod without a key) a confirmed account keeps the magic link', async () => {
    H.active = false;
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: EXISTS });
    expect(await sendInviteEmail('staff@example.test', { existingAccountMail: CONTEXT })).toEqual({ ok: true });
    expect(H.signInWithOtp).toHaveBeenCalledTimes(1);
    expect(H.sendTeamMail).not.toHaveBeenCalled();
  });

  it('a non-"exists" provisioning error stays a provision failure, no mail of any kind', async () => {
    H.active = false;
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
  it("GoTrue's own resend limit on the invite (429) is \"recent\", not a provisioning failure", async () => {
    H.active = false;
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
    H.signInWithOtp.mockResolvedValue({
      error: { status: 429, message: 'For security purposes, you can only request this after 41 seconds.' },
    });
    expect(await sendInviteEmail('klant@venue.test', { seedName: false })).toEqual({ ok: false, reason: 'recent' });
  });

  it("GoTrue's project-wide hourly mail cap (same 429/code, other text) is a real failure, not \"recent\" (review round 2)", async () => {
    H.active = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const hourly = { status: 429, code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' };
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: hourly });
    expect(await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT })).toEqual({ ok: false, reason: 'provision' });
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: EXISTS });
    H.signInWithOtp.mockResolvedValue({ error: hourly });
    expect(await sendInviteEmail('klant@venue.test', { seedName: false })).toEqual({ ok: false, reason: 'notify' });
  });
});

// Daily company cap (decision Max 2026-10-07): a Supabase invite mail sent for a
// company (team mail inactive) counts toward its cap; a platform invite counts
// nowhere; our own mail is logged by sendTeamMail itself.
describe('sendInviteEmail — invitation-mail cap bookkeeping', () => {
  const VENUE = '3f1c8a52-9d6b-4f2e-8a11-7c0d5e9b4a63';

  it('records a Supabase invite mail against the company', async () => {
    H.active = false;
    await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT, mailCapVenueId: VENUE });
    expect(H.recordAuthInviteMail).toHaveBeenCalledWith(VENUE, 'new@example.test');
  });

  it('a platform invite (no company) is never recorded', async () => {
    await sendInviteEmail('klant@venue.test', { seedName: false });
    expect(H.recordAuthInviteMail).not.toHaveBeenCalled();
  });

  it('our own mail (new or existing address) is not double-counted here', async () => {
    await sendInviteEmail('new@example.test', { existingAccountMail: CONTEXT, mailCapVenueId: VENUE });
    H.generateLink.mockResolvedValue({ data: { properties: null, user: null }, error: EXISTS });
    await sendInviteEmail('staff@example.test', { existingAccountMail: CONTEXT, mailCapVenueId: VENUE });
    expect(H.sendTeamMail).toHaveBeenCalledTimes(2);
    expect(H.recordAuthInviteMail).not.toHaveBeenCalled();
  });

  it('a failed provisioning call records nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    H.inviteUserByEmail.mockResolvedValue({ data: null, error: { status: 500, message: 'down' } });
    await sendInviteEmail('x@example.test', { mailCapVenueId: VENUE });
    expect(H.recordAuthInviteMail).not.toHaveBeenCalled();
  });
});
