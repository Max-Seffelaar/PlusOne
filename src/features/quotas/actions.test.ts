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

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '9c000000-0000-7000-8000-000000000001';

function mockSupabase() {
  const eq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const rpc = vi.fn(async () => ({ error: null }));
  (createClient as Mock).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from,
    rpc,
  });
  return { from, update, eq, rpc };
}

describe('decideQuotaRequest — only granted columns reach quota_requests', () => {
  it('a deny updates exactly the four granted columns, with status denied, as the actor', async () => {
    const { from, update, eq, rpc } = mockSupabase();

    const res = await decideQuotaRequest({ requestId: REQUEST_ID, decision: 'denied', reason: 'Vol' });

    expect(res).toEqual({ ok: true });
    expect(rpc).not.toHaveBeenCalled();
    expect(from).toHaveBeenCalledWith('quota_requests');
    expect(update).toHaveBeenCalledTimes(1);
    const body = (update.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(Object.keys(body).sort()).toEqual(['decided_at', 'decided_by', 'decision_reason', 'status']);
    expect(body).toMatchObject({ status: 'denied', decided_by: USER_ID, decision_reason: 'Vol' });
    expect(eq).toHaveBeenCalledWith('id', REQUEST_ID);
  });

  it('an approval goes through approve_quota_request and never writes the table directly', async () => {
    const { from, rpc } = mockSupabase();

    const res = await decideQuotaRequest({ requestId: REQUEST_ID, decision: 'approved' });

    expect(res).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('approve_quota_request', { p_request_id: REQUEST_ID });
    expect(from).not.toHaveBeenCalled();
  });
});
