/**
 * updateMemberRolesAction / removeMemberAction refuse the store-review demo
 * membership (demo venue + demo user, 86ey6bfug) before any read or write,
 * with the catalogue copy. The DB trigger refuse_demo_member_self_change
 * (20260925150000) is the real stop: a demoted or removed demo admin locks
 * every later reviewer out until a re-seed. Any other member still reaches
 * the normal flow (its first read).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined, set: vi.fn() }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: H.from }) }));
vi.mock('@/lib/auth/context', () => ({
  getSessionUser: async () => ({ id: 'de300000-0000-7000-8000-00000000a001', email: 'app-review@demo.plus-one.io' }),
  getAuthContext: vi.fn(),
}));
vi.mock('@/lib/auth/memberships', () => ({
  getMyMemberships: vi.fn(),
  getOrganizerVenues: vi.fn(),
  getPlatformAdminVenue: vi.fn(),
}));

const { updateMemberRolesAction, removeMemberAction } = await import('./actions');

const DEMO_USER = 'de300000-0000-7000-8000-00000000a001';
const DEMO_VENUE = 'de300000-0000-7000-8000-000000000001';
const OTHER_USER = '44444444-4444-4444-8444-444444444444';

function form(venueId: string, userId: string, roles: string[] = []): FormData {
  const fd = new FormData();
  fd.set('venueId', venueId);
  fd.set('userId', userId);
  for (const r of roles) fd.append('roles', r);
  return fd;
}

beforeEach(() => {
  H.from.mockReset();
  // The first read of the normal flow: reaching it means "not refused upfront".
  H.from.mockImplementation(() => {
    throw new Error('reached the normal flow');
  });
});

describe('the demo membership', () => {
  it('a roles change is refused with the demo copy, before any read', async () => {
    const res = await updateMemberRolesAction({ ok: false }, form(DEMO_VENUE, DEMO_USER, ['doorhost']));
    expect(res).toEqual({ ok: false, error: t.auth.demoNoOwnMembership });
    expect(H.from).not.toHaveBeenCalled();
  });

  it('a removal is refused with the demo copy, before any read', async () => {
    const res = await removeMemberAction({ ok: false }, form(DEMO_VENUE, DEMO_USER));
    expect(res).toEqual({ ok: false, error: t.auth.demoNoOwnMembership });
    expect(H.from).not.toHaveBeenCalled();
  });

  it('another member of the demo venue reaches the normal flow', async () => {
    await expect(updateMemberRolesAction({ ok: false }, form(DEMO_VENUE, OTHER_USER, ['staff']))).rejects.toThrow('reached the normal flow');
    await expect(removeMemberAction({ ok: false }, form(DEMO_VENUE, OTHER_USER))).rejects.toThrow('reached the normal flow');
  });
});
