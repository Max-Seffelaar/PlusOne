import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  setEventCancelled,
  setLandingActive,
  setListLock,
  setAutoLock,
  setEventAllowUncheck,
  updateTier,
  inviteExternalCrew,
} from './actions';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
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

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
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

// updateTier (z8uq9m0hw3, item 5): the tier sheet now edits every field, so the
// same C15 zero-row guard applies — `.update().eq().select().maybeSingle()`
// that RLS filters to nothing returns data null and NO error.
describe('updateTier', () => {
  const TIER_ID = '44444444-4444-4444-4444-444444444444';

  interface TierChain {
    update: Mock;
    eq: Mock;
    select: Mock;
    maybeSingle: Mock;
  }

  function makeTierClient(result: { data: { event_id: string } | null; error: unknown }) {
    const chain: TierChain = {
      update: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      select: vi.fn(() => chain),
      maybeSingle: vi.fn(() => Promise.resolve(result)),
    };
    return { client: { from: vi.fn(() => chain) }, chain };
  }

  it('zero rows (RLS-filtered), no error -> ok:false, not_found', async () => {
    mockAuthed();
    const { client } = makeTierClient({ data: null, error: null });
    (createClient as Mock).mockResolvedValue(client);
    const result = await updateTier({ tierId: TIER_ID, name: 'Guest' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_found');
  });

  it('a touched row -> ok:true', async () => {
    mockAuthed();
    const { client } = makeTierClient({ data: { event_id: EVENT_ID }, error: null });
    (createClient as Mock).mockResolvedValue(client);
    expect(await updateTier({ tierId: TIER_ID, name: 'Guest' })).toEqual({ ok: true });
  });

  it('writes only what was sent: an edit without aliases never touches the stored aliases', async () => {
    mockAuthed();
    const { client, chain } = makeTierClient({ data: { event_id: EVENT_ID }, error: null });
    (createClient as Mock).mockResolvedValue(client);
    await updateTier({
      tierId: TIER_ID,
      name: 'Guest',
      color: '#B5A6FF',
      maxGuests: null,
      doorPriceCents: null,
      vatPercent: null,
    });
    expect(chain.update).toHaveBeenCalledWith({
      name: 'Guest',
      color: '#B5A6FF',
      max_guests: null,
      door_price_cents: null,
      vat_percent: null,
    });
  });

  it('a duplicate name (23505) -> the readable message', async () => {
    mockAuthed();
    const { client } = makeTierClient({ data: null, error: { code: '23505', message: 'duplicate key' } });
    (createClient as Mock).mockResolvedValue(client);
    const result = await updateTier({ tierId: TIER_ID, name: 'VIP' });
    expect(result).toEqual({ ok: false, code: '23505', message: 'A tier with this name already exists.' });
  });
});

// ── inviteExternalCrew (z8uq9m2yvp): a new OR an existing account as crew ────
// An in-memory stand-in for the two clients, so each case asserts the rows the
// action leaves behind, not just ok:true. The user-scoped client applies the
// RLS the action relies on (events/memberships readable only to members,
// event_organizers/event_quotas writable only by a venue admin); the service
// client bypasses it, like the real one.
describe('inviteExternalCrew — new and existing accounts', () => {
  const VENUE_A = 'aa000000-0000-7000-8000-000000000001';
  const VENUE_B = 'aa000000-0000-7000-8000-000000000002';
  const EVENT_A = 'ee000000-0000-7000-8000-000000000001';
  const EVENT_B = 'ee000000-0000-7000-8000-0000000000b1';
  const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
  const STAFF_ID = '55555555-5555-4555-8555-555555555555';
  const NEW_ID = '77777777-7777-4777-8777-777777777777';
  const DEMO_ID = 'de300000-0000-7000-8000-00000000a001';

  type Row = Record<string, unknown>;
  interface Db {
    events: Row[];
    venue_memberships: Row[];
    event_organizers: Row[];
    event_quotas: Row[];
    user_profiles: Row[];
    auth: Map<string, string>; // auth.users id -> email
  }
  let db: Db;
  let callerId: string;
  let ilikePatterns: string[] = [];
  const service = {
    invite: vi.fn(),
    getUserById: vi.fn(),
    from: vi.fn(),
  };

  function seed(): Db {
    return {
      events: [
        { id: EVENT_A, venue_id: VENUE_A },
        { id: EVENT_B, venue_id: VENUE_B },
      ],
      venue_memberships: [
        { venue_id: VENUE_A, user_id: STAFF_ID, roles: ['staff'] },
        { venue_id: VENUE_B, user_id: ADMIN_ID, roles: ['admin'] },
      ],
      event_organizers: [],
      event_quotas: [],
      user_profiles: [{ id: STAFF_ID, email: 'staff@plusone.test', full_name: 'Tom Bakker' }],
      auth: new Map([
        [ADMIN_ID, 'admin@plusone.test'],
        [STAFF_ID, 'staff@plusone.test'],
      ]),
    };
  }

  const isMember = (venueId: unknown) =>
    db.venue_memberships.some((m) => m.venue_id === venueId && m.user_id === callerId);
  const isAdminOf = (venueId: unknown) =>
    db.venue_memberships.some(
      (m) => m.venue_id === venueId && m.user_id === callerId && (m.roles as string[]).includes('admin'),
    );
  const venueOfEvent = (eventId: unknown) => db.events.find((e) => e.id === eventId)?.venue_id;

  /** A thenable PostgREST-ish builder over one table. */
  function builder(table: keyof Omit<Db, 'auth'>, rls: boolean) {
    const filters: Array<(r: Row) => boolean> = [];
    let write: (() => { error: unknown }) | null = null;
    let limit = Infinity;
    const b = {
      select: () => b,
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), b),
      in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), b),
      ilike: (col: string, pattern: string) => {
        ilikePatterns.push(pattern);
        // Postgres ILIKE: `_`/`%` are wildcards unless backslash-escaped.
        const re = pattern.replace(/\\(.)|([_%])|([^\\_%])/g, (_m, esc: string, wild: string, ch: string) =>
          esc !== undefined
            ? esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            : wild !== undefined
              ? (wild === '_' ? '.' : '.*')
              : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        );
        const rx = new RegExp(`^${re}$`, 'i');
        filters.push((r) => rx.test(String(r[col])));
        return b;
      },
      limit: (n: number) => ((limit = n), b),
      insert: (row: Row) => {
        write = () => {
          if (rls && !isAdminOf(venueOfEvent(row.event_id))) return { error: { code: '42501', message: 'rls' } };
          if (db[table].some((r) => r.event_id === row.event_id && r.user_id === row.user_id)) {
            return { error: { code: '23505', message: 'duplicate key' } };
          }
          db[table].push({ ...row });
          return { error: null };
        };
        return b;
      },
      upsert: (row: Row, opts: { onConflict: string; ignoreDuplicates?: boolean }) => {
        write = () => {
          if (rls && !isAdminOf(venueOfEvent(row.event_id))) return { error: { code: '42501', message: 'rls' } };
          const keys = opts.onConflict.split(',');
          const hit = db[table].find((r) => keys.every((k) => r[k] === row[k]));
          if (hit && !opts.ignoreDuplicates) Object.assign(hit, row);
          if (!hit) db[table].push({ ...row });
          return { error: null };
        };
        return b;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (write) return resolve(write());
        const visible = db[table].filter((r) => {
          if (!rls) return true;
          if (table === 'events') return isMember(r.venue_id);
          if (table === 'venue_memberships') return r.user_id === callerId;
          return true;
        });
        return resolve({ data: visible.filter((r) => filters.every((f) => f(r))).slice(0, limit), error: null });
      },
    };
    return b;
  }

  function wire(as: string) {
    callerId = as;
    (getAuthContext as Mock).mockResolvedValue({ user: { id: as, email: db.auth.get(as) } });
    (createClient as Mock).mockResolvedValue({ from: (t: keyof Omit<Db, 'auth'>) => builder(t, true) });
    service.from.mockImplementation((t: keyof Omit<Db, 'auth'>) => builder(t, false));
    service.getUserById.mockImplementation(async (id: string) => ({
      data: { user: db.auth.has(id) ? { id, email: db.auth.get(id) } : null },
      error: null,
    }));
    service.invite.mockImplementation(async (email: string) => {
      if ([...db.auth.values()].includes(email)) {
        return { data: { user: null }, error: { code: 'email_exists', status: 422, message: 'A user with this email address has already been registered' } };
      }
      db.auth.set(NEW_ID, email);
      return { data: { user: { id: NEW_ID } }, error: null };
    });
    (createServiceClient as Mock).mockReturnValue({
      from: service.from,
      auth: { admin: { inviteUserByEmail: service.invite, getUserById: service.getUserById } },
    });
  }

  beforeEach(() => {
    db = seed();
    ilikePatterns = [];
    service.invite.mockReset();
    service.getUserById.mockReset();
    service.from.mockReset();
    (createServiceClient as Mock).mockReset();
  });

  it('new account: provisioned, profile created, crew + quota on the event, no venue membership', async () => {
    wire(ADMIN_ID);
    const res = await inviteExternalCrew({ email: 'dj@new.example', eventIds: [EVENT_B], quota: 3 });
    expect(res).toEqual({ ok: true });
    expect(service.invite).toHaveBeenCalledTimes(1);
    expect(db.user_profiles).toContainEqual({ id: NEW_ID, full_name: 'dj', email: 'dj@new.example' });
    expect(db.event_organizers).toEqual([{ event_id: EVENT_B, user_id: NEW_ID }]);
    expect(db.event_quotas).toEqual([{ event_id: EVENT_B, user_id: NEW_ID, quota_override: 3 }]);
    expect(db.venue_memberships.filter((m) => m.user_id === NEW_ID)).toEqual([]);
  });

  it('existing account (member of another company): crew + quota for THAT id, no membership, profile untouched, same result as new', async () => {
    wire(ADMIN_ID);
    const profileBefore = structuredClone(db.user_profiles);
    const membershipsBefore = structuredClone(db.venue_memberships);
    const res = await inviteExternalCrew({ email: '  Staff@PlusOne.test ', eventIds: [EVENT_B], quota: 4 });
    expect(res).toEqual({ ok: true });
    expect(db.event_organizers).toEqual([{ event_id: EVENT_B, user_id: STAFF_ID }]);
    expect(db.event_quotas).toEqual([{ event_id: EVENT_B, user_id: STAFF_ID, quota_override: 4 }]);
    expect(db.venue_memberships).toEqual(membershipsBefore);
    expect(db.user_profiles).toEqual(profileBefore);
    // Nothing was upserted into user_profiles on this path, only read.
    expect(service.from).toHaveBeenCalledWith('user_profiles');
    expect(service.getUserById).toHaveBeenCalledWith(STAFF_ID);
  });

  it('existing account already crew on the event (23505) -> ok, still one row', async () => {
    wire(ADMIN_ID);
    db.event_organizers.push({ event_id: EVENT_B, user_id: STAFF_ID });
    expect(await inviteExternalCrew({ email: 'staff@plusone.test', eventIds: [EVENT_B] })).toEqual({ ok: true });
    expect(db.event_organizers).toEqual([{ event_id: EVENT_B, user_id: STAFF_ID }]);
  });

  it('a profile e-mail edited to someone else’s address is never resolved in their place', async () => {
    wire(ADMIN_ID);
    // An attacker's own profile row claims a case variant of staff@'s address;
    // their auth identity is still their own address.
    const ATTACKER = '88888888-8888-4888-8888-888888888888';
    db.auth.set(ATTACKER, 'attacker@evil.example');
    db.user_profiles.unshift({ id: ATTACKER, email: 'STAFF@plusone.test', full_name: 'x' });
    expect(await inviteExternalCrew({ email: 'staff@plusone.test', eventIds: [EVENT_B] })).toEqual({ ok: true });
    expect(db.event_organizers).toEqual([{ event_id: EVENT_B, user_id: STAFF_ID }]);
  });

  it('auth knows the address but no verified profile matches -> generic error, nothing written', async () => {
    wire(ADMIN_ID);
    db.user_profiles = [];
    const res = await inviteExternalCrew({ email: 'staff@plusone.test', eventIds: [EVENT_B] });
    expect(res).toEqual({ ok: false, code: 'invite', message: "Couldn't create the invite. Try again." });
    expect(db.event_organizers).toEqual([]);
    expect(db.event_quotas).toEqual([]);
  });

  it('`_` in the address is matched literally, not as a wildcard', async () => {
    wire(ADMIN_ID);
    db.auth.set(NEW_ID, 'a_b@x.example');
    db.user_profiles.push({ id: NEW_ID, email: 'a_b@x.example', full_name: 'ab' });
    // A look-alike `_` would match unescaped (axb), and verification would still drop it;
    // the escape keeps the candidate set literal in the first place.
    db.auth.set('99999999-9999-4999-8999-999999999999', 'axb@x.example');
    db.user_profiles.push({ id: '99999999-9999-4999-8999-999999999999', email: 'axb@x.example', full_name: 'x' });
    await inviteExternalCrew({ email: 'a_b@x.example', eventIds: [EVENT_B] });
    expect(ilikePatterns).toEqual(['a\\_b@x.example']);
    expect(service.getUserById).toHaveBeenCalledTimes(1);
    expect(db.event_organizers).toEqual([{ event_id: EVENT_B, user_id: NEW_ID }]);
  });

  it('non-admin caller: unauthorized, no service-role call at all', async () => {
    wire(STAFF_ID);
    const res = await inviteExternalCrew({ email: 'staff@plusone.test', eventIds: [EVENT_A] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('unauthorized');
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(service.invite).not.toHaveBeenCalled();
    expect(db.event_organizers).toEqual([]);
  });

  it('admin of venue B targeting an event of venue A: unauthorized, no service-role call', async () => {
    wire(ADMIN_ID);
    for (const eventIds of [[EVENT_A], [EVENT_B, EVENT_A]]) {
      const res = await inviteExternalCrew({ email: 'staff@plusone.test', eventIds });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('unauthorized');
    }
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(db.event_organizers).toEqual([]);
  });

  it('the existing account is the store-review demo account -> 42501, nothing written', async () => {
    wire(ADMIN_ID);
    db.auth.set(DEMO_ID, 'app-review@demo.plus-one.io');
    db.user_profiles.push({ id: DEMO_ID, email: 'app-review@demo.plus-one.io', full_name: 'Demo' });
    const res = await inviteExternalCrew({ email: 'app-review@demo.plus-one.io', eventIds: [EVENT_B] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('42501');
    expect(db.event_organizers).toEqual([]);
  });

  it('the demo account as caller: 42501 before any read or service-role call', async () => {
    wire(ADMIN_ID);
    (getAuthContext as Mock).mockResolvedValue({ user: { id: DEMO_ID, email: 'app-review@demo.plus-one.io' } });
    const res = await inviteExternalCrew({ email: 'staff@plusone.test', eventIds: [EVENT_B] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('42501');
    expect(createServiceClient).not.toHaveBeenCalled();
    expect(db.event_organizers).toEqual([]);
  });
});
