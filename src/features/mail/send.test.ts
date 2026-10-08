/**
 * Team mail sender (Mail-infra F0): best effort (never throws), one mail_log
 * row per send, Idempotency-Key = the row id, a provider failure settles the
 * row as failed exactly once (no retry), and no address reaches the DB or logs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  active: true,
  rpc: vi.fn(),
  send: vi.fn(),
}));

vi.mock('./config', () => ({ teamMailActive: () => H.active, mailConfig: {}, MAIL_FROM: 'x' }));
vi.mock('./provider', () => ({ mailProvider: { send: H.send } }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: H.rpc }) }));

import { recipientHash, sendTeamMail, type TeamMail } from './send';

const LOG_ID = '0192f0aa-0000-7000-8000-000000000001';
const MAIL: TeamMail = {
  template: 'team_join',
  venueId: '3f1c8a52-9d6b-4f2e-8a11-7c0d5e9b4a63',
  inviterName: 'Max',
  companyName: 'Club Vesper',
  to: 'Crew@Example.test',
};

beforeEach(() => {
  H.active = true;
  H.rpc.mockReset();
  H.send.mockReset();
  H.rpc.mockImplementation(async (fn: string) =>
    fn === 'log_mail_attempt' ? { data: LOG_ID, error: null } : { data: true, error: null }
  );
  H.send.mockResolvedValue({ ok: true, providerMessageId: 're_1' });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendTeamMail', () => {
  it('logs a hashed recipient, sends with the row id as Idempotency-Key, settles as sent', async () => {
    expect(await sendTeamMail(MAIL)).toEqual({ ok: true });
    expect(H.rpc).toHaveBeenNthCalledWith(1, 'log_mail_attempt', {
      p_type: 'team_join',
      p_venue_id: MAIL.venueId,
      p_recipient_hash: recipientHash('crew@example.test'),
    });
    expect(H.send).toHaveBeenCalledTimes(1);
    expect(H.send.mock.calls[0][0]).toMatchObject({
      to: 'Crew@Example.test',
      idempotencyKey: `mail_log/${LOG_ID}`,
      type: 'team_join',
      subject: 'Max invited you to join Club Vesper',
    });
    expect(H.rpc).toHaveBeenNthCalledWith(2, 'record_mail_send_result', {
      p_id: LOG_ID,
      p_status: 'sent',
      p_provider_message_id: 're_1',
      p_error_code: undefined,
    });
    // Nothing that reaches the DB carries the address.
    expect(JSON.stringify(H.rpc.mock.calls).toLowerCase()).not.toContain('crew@example.test');
  });

  it('hashes case- and whitespace-insensitively to a 64-char hex', () => {
    expect(recipientHash(' Crew@Example.TEST ')).toBe(recipientHash('crew@example.test'));
    expect(recipientHash('a@b.c')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a daily-quota 429 settles the row failed once and does not retry', async () => {
    H.send.mockResolvedValue({ ok: false, errorCode: 'daily_quota_exceeded' });
    expect(await sendTeamMail(MAIL)).toEqual({ ok: false, reason: 'failed' });
    expect(H.send).toHaveBeenCalledTimes(1);
    expect(H.rpc).toHaveBeenLastCalledWith('record_mail_send_result', {
      p_id: LOG_ID,
      p_status: 'failed',
      p_provider_message_id: undefined,
      p_error_code: 'daily_quota_exceeded',
    });
  });

  it('does not send when the attempt cannot be logged', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    H.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    expect(await sendTeamMail(MAIL)).toEqual({ ok: false, reason: 'failed' });
    expect(H.send).not.toHaveBeenCalled();
  });

  it('a throttled attempt (PM429, review of PR #413) sends nothing and says which limit (z8uq9m2yvp)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    H.rpc.mockResolvedValue({ data: null, error: { code: 'PM429', message: 'mail throttled: venue daily cap' } });
    expect(await sendTeamMail(MAIL)).toEqual({ ok: false, reason: 'venue_cap' });
    H.rpc.mockResolvedValue({ data: null, error: { code: 'PM429', message: 'something else' } });
    expect(await sendTeamMail(MAIL)).toEqual({ ok: false, reason: 'failed' });
    H.rpc.mockResolvedValue({ data: null, error: { code: 'PM429', message: 'mail throttled: recipient' } });
    expect(await sendTeamMail(MAIL)).toEqual({ ok: false, reason: 'recipient_window' });
    expect(H.send).not.toHaveBeenCalled();
    expect(H.rpc).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith('sendTeamMail: throttled', { type: 'team_join' });
  });

  it('never throws, and logs no address, when something unexpected blows up', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    H.send.mockRejectedValue(new Error('boom crew@example.test'));
    expect(await sendTeamMail(MAIL)).toEqual({ ok: false, reason: 'failed' });
    expect(JSON.stringify(log.mock.calls).toLowerCase()).not.toContain('crew@example.test');
  });

  it('a failed settle still reports the send result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    H.rpc.mockImplementation(async (fn: string) =>
      fn === 'log_mail_attempt' ? { data: LOG_ID, error: null } : { data: null, error: { code: '08006' } }
    );
    expect(await sendTeamMail(MAIL)).toEqual({ ok: true });
  });

  it('does nothing at all when team mail is inactive (prod without a key)', async () => {
    H.active = false;
    expect(await sendTeamMail(MAIL)).toEqual({ ok: false, reason: 'inactive' });
    expect(H.rpc).not.toHaveBeenCalled();
    expect(H.send).not.toHaveBeenCalled();
  });
});

// One invite mail (z8uq9m2yvp): the button's target is resolved only after the
// send is logged, so a refused send never mints a sign-in token, and the
// one-time link exists in the rendered mail and nowhere else.
describe('sendTeamMail — the cta (one invite mail)', () => {
  const TOKEN_HASH = 'pkce_51a0e8c3d27f4b96a1e5c0d9f3b72a64';
  const invite = async () => ({ kind: 'invite' as const, link: { tokenHash: TOKEN_HASH, verifyType: 'invite' as const } });

  it('a throttled send never resolves the cta (no token minted)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cta = vi.fn(invite);
    H.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PM429', message: 'mail throttled: recipient' } });
    expect(await sendTeamMail(MAIL, { cta })).toEqual({ ok: false, reason: 'recipient_window' });
    expect(cta).not.toHaveBeenCalled();
    expect(H.send).not.toHaveBeenCalled();
  });

  it('an invite link becomes the button (our /auth/confirm route) and is in the mail only', async () => {
    const logs = (['log', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    expect(await sendTeamMail(MAIL, { cta: invite })).toEqual({ ok: true });
    const sent = H.send.mock.calls[0][0] as { html: string; text: string };
    expect(sent.text).toContain(`/auth/confirm?token_hash=${TOKEN_HASH}&type=invite&next=%2Fapp`);
    expect(sent.html).toContain(`/auth/confirm?token_hash=${TOKEN_HASH}&amp;type=invite&amp;next=%2Fapp`);
    expect(sent.text).not.toMatch(/\/login\b/);
    expect(JSON.stringify(H.rpc.mock.calls)).not.toContain(TOKEN_HASH);
    expect(JSON.stringify(logs.flatMap((s) => s.mock.calls))).not.toContain(TOKEN_HASH);
  });

  it('cta login (an account that can log in) keeps the /login button', async () => {
    await sendTeamMail(MAIL, { cta: async () => ({ kind: 'login' }) });
    const sent = H.send.mock.calls[0][0] as { text: string };
    expect(sent.text).toContain('/login');
    expect(sent.text).not.toContain('/auth/confirm');
  });

  it('cta unavailable sends nothing and settles the logged row as failed', async () => {
    expect(await sendTeamMail(MAIL, { cta: async () => ({ kind: 'unavailable' }) })).toEqual({
      ok: false,
      reason: 'cta_unavailable',
    });
    expect(H.send).not.toHaveBeenCalled();
    expect(H.rpc).toHaveBeenLastCalledWith('record_mail_send_result', {
      p_id: LOG_ID,
      p_status: 'failed',
      p_provider_message_id: undefined,
      p_error_code: 'provision_failed',
    });
  });
});
