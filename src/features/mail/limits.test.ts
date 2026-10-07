/**
 * Invitation-mail cap helpers (decision Max 2026-10-07). The number and the
 * counting live in the database (pgTAP mail_log.test.sql T7–T14); here: the
 * RPC wiring, fail-open on error, no address leaves the process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: H.rpc }) }));

import { inviteMailCapReached, recordAuthInviteMail } from './limits';
import { recipientHash } from './send';

const VENUE = '3f1c8a52-9d6b-4f2e-8a11-7c0d5e9b4a63';

beforeEach(() => H.rpc.mockReset());
afterEach(() => {
  vi.restoreAllMocks();
});

describe('inviteMailCapReached', () => {
  it('asks the database for the company', async () => {
    H.rpc.mockResolvedValue({ data: true, error: null });
    expect(await inviteMailCapReached(VENUE)).toBe(true);
    expect(H.rpc).toHaveBeenCalledWith('mail_venue_cap_reached', { p_venue_id: VENUE });
  });

  it('fails open on a database error (the send-time backstop still holds)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    H.rpc.mockResolvedValue({ data: null, error: { code: '57014' } });
    expect(await inviteMailCapReached(VENUE)).toBe(false);
  });
});

describe('recordAuthInviteMail', () => {
  it('records the hash, never the address, and never throws', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    H.rpc.mockResolvedValue({ data: null, error: { code: '08006' } });
    await expect(recordAuthInviteMail(VENUE, 'New@Example.test')).resolves.toBeUndefined();
    expect(H.rpc).toHaveBeenCalledWith('record_auth_invite_mail', {
      p_venue_id: VENUE,
      p_recipient_hash: recipientHash('new@example.test'),
    });
    expect(JSON.stringify([...H.rpc.mock.calls, ...log.mock.calls]).toLowerCase()).not.toContain('new@example.test');
  });
});
