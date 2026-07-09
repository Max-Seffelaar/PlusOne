import { describe, expect, it, vi, type Mock } from 'vitest';
import { updateGuest, changeGuestTier, changeGuestsTierBulk, removeGuest } from './actions';
import { createClient } from '@/lib/supabase/server';

// Server actions call createClient() (from @/lib/supabase/server), which
// internally calls Next's cookies() — unavailable outside a request context.
// Mock the module so each test can hand back a minimal fake Supabase client.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const USER_ID = '00000000-0000-0000-0000-000000000001';
const GUEST_ID = '11111111-1111-1111-1111-111111111111';
const TIER_ID = '22222222-2222-2222-2222-222222222222';
const EVENT_ID = '33333333-3333-3333-3333-333333333333';

interface FakeChain {
  update: Mock;
  eq: Mock;
  select: Mock;
  in: Mock;
  maybeSingle: Mock;
  // Thenable: the bulk path awaits the chain directly (no maybeSingle) after
  // `.update(...).in(...).select(...)`, so the builder must resolve like a real
  // PostgREST result carrying { data, error, count }.
  then: (resolve: (v: { data: unknown; error: unknown; count: number | null }) => unknown) => unknown;
}

function makeClient(opts: {
  userId?: string | null;
  count: number | null;
  data?: unknown;
  error?: unknown;
}) {
  const result = {
    data: opts.data ?? null,
    error: opts.error ?? null,
    count: opts.count,
  };
  const chain: FakeChain = {
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    select: vi.fn(() => chain),
    in: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
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

describe('updateGuest', () => {
  it('C15 regression: RLS filters the row (count 0, no error) -> ok:false, not_found', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ userId: USER_ID, count: 0, data: null, error: null })
    );
    const result = await updateGuest({ guestId: GUEST_ID, fullName: 'Test Guest' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
  });

  it('count 1 with event_id -> ok:true (existing success path unaffected)', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ userId: USER_ID, count: 1, data: { event_id: EVENT_ID }, error: null })
    );
    const result = await updateGuest({ guestId: GUEST_ID, fullName: 'Test Guest' });
    expect(result).toEqual({ ok: true });
  });

  it('Postgrest error -> ok:false via mapMutationError (unaffected)', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({
        userId: USER_ID,
        count: null,
        data: null,
        error: { code: '42501', message: 'insufficient_privilege' },
      })
    );
    const result = await updateGuest({ guestId: GUEST_ID, fullName: 'Test Guest' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('42501');
  });
});

describe('changeGuestTier', () => {
  it('C15 regression: RLS filters the row (count 0, no error) -> ok:false, not_found', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ userId: USER_ID, count: 0, data: null, error: null })
    );
    const result = await changeGuestTier({ guestId: GUEST_ID, tierId: TIER_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
  });

  it('count 1 with event_id -> ok:true (existing success path unaffected)', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ userId: USER_ID, count: 1, data: { event_id: EVENT_ID }, error: null })
    );
    const result = await changeGuestTier({ guestId: GUEST_ID, tierId: TIER_ID });
    expect(result).toEqual({ ok: true });
  });

  it('Postgrest error -> ok:false via mapMutationError (unaffected)', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({
        userId: USER_ID,
        count: null,
        data: null,
        error: { code: '45002', message: 'Tier is full.' },
      })
    );
    const result = await changeGuestTier({ guestId: GUEST_ID, tierId: TIER_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('45002');
  });
});

describe('changeGuestsTierBulk', () => {
  const GUEST_ID_2 = '44444444-4444-4444-4444-444444444444';
  const input = { guestIds: [GUEST_ID, GUEST_ID_2], tierId: TIER_ID, eventId: EVENT_ID };

  it('C15 regression: RLS filters every row (count 0, no error) -> ok:false, not_found', async () => {
    // The bulk path awaits the builder directly; count 0 means every id was
    // filtered out (locked list, or staff moving guests they do not own).
    (createClient as Mock).mockResolvedValue(
      makeClient({ userId: USER_ID, count: 0, data: [], error: null })
    );
    const result = await changeGuestsTierBulk(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
  });

  it('count > 0 (at least one row moved) -> ok:true', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ userId: USER_ID, count: 2, data: [{ id: GUEST_ID }, { id: GUEST_ID_2 }], error: null })
    );
    const result = await changeGuestsTierBulk(input);
    expect(result).toEqual({ ok: true });
  });

  it('Postgrest error -> ok:false via mapMutationError', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({
        userId: USER_ID,
        count: null,
        data: null,
        error: { code: '42501', message: 'insufficient_privilege' },
      })
    );
    const result = await changeGuestsTierBulk(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('42501');
  });
});

describe('removeGuest', () => {
  it('C15 regression: RLS filters the row (count 0, no error) -> ok:false, not_found', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ userId: USER_ID, count: 0, data: null, error: null })
    );
    const result = await removeGuest(GUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
  });

  it('count 1 with event_id -> ok:true (existing success path unaffected)', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({ userId: USER_ID, count: 1, data: { event_id: EVENT_ID }, error: null })
    );
    const result = await removeGuest(GUEST_ID);
    expect(result).toEqual({ ok: true });
  });

  it('Postgrest error -> ok:false via mapMutationError (unaffected)', async () => {
    (createClient as Mock).mockResolvedValue(
      makeClient({
        userId: USER_ID,
        count: null,
        data: null,
        error: { code: '42501', message: 'insufficient_privilege' },
      })
    );
    const result = await removeGuest(GUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('42501');
  });
});
