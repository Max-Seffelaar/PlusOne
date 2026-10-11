// Requests E (z8uq9m2vga): the decide action sends one decision to the RPC and
// queues exactly ONE decision mail for a first decision, none for a replay.
// The RPC is the boundary for the arithmetic and the role (pgTAP
// guest_requests_decide_split); this file pins the action's own contract:
// the payload shape, the mail per outcome, and the refusals before the RPC.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { decideGuestRequest, submitGuestRequest } from './actions';
import type { DecideGuestRequestInput } from './schemas';
import { createClient } from '@/lib/supabase/server';
import { drainQueuedGuestMails, queueGuestMails, queueRequestDeclinedMail } from '@/features/mail/guest-queue';
import { headers } from 'next/headers';
import { verifyTurnstileToken } from './turnstile';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('./turnstile', () => ({ verifyTurnstileToken: vi.fn() }));
vi.mock('./ip-hash', () => ({
  landingClientIpHash: vi.fn(async () => 'hashed-ip'),
  landingClientIpForVerify: vi.fn(async () => '203.0.113.5'),
}));
vi.mock('@/features/mail/guest-queue', () => ({
  queueGuestMails: vi.fn(),
  queueRequestDeclinedMail: vi.fn(),
  drainQueuedGuestMails: vi.fn(),
}));

const REQ = '00000000-0000-7000-8000-00000000000a';
const EVENT = '00000000-0000-7000-8000-00000000000e';
const VIP = '00000000-0000-7000-8000-0000000000b1';
const REG = '00000000-0000-7000-8000-0000000000b2';
const G1 = '00000000-0000-7000-8000-0000000000c1';
const G2 = '00000000-0000-7000-8000-0000000000c2';

function mockRpc(data: unknown, error: { code: string; message: string } | null = null): Mock {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'approver' } } });
  (createClient as Mock).mockResolvedValue({ rpc, auth: { getUser } });
  return rpc;
}

beforeEach(() => {
  vi.mocked(queueGuestMails).mockClear();
  vi.mocked(queueRequestDeclinedMail).mockClear();
  vi.mocked(drainQueuedGuestMails).mockClear();
});

describe('decideGuestRequest', () => {
  it('sends the split as the RPC jsonb and queues ONE partly mail on the first part', async () => {
    const rpc = mockRpc({ outcome: 'partly', guest_ids: [G1, G2], replay: false });
    const res = await decideGuestRequest({
      requestId: REQ,
      eventId: EVENT,
      approved: [
        { tierId: VIP, plusOnes: 0 },
        { tierId: REG, plusOnes: 1 },
      ],
      declined: 1,
      note: '  One less, sorry.  ',
    });
    expect(res).toEqual({ ok: true, outcome: 'partly' });
    expect(rpc).toHaveBeenCalledWith('decide_guest_request', {
      p_request_id: REQ,
      p_decision: {
        approved: [
          { tier_id: VIP, plus_ones: 0 },
          { tier_id: REG, plus_ones: 1 },
        ],
        declined: 1,
        note: 'One less, sorry.',
      },
    });
    expect(queueGuestMails).toHaveBeenCalledOnce();
    expect(queueGuestMails).toHaveBeenCalledWith(
      [{ type: 'guest_request_partly', guestId: G1, requestId: REQ, remark: 'One less, sorry.' }],
      'approver',
    );
    expect(queueRequestDeclinedMail).not.toHaveBeenCalled();
  });

  it('a full approval queues the approved mail (never guest_on_list), note optional', async () => {
    mockRpc({ outcome: 'approved', guest_ids: [G1], replay: false });
    await decideGuestRequest({ requestId: REQ, approved: [{ tierId: VIP, plusOnes: 2 }], declined: 0 });
    expect(queueGuestMails).toHaveBeenCalledWith(
      [{ type: 'guest_request_approved', guestId: G1, requestId: REQ, remark: null }],
      'approver',
    );
    const types = vi.mocked(queueGuestMails).mock.calls.flatMap(([mails]) => mails.map((m) => m.type));
    expect(types).not.toContain('guest_on_list');
  });

  it('a whole decline queues the decline mail on the request, with the note', async () => {
    const rpc = mockRpc({ outcome: 'declined', guest_ids: [], replay: false });
    await decideGuestRequest({ requestId: REQ, approved: [], declined: 3, note: 'Full tonight.' });
    expect(rpc).toHaveBeenCalledWith('decide_guest_request', {
      p_request_id: REQ,
      p_decision: { approved: [], declined: 3, note: 'Full tonight.' },
    });
    expect(queueRequestDeclinedMail).toHaveBeenCalledOnce();
    expect(queueRequestDeclinedMail).toHaveBeenCalledWith(REQ, 'Full tonight.', 'approver');
    expect(queueGuestMails).not.toHaveBeenCalled();
  });

  it('a replay (same decision again) succeeds and queues no mail at all', async () => {
    mockRpc({ outcome: 'partly', guest_ids: [G1, G2], replay: true });
    const res = await decideGuestRequest({
      requestId: REQ,
      approved: [{ tierId: VIP, plusOnes: 1 }],
      declined: 1,
      note: 'x',
    });
    expect(res.ok).toBe(true);
    expect(queueGuestMails).not.toHaveBeenCalled();
    expect(queueRequestDeclinedMail).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<DecideGuestRequestInput>]>([
    ['a decline without a note', { approved: [{ tierId: VIP, plusOnes: 0 }], declined: 1 }],
    ['a whitespace note on a decline', { approved: [], declined: 2, note: '   ' }],
    ['the same tier twice', { approved: [{ tierId: VIP, plusOnes: 0 }, { tierId: VIP, plusOnes: 0 }], declined: 0 }],
    ['a negative plus-ones', { approved: [{ tierId: VIP, plusOnes: -1 }], declined: 0 }],
    ['a negative declined count', { approved: [{ tierId: VIP, plusOnes: 1 }], declined: -1, note: 'x' }],
    ['nobody decided', { approved: [], declined: 0 }],
    ['a 281-character note', { approved: [{ tierId: VIP, plusOnes: 0 }], declined: 1, note: 'n'.repeat(281) }],
  ])('rejects %s before the RPC and queues nothing', async (_label, patch) => {
    const rpc = mockRpc({ outcome: 'approved', guest_ids: [G1], replay: false });
    const res = await decideGuestRequest({ requestId: REQ, approved: [], declined: 0, ...patch } as DecideGuestRequestInput);
    expect(res.ok === false && res.code).toBe('invalid');
    expect(rpc).not.toHaveBeenCalled();
    expect(queueGuestMails).not.toHaveBeenCalled();
  });

  it('a cap breach (45005) comes back as the DB copy and queues nothing', async () => {
    mockRpc(null, { code: '45005', message: 'Capacity reached.' });
    const res = await decideGuestRequest({ requestId: REQ, approved: [{ tierId: VIP, plusOnes: 1 }], declined: 0 });
    expect(res).toEqual({ ok: false, code: '45005', message: 'Capacity reached.' });
    expect(queueGuestMails).not.toHaveBeenCalled();
  });

  it('a drifted RPC answer fails closed without a mail', async () => {
    mockRpc({ ok: true });
    const res = await decideGuestRequest({ requestId: REQ, approved: [{ tierId: VIP, plusOnes: 0 }], declined: 0 });
    expect(res.ok).toBe(false);
    expect(queueGuestMails).not.toHaveBeenCalled();
  });

  it('refuses without a session and never reaches the RPC', async () => {
    const rpc = vi.fn();
    (createClient as Mock).mockResolvedValue({ rpc, auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) } });
    const res = await decideGuestRequest({ requestId: REQ, approved: [{ tierId: VIP, plusOnes: 0 }], declined: 0 });
    expect(res.ok === false && res.code).toBe('unauthorized');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('submitGuestRequest — auto-approve drains the queue the RPC filled', () => {
  it('drains after an auto-approval, and not otherwise', async () => {
    (headers as Mock).mockResolvedValue({ get: () => 'app.plus-one.io' });
    (verifyTurnstileToken as Mock).mockResolvedValue(true);
    const base = {
      slug: 'frenzy',
      fullName: 'Jip Jansen',
      email: 'jip@voorbeeld.nl',
      phone: '+31612345678',
      plusOnes: 0,
      marketingOptIn: false,
    } as const;

    mockRpc({ status: 'ok', auto_approved: true });
    await submitGuestRequest(base);
    expect(drainQueuedGuestMails).toHaveBeenCalledOnce();

    vi.mocked(drainQueuedGuestMails).mockClear();
    mockRpc({ status: 'ok', auto_approved: false });
    await submitGuestRequest(base);
    expect(drainQueuedGuestMails).not.toHaveBeenCalled();
  });
});
