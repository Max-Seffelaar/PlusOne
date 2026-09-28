/**
 * inviteExternalCrew / resendCrewInvite refuse the store-review demo account
 * (86ey6bfug) before any read or service-role call. inviteExternalCrew mints a
 * real account through the service role and writes no invites row, so the
 * invites trigger never sees it: this app check is the stop for the demo
 * account on that path. A normal admin still reaches the flow.
 *
 * assignOrganizer (round 8) refuses too: adding an existing user as crew on a
 * demo event would hand them the demo venue (the DB trigger from
 * 20260925150000 is the real stop; this is the clear message).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
  from: vi.fn(),
  service: vi.fn(),
  sendInviteEmail: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: H.from }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: H.service }));
vi.mock('@/features/auth/invite-mail', () => ({
  sendInviteEmail: H.sendInviteEmail,
  alreadyRegistered: () => false,
}));
vi.mock('@/lib/auth/context', () => ({
  getAuthContext: async () => (H.user ? { user: H.user } : null),
}));

const { assignOrganizer, inviteExternalCrew, resendCrewInvite } = await import('./actions');

const DEMO_USER_ID = 'de300000-0000-7000-8000-00000000a001';
const DEMO_EMAIL = 'app-review@demo.plus-one.io';
const DEMO_COPY = 'Invites are turned off for the demo account.';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';
const VENUE_ID = '11111111-1111-4111-8111-111111111111';
const CREW_ID = '55555555-5555-4555-8555-555555555555';

// Minimal thenable query chain: every builder call returns itself; awaiting it
// (or .maybeSingle()) resolves to `result`.
function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in']) c[m] = vi.fn(() => c);
  c.maybeSingle = vi.fn(async () => result);
  c.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return c;
}

beforeEach(() => {
  H.from.mockReset();
  H.service.mockReset();
  H.sendInviteEmail.mockReset();
});

describe('inviteExternalCrew — demo account', () => {
  it.each([
    ['by id and e-mail', { id: DEMO_USER_ID, email: DEMO_EMAIL }],
    ['by id alone (rebound e-mail)', { id: DEMO_USER_ID, email: 'someone@else.example' }],
    ['by e-mail alone', { id: 'other-id', email: DEMO_EMAIL }],
  ])('refuses the demo account %s before any read or service-role call', async (_label, user) => {
    H.user = user;
    const res = await inviteExternalCrew({ email: 'mine@attacker.example', eventIds: [EVENT_ID] });
    expect(res).toEqual({ ok: false, code: '42501', message: DEMO_COPY });
    expect(H.from).not.toHaveBeenCalled();
    expect(H.service).not.toHaveBeenCalled();
  });

  it('a normal admin still reaches the authorization reads', async () => {
    H.user = { id: '44444444-4444-4444-8444-444444444444', email: 'admin@plusone.test' };
    // Not an admin of the event's venue → stops at the membership check, before
    // the service role. Enough to prove the demo guard doesn't catch everyone.
    H.from.mockImplementation((table: string) =>
      table === 'events'
        ? chain({ data: [{ id: EVENT_ID, venue_id: VENUE_ID }], error: null })
        : chain({ data: [], error: null }),
    );
    const res = await inviteExternalCrew({ email: 'crew@venue.com', eventIds: [EVENT_ID] });
    expect(H.from).toHaveBeenCalledWith('events');
    expect(res).toMatchObject({ ok: false, code: 'unauthorized' });
  });
});

describe('resendCrewInvite — demo account', () => {
  it('refuses the demo account before any read or mail', async () => {
    H.user = { id: DEMO_USER_ID, email: DEMO_EMAIL };
    const res = await resendCrewInvite({ venueId: VENUE_ID, userId: CREW_ID });
    expect(res).toEqual({ ok: false, code: '42501', message: DEMO_COPY });
    expect(H.from).not.toHaveBeenCalled();
    expect(H.sendInviteEmail).not.toHaveBeenCalled();
  });
});

describe('assignOrganizer — demo account', () => {
  it.each([
    ['by id and e-mail', { id: DEMO_USER_ID, email: DEMO_EMAIL }],
    ['by id alone (rebound e-mail)', { id: DEMO_USER_ID, email: 'someone@else.example' }],
    ['by e-mail alone', { id: 'other-id', email: DEMO_EMAIL }],
  ])('refuses the demo account %s before any write', async (_label, user) => {
    H.user = user;
    const res = await assignOrganizer({ eventId: EVENT_ID, userId: CREW_ID });
    expect(res).toEqual({ ok: false, code: '42501', message: DEMO_COPY });
    expect(H.from).not.toHaveBeenCalled();
  });

  it('refuses ANY admin adding the demo account as crew (round 10), before any write', async () => {
    H.user = { id: '44444444-4444-4444-8444-444444444444', email: 'admin@plusone.test' };
    const res = await assignOrganizer({ eventId: EVENT_ID, userId: DEMO_USER_ID });
    expect(res).toEqual({ ok: false, code: '42501', message: t.auth.demoCannotJoin });
    expect(H.from).not.toHaveBeenCalled();
  });

  it('a normal admin still reaches the insert', async () => {
    H.user = { id: '44444444-4444-4444-8444-444444444444', email: 'admin@plusone.test' };
    const insert = vi.fn(async () => ({ error: null }));
    H.from.mockImplementation(() => ({ insert }));
    const res = await assignOrganizer({ eventId: EVENT_ID, userId: CREW_ID });
    expect(H.from).toHaveBeenCalledWith('event_organizers');
    expect(insert).toHaveBeenCalledWith({ event_id: EVENT_ID, user_id: CREW_ID });
    expect(res).toEqual({ ok: true });
  });
});
