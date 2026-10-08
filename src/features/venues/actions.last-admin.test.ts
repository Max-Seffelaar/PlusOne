/**
 * Last-admin guard on updateMemberRolesAction / removeMemberAction (task 0g).
 * Two layers: the app's early check (other admins counted through RLS) and
 * the DB trigger refuse_last_admin_removal (20261012120000, SQLSTATE P0LA1),
 * which also catches what the early check can't see (two admins removing each
 * other at once). Both must end in the same copy, and the trigger's refusal
 * must not fall through to the generic "no access" message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LAST_ADMIN_MESSAGE } from '@/lib/db-errors';

type Row = { user_id: string; roles: string[] };

const H = vi.hoisted(() => ({
  rows: [] as { user_id: string; roles: string[] }[],
  writeResult: { error: null as null | { code: string; message: string }, count: 1 as number | null },
  writes: [] as string[],
}));

// A minimal PostgREST chain over H.rows: select().eq()… resolves to the
// filtered rows (or .maybeSingle() to one); update()/delete() resolve to
// H.writeResult and record the call.
function chain() {
  const filters: Record<string, string> = {};
  let op: 'select' | 'update' | 'delete' = 'select';
  const filtered = (): Row[] =>
    H.rows.filter((r) => (filters.user_id ? r.user_id === filters.user_id : true));
  const api = {
    select: () => api,
    update: () => {
      op = 'update';
      return api;
    },
    delete: () => {
      op = 'delete';
      return api;
    },
    eq: (col: string, val: string) => {
      filters[col] = val;
      return api;
    },
    maybeSingle: async () => ({ data: filtered()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => {
      if (op === 'select') return resolve({ data: filtered(), error: null });
      H.writes.push(op);
      return resolve(H.writeResult);
    },
  };
  return api;
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn() }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: () => chain() }) }));
vi.mock('@/lib/auth/context', () => ({
  getSessionUser: async () => ({ id: ADA, email: 'ada@x.test' }),
  getAuthContext: vi.fn(),
}));
vi.mock('@/lib/auth/memberships', () => ({
  getMyMemberships: vi.fn(),
  getOrganizerVenues: vi.fn(),
  getPlatformAdminVenue: vi.fn(),
  isPlatformAdminServer: vi.fn(),
}));

const VENUE = '1a000000-0000-7000-8000-00000000000a';
const ADA = '1a000000-0000-4000-8000-0000000000a1';
const BO = '1a000000-0000-4000-8000-0000000000b1';
const SAM = '1a000000-0000-4000-8000-0000000000c1';

const { updateMemberRolesAction, removeMemberAction } = await import('./actions');

function form(userId: string, roles: string[] = []): FormData {
  const fd = new FormData();
  fd.set('venueId', VENUE);
  fd.set('userId', userId);
  for (const r of roles) fd.append('roles', r);
  return fd;
}

beforeEach(() => {
  H.rows = [];
  H.writes = [];
  H.writeResult = { error: null, count: 1 };
});

describe('only admin (early app check)', () => {
  beforeEach(() => {
    H.rows = [
      { user_id: ADA, roles: ['admin'] },
      { user_id: SAM, roles: ['staff'] },
    ];
  });

  it('removing yourself is refused before any write', async () => {
    expect(await removeMemberAction({ ok: false }, form(ADA))).toEqual({ ok: false, error: LAST_ADMIN_MESSAGE });
    expect(H.writes).toEqual([]);
  });

  it('dropping your own admin role is refused before any write', async () => {
    expect(await updateMemberRolesAction({ ok: false }, form(ADA, ['staff']))).toEqual({
      ok: false,
      error: LAST_ADMIN_MESSAGE,
    });
    expect(H.writes).toEqual([]);
  });

  it('a role change that keeps admin goes through', async () => {
    expect(await updateMemberRolesAction({ ok: false }, form(ADA, ['admin', 'doorhost']))).toMatchObject({ ok: true });
    expect(H.writes).toEqual(['update']);
  });

  it('removing a non-admin member goes through', async () => {
    expect(await removeMemberAction({ ok: false }, form(SAM))).toMatchObject({ ok: true });
    expect(H.writes).toEqual(['delete']);
  });
});

describe('two admins: the app lets it through, the DB trigger decides', () => {
  beforeEach(() => {
    H.rows = [
      { user_id: ADA, roles: ['admin'] },
      { user_id: BO, roles: ['admin'] },
    ];
  });

  it('removing yourself succeeds when the DB agrees', async () => {
    expect(await removeMemberAction({ ok: false }, form(ADA))).toMatchObject({ ok: true });
    expect(H.writes).toEqual(['delete']);
  });

  it('a P0LA1 from the trigger (the other admin left meanwhile) becomes the last-admin copy on delete', async () => {
    H.writeResult = { error: { code: 'P0LA1', message: 'a company always keeps at least one admin' }, count: null };
    expect(await removeMemberAction({ ok: false }, form(ADA))).toEqual({ ok: false, error: LAST_ADMIN_MESSAGE });
    expect(H.writes).toEqual(['delete']);
  });

  it('and on a role change', async () => {
    H.writeResult = { error: { code: 'P0LA1', message: 'a company always keeps at least one admin' }, count: null };
    expect(await updateMemberRolesAction({ ok: false }, form(ADA, ['staff']))).toEqual({
      ok: false,
      error: LAST_ADMIN_MESSAGE,
    });
  });

  it('any other DB error keeps the generic copy', async () => {
    H.writeResult = { error: { code: '42501', message: 'denied' }, count: null };
    const res = await removeMemberAction({ ok: false }, form(ADA));
    expect(res.ok).toBe(false);
    expect(res.error).not.toBe(LAST_ADMIN_MESSAGE);
  });
});
