/**
 * createVenueAction refuses the store-review demo account (86ey6bfug) before
 * the RPC is called. The database is the real stop
 * (20260925130000_review_demo_guard.sql, pgTAP review_demo_guard.test.sql);
 * this pins the clear UI error on top of it, and that a normal user still
 * reaches the RPC.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
  rpc: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ set: vi.fn() }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: H.rpc }) }));
vi.mock('@/lib/auth/context', () => ({
  getSessionUser: async () => H.user,
  getAuthContext: async () => (H.user ? { user: H.user } : null),
}));
vi.mock('@/lib/auth/memberships', () => ({
  getMyMemberships: async () => [],
  getOrganizerVenues: async () => [],
  getPlatformAdminVenue: async () => null,
}));

const { createVenueAction } = await import('./actions');

const DEMO_USER_ID = 'de300000-0000-7000-8000-00000000a001';
const DEMO_EMAIL = 'app-review@demo.plus-one.io';
const INPUT = { name: 'Escape Venue', venueType: 'club', termsAccepted: true } as const;

beforeEach(() => {
  H.rpc.mockReset();
  H.rpc.mockResolvedValue({ data: 'new-venue-id', error: null });
});

describe('createVenueAction — demo account', () => {
  it.each([
    ['by id and e-mail', { id: DEMO_USER_ID, email: DEMO_EMAIL }],
    ['by id alone (rebound e-mail)', { id: DEMO_USER_ID, email: 'someone@else.example' }],
    ['by e-mail alone', { id: 'other-id', email: DEMO_EMAIL }],
  ])('refuses the demo account %s without calling the RPC', async (_label, user) => {
    H.user = user;
    const res = await createVenueAction({ ...INPUT });
    expect(res).toEqual({ ok: false, code: '42501', message: "The demo account can't create venues." });
    expect(H.rpc).not.toHaveBeenCalled();
  });

  it('a normal user still reaches create_venue_with_owner', async () => {
    H.user = { id: '44444444-4444-4444-8444-444444444444', email: 'organizer@plusone.test' };
    const res = await createVenueAction({ ...INPUT });
    expect(res).toEqual({ ok: true, venueId: 'new-venue-id' });
    expect(H.rpc).toHaveBeenCalledWith('create_venue_with_owner', expect.objectContaining({ p_name: 'Escape Venue' }));
  });
});
