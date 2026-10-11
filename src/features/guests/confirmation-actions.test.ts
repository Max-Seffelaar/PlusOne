/**
 * Resend confirmation (z8uq9m49k1): the caller's own session decides whether
 * they may edit the guest (can_edit_guest) BEFORE the service client queues
 * anything; the database's refusals come back as clear messages.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  probe: { data: true as unknown, error: null as null | { code: string } },
  resend: { data: 'q1' as unknown, error: null as null | { code: string } },
  userRpc: vi.fn(),
  serviceRpc: vi.fn(),
  drain: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({ getAuthContext: vi.fn(async () => ({ user: { id: 'u1' } })) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: (...a: unknown[]) => (H.userRpc(...a), Promise.resolve(H.probe)) }),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ rpc: (...a: unknown[]) => (H.serviceRpc(...a), Promise.resolve(H.resend)) }),
}));
vi.mock('@/features/mail/guest-queue', () => ({ drainQueuedGuestMails: () => H.drain() }));
vi.mock('@/features/mail/config', () => ({ guestMailActive: () => true }));

import { resendGuestConfirmation } from './confirmation-actions';
import { t } from '@/lib/i18n';

const GUEST = '00000000-0000-7000-8000-0000000000a1';

beforeEach(() => {
  H.probe = { data: true, error: null };
  H.resend = { data: 'q1', error: null };
  H.userRpc.mockClear();
  H.serviceRpc.mockClear();
  H.drain.mockClear();
});

describe('resendGuestConfirmation', () => {
  it('checks edit rights through the caller session, then queues and drains', async () => {
    expect(await resendGuestConfirmation({ guestId: GUEST })).toEqual({ ok: true });
    expect(H.userRpc).toHaveBeenCalledWith('can_edit_guest', { p_guest_id: GUEST });
    expect(H.serviceRpc).toHaveBeenCalledWith('resend_guest_confirmation', { p_guest_id: GUEST, p_actor: 'u1' });
    expect(H.drain).toHaveBeenCalled();
  });

  it('someone who may not edit the guest queues nothing', async () => {
    H.probe = { data: false, error: null };
    const res = await resendGuestConfirmation({ guestId: GUEST });
    expect(res).toMatchObject({ ok: false, message: t.guests.mail.errNoRights });
    expect(H.serviceRpc).not.toHaveBeenCalled();
  });

  it('a bounced address unchanged: the database refusal, in words', async () => {
    H.resend = { data: null, error: { code: 'PMB01' } };
    expect(await resendGuestConfirmation({ guestId: GUEST })).toMatchObject({ ok: false, code: 'PMB01', message: t.guests.mail.errBounced });
    expect(H.drain).not.toHaveBeenCalled();
  });

  it('nothing to resend (delivered, opted out): says so', async () => {
    H.resend = { data: null, error: { code: '22023' } };
    expect(await resendGuestConfirmation({ guestId: GUEST })).toMatchObject({ ok: false, message: t.guests.mail.errNothing });
  });

  it('refuses a malformed id before any RPC', async () => {
    expect((await resendGuestConfirmation({ guestId: 'x' })).ok).toBe(false);
    expect(H.userRpc).not.toHaveBeenCalled();
  });
});
