// decideQuotaRequest must only ever send what the database grants.
//
// Since 20260925140000 `authenticated` may UPDATE exactly status, decided_by,
// decided_at and decision_reason on quota_requests, and the decide policy
// accepts only status = 'denied'. A deny body that names any other column is a
// 42501 in production (not a silent success), and a direct 'approved' write is
// refused — approval is the approve_quota_request RPC. These tests pin both.
import { describe, expect, it, vi, type Mock } from 'vitest';
import { decideQuotaRequest } from './actions';
import { createClient } from '@/lib/supabase/server';
import { t } from '@/lib/i18n';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
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
});
