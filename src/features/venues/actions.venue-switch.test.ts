/**
 * Venue-switch refusal contract (86eykm7rk).
 *
 * `switchActiveVenueAction` refuses on three paths WITHOUT throwing: no
 * session, Zod rejects the id, or the id is not one of the caller's live
 * venues. Its predecessor swallowed that outcome and resolved as
 * `Promise<void>`, so the po shell's `.then(reload)` fired on a refusal too —
 * the cookie was never written and the user silently landed back on the OLD
 * venue, forever repeatable.
 *
 * These tests pin the outcome the UI branches on, and two things in
 * particular:
 *  - the three refusals are NOT interchangeable: a missing session must stay
 *    reload-able (middleware routes it to /login) while revoked access must be
 *    reported to the user;
 *  - the access set matches what the switcher RENDERS (memberships PLUS
 *    external-crew venues), so a normal crew venue is never read as a refusal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Membership } from '@/lib/auth/memberships';

const H = vi.hoisted(() => ({
  user: null as { id: string } | null,
  memberships: [] as Membership[],
  organizerVenues: [] as Membership[],
  organizerThrows: false,
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
  getOrganizerVenues: async () => {
    if (H.organizerThrows) throw new Error('rls');
    return H.organizerVenues;
  },
}));

const { switchActiveVenueAction } = await import('./actions');

const VENUE_A = '018f3a2e-0000-7000-8000-00000000000a';
const VENUE_B = '018f3a2e-0000-7000-8000-00000000000b';
const VENUE_CREW = '018f3a2e-0000-7000-8000-00000000000c';

function membership(venueId: string): Membership {
  return { venueId, venueName: 'Venue', roles: ['admin'] };
}

/** External crew: event-organizer scope, no membership row, so `roles: []`
 *  (#24/86ey21vre). `src/app/app/layout.tsx` puts these in `myVenues`. */
function crewVenue(venueId: string): Membership {
  return { venueId, venueName: 'Crew venue', roles: [] };
}

beforeEach(() => {
  H.user = { id: 'u1' };
  H.memberships = [membership(VENUE_A), membership(VENUE_B)];
  H.organizerVenues = [];
  H.organizerThrows = false;
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

  it('accepts an EXTERNAL-CREW venue — organizer scope is access, not a refusal', async () => {
    // Round-2 review: the first cut validated against memberships only, while
    // `src/app/app/layout.tsx` renders `myVenues` as memberships PLUS organizer
    // venues and `VenueSwitch` puts a Switch button on every one of them. A
    // user who is admin at A and external crew at C therefore got "you no
    // longer have access to that venue" on a completely normal tap — every
    // time, for a venue they had not lost. `resolveActiveVenueId` accepts the
    // cookie against that same set, so writing it here resolves correctly.
    H.memberships = [membership(VENUE_A)];
    H.organizerVenues = [crewVenue(VENUE_CREW)];
    await expect(switchActiveVenueAction(VENUE_CREW)).resolves.toBe('ok');
    expect(H.cookieSet.mock.calls[0]?.[1]).toBe(VENUE_CREW);
  });

  it('still denies a venue that is in NEITHER set', async () => {
    // The widened access set must not become "accept anything": a venue the
    // caller can reach neither as a member nor as crew stays refused.
    H.memberships = [membership(VENUE_A)];
    H.organizerVenues = [crewVenue(VENUE_CREW)];
    await expect(switchActiveVenueAction(VENUE_B)).resolves.toBe('denied');
    expect(H.cookieSet).not.toHaveBeenCalled();
  });

  it('falls back to memberships when the organizer lookup fails', async () => {
    // `getOrganizerVenues` is best-effort here exactly as in layout.tsx: a
    // failing crew lookup must not lock a real member out of their own venue.
    H.organizerThrows = true;
    await expect(switchActiveVenueAction(VENUE_B)).resolves.toBe('ok');
    expect(H.cookieSet).toHaveBeenCalledTimes(1);
  });
});
