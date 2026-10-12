import { beforeEach, describe, expect, it, vi } from 'vitest';

const update = vi.fn();
const eq = vi.fn();
const from = vi.fn();
let user: { id: string } | null = { id: 'user-1' };
let dbError: { code: string; message: string } | null = null;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/context', () => ({ getSessionUser: async () => user }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: (table: string) => {
      from(table);
      return {
        update: (patch: unknown) => {
          update(patch);
          return {
            eq: async (col: string, val: string) => {
              eq(col, val);
              return { error: dbError };
            },
          };
        },
      };
    },
  }),
}));

import { setAnalyticsOptOutAction } from './actions';

beforeEach(() => {
  vi.clearAllMocks();
  user = { id: 'user-1' };
  dbError = null;
});

describe('setAnalyticsOptOutAction', () => {
  it('opting out stamps a timestamp on the caller\'s own row', async () => {
    const res = await setAnalyticsOptOutAction({ optOut: true });
    expect(res).toEqual({ ok: true, optedOut: true });
    expect(from).toHaveBeenCalledWith('user_profiles');
    const patch = update.mock.calls[0]?.[0] as { analytics_opt_out_at: string | null };
    expect(Object.keys(patch)).toEqual(['analytics_opt_out_at']);
    expect(typeof patch.analytics_opt_out_at).toBe('string');
    expect(eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('opting back in clears it', async () => {
    const res = await setAnalyticsOptOutAction({ optOut: false });
    expect(res).toEqual({ ok: true, optedOut: false });
    expect(update).toHaveBeenCalledWith({ analytics_opt_out_at: null });
  });

  it.each([[undefined], [null], ['true'], [{ optOut: 'yes' }], [{ optOut: true, userId: 'other' }]])(
    'rejects %j without touching the database',
    async (input) => {
      const res = await setAnalyticsOptOutAction(input);
      expect(res.ok).toBe(false);
      expect(from).not.toHaveBeenCalled();
    },
  );

  it('refuses a signed-out caller', async () => {
    user = null;
    const res = await setAnalyticsOptOutAction({ optOut: true });
    expect(res.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it('maps a database error to a generic failure', async () => {
    dbError = { code: '42501', message: 'permission denied for table user_profiles' };
    const res = await setAnalyticsOptOutAction({ optOut: true });
    expect(res.ok).toBe(false);
  });
});
