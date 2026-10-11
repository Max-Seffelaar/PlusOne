/**
 * Platform mail log actions (z8uq9m49k1): the reveal needs a ticket and goes
 * through the caller's session (the RPC checks is_platform_admin and writes
 * the access log); a test mail is logged as a test BEFORE it is sent, within
 * its own limit, and its result lands on that row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  userResult: { data: 'log-1' as unknown, error: null as null | { code: string } },
  userRpc: vi.fn(),
  serviceRpc: vi.fn(),
  send: vi.fn(async () => ({ ok: true as const, providerMessageId: 're_1' })),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/context', () => ({ getAuthContext: vi.fn(async () => ({ user: { id: 'u1' } })) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: (...a: unknown[]) => (H.userRpc(...a), Promise.resolve(H.userResult)) }),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ rpc: (...a: unknown[]) => (H.serviceRpc(...a), Promise.resolve({ data: 1, error: null })) }),
}));
vi.mock('@/features/mail/provider', () => ({ mailProvider: { send: H.send } }));
vi.mock('@/features/mail/config', () => ({
  teamMailActive: () => true,
  MAIL_DOMAIN: 'plus-one.io',
  MAIL_FROM: 'PlusOne <noreply@plus-one.io>',
}));

import { revealMailRecipient, sendPlatformTestMail } from './mail-log-actions';
import { recipientHash } from '@/features/mail/send';
import { t } from '@/lib/i18n';

const LOG = '00000000-0000-7000-8000-0000000000a1';

beforeEach(() => {
  H.userResult = { data: 'log-1', error: null };
  H.userRpc.mockClear();
  H.serviceRpc.mockClear();
  H.send.mockClear();
});

describe('revealMailRecipient', () => {
  it('needs a ticket reference before any RPC', async () => {
    expect((await revealMailRecipient({ mailLogId: LOG, ticket: ' ' })).ok).toBe(false);
    expect(H.userRpc).not.toHaveBeenCalled();
  });

  it('asks the database through the caller session, with the ticket', async () => {
    H.userResult = { data: 'lotte@example.com', error: null };
    expect(await revealMailRecipient({ mailLogId: LOG, ticket: 'ClickUp 86abc' })).toEqual({ ok: true, address: 'lotte@example.com' });
    expect(H.userRpc).toHaveBeenCalledWith('platform_reveal_mail_recipient', { p_mail_log_id: LOG, p_ticket: 'ClickUp 86abc' });
  });

  it('a non-platform-admin is refused by the database', async () => {
    H.userResult = { data: null, error: { code: '42501' } };
    expect((await revealMailRecipient({ mailLogId: LOG, ticket: 'ticket 1' })).ok).toBe(false);
  });
});

describe('sendPlatformTestMail', () => {
  it('logs as a test, sends the template, records the result on that row', async () => {
    expect(await sendPlatformTestMail({ type: 'guest_on_list', to: ' Max@Plus-One.io ' })).toEqual({ ok: true });
    expect(H.userRpc).toHaveBeenCalledWith('log_platform_test_mail', {
      p_type: 'guest_on_list',
      p_recipient_hash: recipientHash('max@plus-one.io'),
    });
    expect(H.send).toHaveBeenCalledTimes(1);
    const sent = (H.send.mock.calls[0] as unknown as [{ to: string; subject: string; idempotencyKey: string }])[0];
    expect(sent.to).toBe('max@plus-one.io');
    expect(sent.subject.startsWith('[Test] ')).toBe(true);
    expect(sent.idempotencyKey).toBe('mail_log/log-1');
    expect(H.serviceRpc).toHaveBeenCalledWith('record_mail_send_result', expect.objectContaining({ p_id: 'log-1', p_status: 'sent' }));
  });

  it('over the limit: nothing is sent', async () => {
    H.userResult = { data: null, error: { code: 'PM429' } };
    expect(await sendPlatformTestMail({ type: 'team_join', to: 'max@plus-one.io' })).toMatchObject({
      ok: false,
      message: t.platform.testMailLimit,
    });
    expect(H.send).not.toHaveBeenCalled();
  });

  it('refuses an unknown type or a bad address before anything', async () => {
    expect((await sendPlatformTestMail({ type: 'auth_invite', to: 'max@plus-one.io' })).ok).toBe(false);
    expect((await sendPlatformTestMail({ type: 'team_join', to: 'a@b.c>, x@y.z' })).ok).toBe(false);
    expect(H.userRpc).not.toHaveBeenCalled();
  });
});
