// decideQuotaRequest must only ever send what the database grants.
//
// Since 20260925140000 `authenticated` may UPDATE exactly status, decided_by,
// decided_at and decision_reason on quota_requests, and the decide policy
// accepts only status = 'denied'. A deny body that names any other column is a
// 42501 in production (not a silent success), and a direct 'approved' write is
// refused — approval is the approve_quota_request RPC. These tests pin both.
import { describe, expect, it, vi, type Mock } from 'vitest';
import { decideQuotaRequest, markQuotaRequestSeen, requestExtraSlots } from './actions';
import { createClient } from '@/lib/supabase/server';
import { t } from '@/lib/i18n';
import { INSUFFICIENT_PRIVILEGE_MESSAGE } from '@/lib/db-errors';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/features/mail/team-queue', () => ({
  drainTeamMailsSoon: vi.fn(),
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '9c000000-0000-7000-8000-000000000001';

type SelectResult = { data: { id: string }[] | null; error: { code: string; message: string } | null };

function mockSupabase(denyRows: { id: string }[] = [{ id: REQUEST_ID }]) {
  const select = vi.fn(async (): Promise<SelectResult> => ({ data: denyRows, error: null }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const rpc = vi.fn(async () => ({ error: null }));
  (createClient as Mock).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from,
    rpc,
  });
  return { from, update, eq, select, rpc };
}

describe('decideQuotaRequest — only granted columns reach quota_requests', () => {
  it('a deny updates exactly the four granted columns, with status denied, as the actor', async () => {
    const { from, update, eq, select, rpc } = mockSupabase();

    const res = await decideQuotaRequest({ requestId: REQUEST_ID, decision: 'denied', reason: 'Vol' });

    expect(res).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith('quota_requests');
    expect(update).toHaveBeenCalledTimes(1);
    const body = (update.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(Object.keys(body).sort()).toEqual(['decided_at', 'decided_by', 'decision_reason', 'status']);
    expect(body).toMatchObject({ status: 'denied', decided_by: USER_ID, decision_reason: 'Vol' });
    expect(eq).toHaveBeenCalledWith('id', REQUEST_ID);
    expect(select).toHaveBeenCalledWith('id');
  });

  it('a deny that matches no row (already decided / not the caller\'s) is a refusal, not ok', async () => {
    const { update } = mockSupabase([]);

    const res = await decideQuotaRequest({ requestId: REQUEST_ID, decision: 'denied', reason: 'Vol' });

    expect(update).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: false, code: '45003' });
    // Same copy whatever the cause: no hint whether the row exists or who decided it.
    expect(res).toEqual({
      ok: false,
      code: '45003',
      message: 'This request has already been handled or cannot be decided by you.',
    });
  });

  it('a database error on the deny is mapped, not swallowed', async () => {
    const { eq } = mockSupabase();
    eq.mockReturnValueOnce({
      select: vi.fn(async (): Promise<SelectResult> => ({
        data: null,
        error: { code: '42501', message: 'raw detail' },
      })),
    });

    const res = await decideQuotaRequest({ requestId: REQUEST_ID, decision: 'denied', reason: 'Vol' });

    expect(res).toMatchObject({ ok: false, code: '42501' });
    expect(res).not.toMatchObject({ message: 'raw detail' });
  });

  it('an approval goes through approve_quota_request and never writes the table directly', async () => {
    const { from, rpc } = mockSupabase();

    const res = await decideQuotaRequest({ requestId: REQUEST_ID, decision: 'approved' });

    expect(res).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('approve_quota_request', { p_request_id: REQUEST_ID });
    expect(from).not.toHaveBeenCalled();
  });

  it('an approve that lost the race (45003) shows English catalogue copy, never the raw DB message', async () => {
    const { rpc } = mockSupabase();
    rpc.mockResolvedValueOnce({
      error: { code: '45003', message: 'Dit verzoek is al afgehandeld.' },
    } as never);

    const res = await decideQuotaRequest({ requestId: REQUEST_ID, decision: 'approved' });

    expect(res).toEqual({ ok: false, code: '45003', message: t.quotaRequests.alreadyHandled });
    expect(res).toEqual({ ok: false, code: '45003', message: 'This request has already been handled.' });
    expect(res).not.toMatchObject({ message: 'Dit verzoek is al afgehandeld.' });
  });

  it('any other approve error still goes through the generic mapper', async () => {
    const { rpc } = mockSupabase();
    rpc.mockResolvedValueOnce({ error: { code: 'P0002', message: 'Verzoek niet gevonden.' } } as never);

    const res = await decideQuotaRequest({ requestId: REQUEST_ID, decision: 'approved' });

    expect(res).toMatchObject({ ok: false, code: 'P0002' });
    expect(res).not.toMatchObject({ message: 'Verzoek niet gevonden.' });
  });

  it('an approve refused because the requester left the company (42501) shows the generic no-rights copy', async () => {
    const { rpc } = mockSupabase();
    rpc.mockResolvedValueOnce({
      error: { code: '42501', message: 'Deze aanvrager hoort niet meer bij deze company.' },
    } as never);

    const res = await decideQuotaRequest({ requestId: REQUEST_ID, decision: 'approved' });

    expect(res).toEqual({ ok: false, code: '42501', message: INSUFFICIENT_PRIVILEGE_MESSAGE });
  });
});

// z8uq9m2xyp — a request that names the guest, the guest-add failures of an
// approval, and the requester's "Got it".
const EVENT_ID = 'ee000000-0000-7000-8000-000000000001';
const TIER_ID = 'dd000000-0000-7000-8000-000000000002';

function mockInsert(error: { code: string; message: string } | null = null) {
  const insert = vi.fn(async () => ({ error }));
  const from = vi.fn(() => ({ insert }));
  (createClient as Mock).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from,
  });
  return { from, insert };
}

describe('requestExtraSlots — the named guest', () => {
  it('sends the guest as a snake-case payload with only the documented keys', async () => {
    const { insert } = mockInsert();

    const res = await requestExtraSlots({
      eventId: EVENT_ID,
      requestedExtra: 2,
      motivation: 'Birthday',
      guest: { name: ' Lisa de Vries ', plusOnes: 1, tierId: TIER_ID, phone: '' },
    });

    expect(res).toEqual({ ok: true });
    const row = (insert.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(row).toMatchObject({ event_id: EVENT_ID, user_id: USER_ID, requested_extra: 2 });
    expect(row.guest_payload).toEqual({ name: 'Lisa de Vries', plus_ones: 1, tier_id: TIER_ID });
    expect(row).not.toHaveProperty('guest_id');
    expect(row).not.toHaveProperty('seen_at');
  });

  it('without a guest no payload is sent', async () => {
    const { insert } = mockInsert();
    await requestExtraSlots({ eventId: EVENT_ID, requestedExtra: 2, motivation: 'Birthday' });
    const row = (insert.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(row).not.toHaveProperty('guest_payload');
  });

  it('a tier the database refuses (23514) is a readable input error', async () => {
    mockInsert({ code: '23514', message: 'Pick a tier of this event for the guest.' });
    const res = await requestExtraSlots({
      eventId: EVENT_ID,
      requestedExtra: 1,
      motivation: 'x',
      guest: { name: 'Lisa', plusOnes: 0, tierId: TIER_ID },
    });
    expect(res).toEqual({ ok: false, code: 'invalid', message: t.quotaRequests.guestInvalid });
  });

  it('negative plus-ones never reach the database', async () => {
    const { insert } = mockInsert();
    const res = await requestExtraSlots({
      eventId: EVENT_ID,
      requestedExtra: 1,
      motivation: 'x',
      guest: { name: 'Lisa', plusOnes: -1, tierId: TIER_ID },
    });
    expect(res).toMatchObject({ ok: false, code: 'invalid' });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('decideQuotaRequest — an approval whose guest cannot be added rolls back', () => {
  it.each([
    ['45001', 'Quotum overschreden: dit zou 23 van 17 plekken gebruiken voor dit event.', t.quotaRequests.guestNoFit],
    ['45002', 'Tier zit vol: 10 van 10 plekken bezet.', t.quotaRequests.guestTierFull],
    ['45005', 'Event zit vol.', t.quotaRequests.guestCapacity],
    ['45007', 'The list is locked for this person, so the guest could not be added. Nothing was changed.', t.quotaRequests.guestListLocked],
    ['45008', "The guest's tier is no longer on this event. Nothing was changed.", t.quotaRequests.guestTierGone],
    ['45009', 'This person cannot add guests to this event, so the guest could not be added. Nothing was changed.', t.quotaRequests.guestCannotAdd],
  ])('%s maps to catalogue copy that says nothing changed', async (code, dbMessage, copy) => {
    const { rpc } = mockSupabase();
    rpc.mockResolvedValueOnce({ error: { code, message: dbMessage } } as never);

    const res = await decideQuotaRequest({ requestId: REQUEST_ID, decision: 'approved' });

    expect(res).toEqual({ ok: false, code, message: copy });
    expect(copy).toMatch(/nothing changed/);
  });
});

describe('markQuotaRequestSeen', () => {
  it('writes only seen_at, on the caller\'s own request', async () => {
    const select = vi.fn(async () => ({ data: [{ id: REQUEST_ID }], error: null }));
    const eqUser = vi.fn(() => ({ select }));
    const eqId = vi.fn(() => ({ eq: eqUser }));
    const update = vi.fn(() => ({ eq: eqId }));
    (createClient as Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
      from: vi.fn(() => ({ update })),
    });

    const res = await markQuotaRequestSeen({ requestId: REQUEST_ID });

    expect(res).toEqual({ ok: true });
    const body = (update.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(Object.keys(body)).toEqual(['seen_at']);
    expect(eqId).toHaveBeenCalledWith('id', REQUEST_ID);
    expect(eqUser).toHaveBeenCalledWith('user_id', USER_ID);
  });

  it('zero rows (not theirs, still pending) is not a false success', async () => {
    const select = vi.fn(async () => ({ data: [], error: null }));
    (createClient as Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
      from: vi.fn(() => ({ update: () => ({ eq: () => ({ eq: () => ({ select }) }) }) })),
    });

    expect(await markQuotaRequestSeen({ requestId: REQUEST_ID })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('no session: unauthorized, nothing written', async () => {
    const from = vi.fn();
    (createClient as Mock).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
      from,
    });
    expect(await markQuotaRequestSeen({ requestId: REQUEST_ID })).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(from).not.toHaveBeenCalled();
  });
});
