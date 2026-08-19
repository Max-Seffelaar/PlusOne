/**
 * Venue-switch refusal contract (86eykm7rk).
 *
 * `persistActiveVenue` refuses on three paths WITHOUT throwing: no session,
 * Zod rejects the id, or the id is not one of the caller's live memberships.
 * The old `setActiveVenueAction` swallowed that boolean and resolved as
 * `Promise<void>`, so the po shell's `.then(reload)` fired on a refusal too —
 * the cookie was never written and the user silently landed back on the OLD
 * venue, forever repeatable.
 *
 * These tests pin the outcome the UI branches on, and in particular that the
 * three refusals are NOT interchangeable: a missing session must stay
 * reload-able (middleware routes it to /login) while a revoked membership must
 * be reported to the user.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Membership } from '@/lib/auth/memberships';

const H = vi.hoisted(() => ({
  user: null as { id: string } | null,
  memberships: [] as Membership[],
  cookieSet: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: H.cookieSet }),
}));
vi.mock('next/cache', () => ({ revalidatePath: H.revalidatePath }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
vi.mock('@/lib/auth/context', () => ({
  getSessionUser: async () => H.user,
  getAuthContext: async () => null,
}));
vi.mock('@/lib/auth/memberships', () => ({
  getMyMemberships: async () => H.memberships,
}));

const { switchActiveVenueAction, setActiveVenueAction } = await import('./actions');

const VENUE_A = '018f3a2e-0000-7000-8000-00000000000a';
const VENUE_B = '018f3a2e-0000-7000-8000-00000000000b';

function membership(venueId: string): Membership {
  return { venueId, venueName: 'Venue', roles: ['admin'] };
}

beforeEach(() => {
  H.user = { id: 'u1' };
  H.memberships = [membership(VENUE_A), membership(VENUE_B)];
  H.cookieSet.mockClear();
  H.revalidatePath.mockClear();
});

describe('switchActiveVenueAction (86eykm7rk)', () => {
  it('writes the cookie and reports ok for a venue the caller belongs to', async () => {
    await expect(switchActiveVenueAction(VENUE_B)).resolves.toBe('ok');
    expect(H.cookieSet).toHaveBeenCalledTimes(1);
    expect(H.cookieSet.mock.calls[0]?.[1]).toBe(VENUE_B);
    expect(H.revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('reports denied — and writes NOTHING — when the membership was revoked', async () => {
    // The trigger from the bug report: an admin removes the user from venue B
    // between the render of `myVenues` and the tap.
    H.memberships = [membership(VENUE_A)];
    await expect(switchActiveVenueAction(VENUE_B)).resolves.toBe('denied');
    expect(H.cookieSet).not.toHaveBeenCalled();
    expect(H.revalidatePath).not.toHaveBeenCalled();
  });

  it('reports denied for an id that is not a UUID at all', async () => {
    await expect(switchActiveVenueAction('not-a-uuid')).resolves.toBe('denied');
    expect(H.cookieSet).not.toHaveBeenCalled();
  });

  it('reports unauthenticated (not denied) when there is no session', async () => {
    // Deliberately its own outcome: the caller keeps reloading on this one, so
    // an expired session still reaches middleware → /login instead of a dead-end
    // error message the user cannot act on.
    H.user = null;
    await expect(switchActiveVenueAction(VENUE_B)).resolves.toBe('unauthenticated');
    expect(H.cookieSet).not.toHaveBeenCalled();
  });

  it('keeps setActiveVenueAction void-returning for the <form action> switcher', async () => {
    // VenueSwitcher.tsx passes this straight to `<form action={…}>`; React 19
    // form actions must resolve to undefined. Behaviour is otherwise identical.
    const fd = new FormData();
    fd.set('venueId', VENUE_B);
    await expect(setActiveVenueAction(fd)).resolves.toBeUndefined();
    expect(H.cookieSet).toHaveBeenCalledTimes(1);
  });
});
