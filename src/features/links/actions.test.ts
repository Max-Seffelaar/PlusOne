import { describe, expect, it, vi, type Mock } from 'vitest';
import { updateRequestLink, revokeInfluencerStatsToken } from './actions';
import { createClient } from '@/lib/supabase/server';

// Server actions call createClient() (from @/lib/supabase/server), which
// internally calls Next's cookies() — unavailable outside a request context.
// Mock the module so each test can hand back a minimal fake Supabase client.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

const USER_ID = '00000000-0000-0000-0000-000000000001';
const LINK_ID = '55555555-5555-5555-5555-555555555555';
const INFLUENCER_ID = '66666666-6666-6666-6666-666666666666';

interface FakeChain {
  update: Mock;
  eq: Mock;
  // Thenable: `.update(patch, {count:'exact'}).eq('id', id)` is awaited
  // directly (no .select()), so the builder must resolve like a real
  // PostgREST result carrying { error, count }.
  then: (resolve: (v: { error: unknown; count: number | null }) => unknown) => unknown;
}

function makeClient(opts: { userId?: string | null; count: number | null; error?: unknown }) {
  const result = { error: opts.error ?? null, count: opts.count };
  const chain: FakeChain = {
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (resolve) => resolve(result),
  };
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: opts.userId ? { id: opts.userId } : null },
      })),
    },
    from: vi.fn(() => chain),
  };
}

// C15 guard (86ey9e9gn): a `.update().eq()` that RLS filters to zero rows
// returns NO Postgrest error — returning ok:true would be a silent no-op
// reported as success. Matters most here for active:false: a stale link the
// caller believes deactivated would otherwise stay live and unnoticed.
describe('updateRequestLink', () => {
  it('deactivating (active:false), RLS filters the row (count 0, no error) -> ok:false, not_found', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ userId: USER_ID, count: 0, error: null })
    );
    const result = await updateRequestLink({ linkId: LINK_ID, active: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
  });

  it('count 1 -> ok:true (existing success path unaffected)', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ userId: USER_ID, count: 1, error: null })
    );
    const result = await updateRequestLink({ linkId: LINK_ID, active: false });
    expect(result).toEqual({ ok: true, id: LINK_ID });
  });

  it('Postgrest error -> ok:false via mapMutationError (unaffected)', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({
        userId: USER_ID,
        count: null,
        error: { code: '42501', message: 'insufficient_privilege' },
      })
    );
    const result = await updateRequestLink({ linkId: LINK_ID, active: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('42501');
  });
});

describe('revokeInfluencerStatsToken', () => {
  it('RLS filters the row (count 0, no error) -> ok:false, not_found', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ userId: USER_ID, count: 0, error: null })
    );
    const result = await revokeInfluencerStatsToken(INFLUENCER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
  });

  it('count 1 -> ok:true (existing success path unaffected)', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ userId: USER_ID, count: 1, error: null })
    );
    const result = await revokeInfluencerStatsToken(INFLUENCER_ID);
    expect(result).toEqual({ ok: true, id: INFLUENCER_ID });
  });

  it('Postgrest error -> ok:false via mapMutationError (unaffected)', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({
        userId: USER_ID,
        count: null,
        error: { code: '42501', message: 'insufficient_privilege' },
      })
    );
    const result = await revokeInfluencerStatsToken(INFLUENCER_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('42501');
  });
});
