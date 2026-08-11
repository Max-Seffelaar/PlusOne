import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  setEventCancelled,
  setLandingActive,
  setListLock,
  setAutoLock,
  setEventAllowUncheck,
} from './actions';
import { createClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth/context';

// Server actions call createClient() (from @/lib/supabase/server) and
// getAuthContext() (from @/lib/auth/context), both of which internally reach
// for Next's cookies() — unavailable outside a request context. Mock both so
// each test can hand back a minimal fake.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  getAuthContext: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const USER_ID = '00000000-0000-0000-0000-000000000001';
const EVENT_ID = '33333333-3333-3333-3333-333333333333';

interface FakeChain {
  update: Mock;
  eq: Mock;
  // Thenable: `.update(patch, {count:'exact'}).eq('id', eventId)` is awaited
  // directly (no .select()/.maybeSingle()), so the builder must resolve like
  // a real PostgREST result carrying { error, count }.
  then: (resolve: (v: { error: unknown; count: number | null }) => unknown) => unknown;
}

function makeClient(opts: { count: number | null; error?: unknown }) {
  const result = { error: opts.error ?? null, count: opts.count };
  const chain: FakeChain = {
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (resolve) => resolve(result),
  };
  return { from: vi.fn(() => chain) };
}

function mockAuthed() {
  (getAuthContext as Mock).mockResolvedValue({ user: { id: USER_ID } });
}

// C15 guard, extended to every event-level toggle (86ey9e9gn): a
// `.update().eq()` that RLS filters to zero rows returns NO Postgrest error —
// returning ok:true would be a silent no-op reported as success. Each action
// below must surface that as ok:false / not_found, and still succeed when a
// row was actually touched.
describe('event toggle actions — C15 zero-row guard', () => {
  const cases: Array<{
    name: string;
    run: () => ReturnType<typeof setEventCancelled>;
  }> = [
    { name: 'setEventCancelled', run: () => setEventCancelled({ eventId: EVENT_ID, cancelled: true }) },
    { name: 'setLandingActive', run: () => setLandingActive({ eventId: EVENT_ID, active: true }) },
    { name: 'setListLock', run: () => setListLock({ eventId: EVENT_ID, locked: true }) },
    {
      name: 'setAutoLock',
      run: () => setAutoLock({ eventId: EVENT_ID, autoLockAt: '2026-08-10T20:00:00.000Z' }),
    },
    {
      name: 'setEventAllowUncheck',
      run: () => setEventAllowUncheck({ eventId: EVENT_ID, allowUncheck: false }),
    },
  ];

  for (const { name, run } of cases) {
    it(`${name}: count 0, no error -> ok:false, not_found`, async () => {
      mockAuthed();
      (createClient as Mock).mockResolvedValue(makeClient({ count: 0, error: null }));
      const result = await run();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('not_found');
    });

    it(`${name}: count 1 -> ok:true (existing success path unaffected)`, async () => {
      mockAuthed();
      (createClient as Mock).mockResolvedValue(makeClient({ count: 1, error: null }));
      const result = await run();
      expect(result).toEqual({ ok: true });
    });

    it(`${name}: Postgrest error -> ok:false via mapMutationError (unaffected)`, async () => {
      mockAuthed();
      (createClient as Mock).mockResolvedValue(
        makeClient({ count: null, error: { code: '42501', message: 'insufficient_privilege' } })
      );
      const result = await run();
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('42501');
    });
  }
});
