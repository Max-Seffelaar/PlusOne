/**
 * inviteExternalCrew (z8uq9m2yvp, decision Max 2026-10-07): crew always goes
 * through an open invite the person accepts. One path for a new address and an
 * existing account, the same result for both, and nothing about the target
 * written before they accept (no event_organizers, no profile, no membership).
 *
 * An in-memory stand-in for the user-scoped client that applies the RLS the
 * action relies on (events/memberships readable to members, invites writable by
 * a venue admin for an event in that venue, one open crew invite per event), so
 * each case asserts the rows the action leaves behind, not just ok:true.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/lib/i18n';

type Row = Record<string, unknown>;

const H = vi.hoisted(() => ({
  callerId: '',
  db: null as unknown as {
    events: Row[];
    venue_memberships: Row[];
    event_organizers: Row[];
    invites: Row[];
    venues: Row[];
    user_profiles: Row[];
  },
  sendInviteEmail: vi.fn(),
  capReached: false,
  service: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: H.service }));
vi.mock('@/features/auth/invite-mail', () => ({ sendInviteEmail: H.sendInviteEmail }));
vi.mock('@/features/mail/limits', () => ({ inviteMailCapReached: async () => H.capReached }));
vi.mock('@/lib/auth/context', () => ({
  getAuthContext: async () => ({ user: { id: H.callerId, email: emailOf(H.callerId) } }),
  getMyProfile: async () => ({ full_name: 'Max de Vries' }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from: (t: string) => builder(t) }) }));

const { inviteExternalCrew } = await import('./actions');

const VESPER = 'aa000000-0000-7000-8000-000000000001';
const MARKTZAAL = 'aa000000-0000-7000-8000-000000000002';
const EV_VESPER = 'ee000000-0000-7000-8000-000000000001';
const EV_MARKTZAAL = 'ee000000-0000-7000-8000-0000000000b1';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const STAFF = '55555555-5555-4555-8555-555555555555';
const DJ = '77777777-7777-4777-8777-777777777777';

function emailOf(id: string): string | undefined {
  return H.db.user_profiles.find((p) => p.id === id)?.email as string | undefined;
}

const isMember = (venueId: unknown) => H.db.venue_memberships.some((m) => m.venue_id === venueId && m.user_id === H.callerId);
const isAdminOf = (venueId: unknown) =>
  H.db.venue_memberships.some(
    (m) => m.venue_id === venueId && m.user_id === H.callerId && (m.roles as string[]).includes('admin'),
  );

/** PostgREST-ish builder over one table, with the RLS the action relies on. */
function builder(table: string) {
  const rows = (H.db as unknown as Record<string, Row[]>)[table];
  const filters: Array<(r: Row) => boolean> = [];
  let write: (() => { error: unknown; count?: number }) | null = null;
  const like = (pattern: string) => {
    const re = pattern.replace(/\\(.)|([_%])|([^\\_%])/g, (_m, esc: string, wild: string, ch: string) =>
      esc !== undefined
        ? esc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        : wild !== undefined
          ? wild === '_' ? '.' : '.*'
          : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    return new RegExp(`^${re}$`, 'i');
  };
  const profileEmail = (r: Row) => String(H.db.user_profiles.find((p) => p.id === r.user_id)?.email ?? '');
  const b = {
    select: () => b,
    eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), b),
    is: (col: string, v: unknown) => (filters.push((r) => (r[col] ?? null) === v), b),
    in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), b),
    filter: (col: string, op: string, v: string) => {
      if (col === 'roles' && v === '{}') filters.push((r) => ((r.roles as string[]).length === 0) === (op === 'eq'));
      return b;
    },
    contains: (col: string, vs: unknown[]) => (filters.push((r) => vs.every((v) => (r[col] as unknown[]).includes(v))), b),
    ilike: (col: string, pattern: string) => {
      const rx = like(pattern);
      filters.push((r) => rx.test(col === 'user_profiles.email' ? profileEmail(r) : String(r[col])));
      return b;
    },
    maybeSingle: async () => {
      const r = await new Promise<{ data: Row[] }>((res) => b.then(res as never));
      return { data: r.data[0] ?? null, error: null };
    },
    insert: (row: Row) => {
      write = () => {
        if (table !== 'invites') throw new Error(`unexpected insert into ${table}`);
        // refuse_demo_venue_invite (20260925150000): the demo account's address.
        if (row.email === 'app-review@demo.plus-one.io') {
          return { error: { code: '42501', message: 'the demo account cannot be invited' } };
        }
        const ev = H.db.events.find((e) => e.id === (row.event_ids as string[])[0]);
        if (!isAdminOf(row.venue_id) || !ev || ev.venue_id !== row.venue_id || row.invited_by !== H.callerId) {
          return { error: { code: '42501', message: 'new row violates row-level security policy' } };
        }
        const dup = rows.some(
          (r) =>
            r.accepted_at == null &&
            r.venue_id === row.venue_id &&
            String(r.email).toLowerCase() === String(row.email).toLowerCase() &&
            (r.event_ids as string[])[0] === (row.event_ids as string[])[0],
        );
        if (dup) return { error: { code: '23505', message: 'duplicate key' } };
        rows.push({ ...row, accepted_at: null });
        return { error: null };
      };
      return b;
    },
    update: (patch: Row) => {
      write = () => {
        const hit = rows.filter((r) => filters.every((f) => f(r)) && isAdminOf(r.venue_id));
        hit.forEach((r) => Object.assign(r, patch));
        return { error: null, count: hit.length };
      };
      return b;
    },
    then: (resolve: (v: unknown) => unknown) => {
      if (write) return resolve(write());
      const visible = rows.filter((r) => {
        if (table === 'events') return isMember(r.venue_id);
        if (table === 'venue_memberships') return r.user_id === H.callerId || isAdminOf(r.venue_id);
        if (table === 'event_organizers') return isAdminOf(H.db.events.find((e) => e.id === r.event_id)?.venue_id);
        if (table === 'venues') return isMember(r.id);
        return true;
      });
      return resolve({ data: visible.filter((r) => filters.every((f) => f(r))), error: null });
    },
  };
  return b;
}

function seed() {
  H.db = {
    events: [
      { id: EV_VESPER, venue_id: VESPER, name: 'Launch Night' },
      { id: EV_MARKTZAAL, venue_id: MARKTZAAL, name: 'Crew Night' },
    ],
    venue_memberships: [
      { venue_id: VESPER, user_id: ADMIN, roles: ['admin'] },
      { venue_id: VESPER, user_id: STAFF, roles: ['staff'] },
      { venue_id: MARKTZAAL, user_id: ADMIN, roles: ['admin'] },
    ],
    event_organizers: [],
    invites: [],
    venues: [
      { id: VESPER, name: 'Club Vesper' },
      { id: MARKTZAAL, name: 'De Marktzaal' },
    ],
    user_profiles: [
      { id: ADMIN, email: 'admin@plusone.test' },
      { id: STAFF, email: 'staff@plusone.test', phone: '+31600000006' },
      { id: DJ, email: 'dj@crew.test' },
    ],
  };
}

const snapshot = () => structuredClone({ ...H.db, invites: [] });

beforeEach(() => {
  seed();
  H.callerId = ADMIN;
  H.capReached = false;
  H.service.mockReset();
  H.sendInviteEmail.mockReset().mockResolvedValue({ ok: true });
});

describe('inviteExternalCrew — one invite path, accept first', () => {
  it('new address: one open crew invite (no roles, the event, the quota), the invite mail, nothing else', async () => {
    const before = snapshot();
    const res = await inviteExternalCrew({ email: 'New@Crew.test', eventIds: [EV_MARKTZAAL], quota: 3 });
    expect(res).toEqual({ ok: true });
    expect(H.db.invites).toEqual([
      expect.objectContaining({
        venue_id: MARKTZAAL,
        email: 'new@crew.test',
        roles: [],
        event_ids: [EV_MARKTZAAL],
        crew_quota: 3,
        invited_by: ADMIN,
        accepted_at: null,
      }),
    ]);
    expect({ ...H.db, invites: [] }).toEqual(before);
    expect(H.sendInviteEmail).toHaveBeenCalledWith('new@crew.test', {
      existingAccountMail: {
        template: 'team_added_to_event',
        venueId: MARKTZAAL,
        inviterName: 'Max de Vries',
        companyName: 'De Marktzaal',
        eventName: 'Crew Night',
        quota: 3,
      },
      mailCapVenueId: MARKTZAAL,
    });
    // No service-role lookup of any account.
    expect(H.service).not.toHaveBeenCalled();
  });

  it('existing account of another company: the SAME result and the same kind of row; no crew, membership or profile change before accept', async () => {
    const before = snapshot();
    const res = await inviteExternalCrew({ email: 'staff@plusone.test', eventIds: [EV_MARKTZAAL], quota: 3 });
    expect(res).toEqual({ ok: true });
    expect(H.db.invites).toHaveLength(1);
    expect(H.db.invites[0]).toMatchObject({ venue_id: MARKTZAAL, email: 'staff@plusone.test', roles: [], crew_quota: 3 });
    expect(H.db.event_organizers).toEqual([]);
    expect({ ...H.db, invites: [] }).toEqual(before);
    expect(H.service).not.toHaveBeenCalled();
  });

  it('a member of the event’s own company: nothing written, no mail, same ok', async () => {
    const res = await inviteExternalCrew({ email: 'staff@plusone.test', eventIds: [EV_VESPER], quota: 2 });
    expect(res).toEqual({ ok: true });
    expect(H.db.invites).toEqual([]);
    expect(H.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('someone already on the event’s crew: nothing written (quota untouched), same ok', async () => {
    H.db.event_organizers.push({ event_id: EV_MARKTZAAL, user_id: DJ });
    const res = await inviteExternalCrew({ email: 'dj@crew.test', eventIds: [EV_MARKTZAAL], quota: 1 });
    expect(res).toEqual({ ok: true });
    expect(H.db.invites).toEqual([]);
    expect(H.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('re-inviting an open invite = a resend: fresh expiry, quota unchanged, one row', async () => {
    await inviteExternalCrew({ email: 'dj@crew.test', eventIds: [EV_MARKTZAAL], quota: 5 });
    H.db.invites[0].expires_at = '2026-10-08T00:00:00.000Z';
    const res = await inviteExternalCrew({ email: 'dj@crew.test', eventIds: [EV_MARKTZAAL], quota: 1 });
    expect(res).toEqual({ ok: true });
    expect(H.db.invites).toHaveLength(1);
    expect(H.db.invites[0].crew_quota).toBe(5);
    expect(H.db.invites[0].expires_at).not.toBe('2026-10-08T00:00:00.000Z');
    expect(H.sendInviteEmail).toHaveBeenCalledTimes(2);
  });

  it('`_` in the address is taken literally in the already-in checks', async () => {
    H.db.user_profiles.push({ id: '99999999-9999-4999-8999-999999999999', email: 'axb@crew.test' });
    H.db.event_organizers.push({ event_id: EV_MARKTZAAL, user_id: '99999999-9999-4999-8999-999999999999' });
    await inviteExternalCrew({ email: 'a_b@crew.test', eventIds: [EV_MARKTZAAL] });
    expect(H.db.invites).toHaveLength(1);
  });

  it('non-admin caller: unauthorized, nothing written, no mail', async () => {
    H.callerId = STAFF;
    const res = await inviteExternalCrew({ email: 'dj@crew.test', eventIds: [EV_VESPER] });
    expect(res).toMatchObject({ ok: false, code: 'unauthorized' });
    expect(H.db.invites).toEqual([]);
    expect(H.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('an event of a company the caller is not in: unauthorized, nothing written (alone or mixed in)', async () => {
    H.db.venue_memberships = H.db.venue_memberships.filter((m) => m.venue_id !== MARKTZAAL);
    for (const eventIds of [[EV_MARKTZAAL], [EV_VESPER, EV_MARKTZAAL]]) {
      const res = await inviteExternalCrew({ email: 'dj@crew.test', eventIds });
      expect(res).toMatchObject({ ok: false, code: 'unauthorized' });
    }
    expect(H.db.invites).toEqual([]);
    expect(H.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('the company’s daily invite-mail cap: refused before anything is created', async () => {
    H.capReached = true;
    const res = await inviteExternalCrew({ email: 'dj@crew.test', eventIds: [EV_MARKTZAAL] });
    expect(res).toEqual({ ok: false, code: 'mail_cap', message: t.auth.inviteMailCapReached });
    expect(H.db.invites).toEqual([]);
    expect(H.sendInviteEmail).not.toHaveBeenCalled();
  });

  it('a mail to this address in the last minute: its own message (60-second window)', async () => {
    H.sendInviteEmail.mockResolvedValue({ ok: false, reason: 'recent' });
    const res = await inviteExternalCrew({ email: 'dj@crew.test', eventIds: [EV_MARKTZAAL] });
    expect(res).toEqual({ ok: false, code: 'mail_recent', message: t.auth.inviteMailRecent });
  });

  it('the cap hit at send time, a provisioning failure, and a lost notification', async () => {
    H.sendInviteEmail.mockResolvedValue({ ok: false, reason: 'cap' });
    expect(await inviteExternalCrew({ email: 'a@crew.test', eventIds: [EV_MARKTZAAL] })).toMatchObject({ code: 'mail_cap' });
    H.sendInviteEmail.mockResolvedValue({ ok: false, reason: 'provision' });
    expect(await inviteExternalCrew({ email: 'b@crew.test', eventIds: [EV_MARKTZAAL] })).toMatchObject({ code: 'invite' });
    // An existing account whose mail failed still has its invite (banner): ok.
    H.sendInviteEmail.mockResolvedValue({ ok: false, reason: 'notify' });
    expect(await inviteExternalCrew({ email: 'c@crew.test', eventIds: [EV_MARKTZAAL] })).toEqual({ ok: true });
  });

  it('the demo account’s address: the invites trigger refuses it, shown as the demo message', async () => {
    const res = await inviteExternalCrew({ email: 'app-review@demo.plus-one.io', eventIds: [EV_MARKTZAAL] });
    expect(res).toEqual({ ok: false, code: '42501', message: t.auth.demoCannotJoin });
    expect(H.db.invites).toEqual([]);
    expect(H.sendInviteEmail).not.toHaveBeenCalled();
  });
});
