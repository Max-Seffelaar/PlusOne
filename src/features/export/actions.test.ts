/**
 * exportVenueData (legal v0.3 E1) — the server action's contract:
 *  - Zod first, then the session, then the admin role (staff/finance → refused,
 *    nothing read, nothing audited);
 *  - an event scope must belong to the venue (scope mismatch → refused);
 *  - every table read filters on venue_id (rows of another venue in the fake
 *    store never reach the CSV), paged with .range(), no `.in()` on event ids;
 *  - one log_venue_export call with the real counts, and fail-closed: an audit
 *    error means no file;
 *  - the CSV content itself: escaping, formula guard, marketing opt-in.
 *
 * The fake client applies `.eq()` filters and `.range()` windows to an
 * in-memory table store, so a missing venue filter shows up as a leaked row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readZip } from './zip-reader.test-helper';
import { pageAll, ExportTooLargeError } from './collect';

type Row = Record<string, unknown>;

const VENUE = '018f3a2e-0000-7000-8000-00000000000a';
const OTHER = '018f3a2e-0000-7000-8000-00000000000b';
const EVENT = '018f3a2e-0000-7000-8000-0000000000e1';
const OTHER_EVENT = '018f3a2e-0000-7000-8000-0000000000e2';
const ADMIN = '018f3a2e-0000-7000-8000-0000000000a1';

const H = vi.hoisted(() => ({
  user: null as { id: string } | null,
  isAdmin: false,
  auditError: null as { code: string } | null,
  store: {} as Record<string, Record<string, unknown>[]>,
  optIns: [] as { contact_id: string; opted_in_at: string }[],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  reads: [] as { table: string; eqs: [string, unknown][]; ins: string[]; ranged: boolean }[],
}));

function builder(table: string, source: () => Row[]) {
  const eqs: [string, unknown][] = [];
  const ins: string[] = [];
  let window: [number, number] | null = null;
  let single = false;
  const run = () => {
    H.reads.push({ table, eqs: [...eqs], ins: [...ins], ranged: window !== null });
    let rows = source().filter((r) =>
      eqs.every(([c, v]) => (c.includes('.') ? true : r[c] === v)),
    );
    if (window) rows = rows.slice(window[0], window[1] + 1);
    if (single) return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null };
  };
  const b = {
    select: () => b,
    eq: (c: string, v: unknown) => (eqs.push([c, v]), b),
    is: () => b,
    in: (c: string, v: unknown[]) => {
      ins.push(c);
      const all = source;
      source = () => all().filter((r) => v.includes(r[c]));
      return b;
    },
    order: () => b,
    range: (from: number, to: number) => ((window = [from, to]), b),
    maybeSingle: () => ((single = true), b),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(res, rej),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.user } }) },
    from: (table: string) => builder(table, () => H.store[table] ?? []),
    rpc: (name: string, args: Record<string, unknown>) => {
      H.rpcCalls.push({ name, args });
      if (name === 'has_venue_role') return Promise.resolve({ data: H.isAdmin, error: null });
      if (name === 'log_venue_export') return Promise.resolve({ data: 'audit-id', error: H.auditError });
      if (name === 'contact_marketing_opt_ins') return builder('rpc:opt_ins', () => H.optIns);
      throw new Error(`unexpected rpc ${name}`);
    },
  }),
}));

const { exportVenueData } = await import('./actions');

function seed(): void {
  H.store = {
    venues: [{ id: VENUE, slug: 'club-vesper', name: 'Club Vesper' }],
    events: [
      { id: EVENT, venue_id: VENUE, name: 'Launch Night', starts_at: '2026-10-10T20:00:00+00:00' },
      { id: OTHER_EVENT, venue_id: OTHER, name: 'Elsewhere', starts_at: '2026-10-11T20:00:00+00:00' },
    ],
    guest_tiers: [{ id: 't1', venue_id: VENUE, event_id: EVENT, name: 'VIP' }],
    request_links: [{ id: 'l1', venue_id: VENUE, event_id: EVENT, label: 'Instagram', slug: 'ig' }],
    guests: [
      {
        id: 'g1', venue_id: VENUE, event_id: EVENT, full_name: 'Bakker, Tom', email: 'tom@x.test',
        phone: '+31612345678', plus_ones: 2, tier_id: 't1', status: 'checked_in',
        note: 'line 1\nsays "hi"', source: 'quick_add', created_at: '2026-10-01T10:00:00+00:00',
        added_by: ADMIN, contact_id: 'c1',
        check_ins: [{ checked_at: '2026-10-10T21:00:00+00:00', voided_at: null }],
      },
      {
        id: 'g2', venue_id: VENUE, event_id: EVENT, full_name: '=HYPERLINK("https://evil.example")',
        email: null, phone: null, plus_ones: 0, tier_id: 't1', status: 'invited', note: null,
        source: 'landing', created_at: '2026-10-01T11:00:00+00:00', added_by: null, contact_id: null,
        check_ins: [],
      },
      {
        id: 'g3', venue_id: VENUE, event_id: EVENT, full_name: 'Guest #4', email: null, phone: null,
        plus_ones: 0, tier_id: 't1', status: 'invited', note: null, source: 'quick_add',
        created_at: '2026-01-01T11:00:00+00:00', added_by: null, contact_id: null, check_ins: [],
      },
      {
        id: 'gx', venue_id: OTHER, event_id: OTHER_EVENT, full_name: 'Leaked Elsewhere', email: 'leak@x.test',
        phone: null, plus_ones: 0, tier_id: 'tx', status: 'invited', note: null, source: 'quick_add',
        created_at: '2026-10-01T11:00:00+00:00', added_by: null, contact_id: null, check_ins: [],
      },
    ],
    contacts: [
      {
        id: 'c1', venue_id: VENUE, full_name: 'Bakker, Tom', email: 'tom@x.test', phone: '+31612345678',
        birthdate: null, preferred_role: null, note: null, created_at: '2026-09-01T10:00:00+00:00',
      },
      {
        id: 'c2', venue_id: VENUE, full_name: 'Not Opted', email: 'no@x.test', phone: null,
        birthdate: null, preferred_role: null, note: null, created_at: '2026-09-01T10:00:00+00:00',
      },
      {
        id: 'cx', venue_id: OTHER, full_name: 'Leaked Contact', email: 'leak@x.test', phone: null,
        birthdate: null, preferred_role: null, note: null, created_at: '2026-09-01T10:00:00+00:00',
      },
    ],
    guest_requests: [
      {
        id: 'r1', venue_id: VENUE, event_id: EVENT, full_name: 'Bakker, Tom', email: 'tom@x.test',
        phone: '+31612345678', plus_ones: 1, motivation: 'birthday', marketing_opt_in: true,
        status: 'approved', decision_reason: null, decided_by: ADMIN,
        created_at: '2026-09-30T10:00:00+00:00', request_link_id: 'l1',
      },
    ],
    check_ins: [
      {
        id: 'ci1', venue_id: VENUE, event_id: EVENT, plus_ones_arrived: 2, checked_by: ADMIN,
        device_id: 'dev-1', checked_at: '2026-10-10T21:00:00+00:00', voided_at: null,
        guests: { full_name: 'Bakker, Tom' },
      },
    ],
    refusals: [
      {
        id: 'rf1', venue_id: VENUE, event_id: EVENT, reason: 'dress code', refused_by: ADMIN,
        device_id: 'dev-2', refused_at: '2026-10-10T22:00:00+00:00', guests: { full_name: 'Guest #4' },
      },
    ],
    user_profiles: [{ id: ADMIN, full_name: 'Max de Vries' }],
  };
  H.optIns = [{ contact_id: 'c1', opted_in_at: '2026-09-30T10:00:00+00:00' }];
}

beforeEach(() => {
  H.user = { id: ADMIN };
  H.isAdmin = true;
  H.auditError = null;
  H.rpcCalls = [];
  H.reads = [];
  seed();
});

const auditCalls = () => H.rpcCalls.filter((c) => c.name === 'log_venue_export');
const dataReads = () => H.reads.filter((r) => !['venues', 'events', 'user_profiles'].includes(r.table));

describe('exportVenueData — gates', () => {
  it('rejects malformed input before touching the database', async () => {
    expect(await exportVenueData({ venueId: 'nope', scope: 'venue' })).toEqual({ ok: false, error: 'invalid' });
    expect(await exportVenueData({ venueId: VENUE, scope: { eventId: EVENT, venueId: OTHER } })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(H.rpcCalls).toEqual([]);
    expect(H.reads).toEqual([]);
  });

  it('refuses without a session', async () => {
    H.user = null;
    expect(await exportVenueData({ venueId: VENUE, scope: 'venue' })).toEqual({ ok: false, error: 'unauthorized' });
    expect(H.reads).toEqual([]);
  });

  it('refuses a non-admin (staff/finance): nothing read, nothing audited', async () => {
    H.isAdmin = false;
    expect(await exportVenueData({ venueId: VENUE, scope: 'venue' })).toEqual({ ok: false, error: 'unauthorized' });
    expect(H.rpcCalls).toEqual([
      { name: 'has_venue_role', args: { p_venue_id: VENUE, p_roles: ['admin'] } },
    ]);
    expect(dataReads()).toEqual([]);
    expect(auditCalls()).toEqual([]);
  });

  it('refuses an event of another venue (scope mismatch)', async () => {
    const res = await exportVenueData({ venueId: VENUE, scope: { eventId: OTHER_EVENT } });
    expect(res).toEqual({ ok: false, error: 'unauthorized' });
    expect(dataReads()).toEqual([]);
    expect(auditCalls()).toEqual([]);
  });

  it('is fail-closed on the audit write: no audit row, no file', async () => {
    H.auditError = { code: '42501' };
    expect(await exportVenueData({ venueId: VENUE, scope: 'venue' })).toEqual({ ok: false, error: 'failed' });
  });
});

describe('exportVenueData — content', () => {
  it('exports the venue as four CSVs in one ZIP and audits the counts', async () => {
    const res = await exportVenueData({ venueId: VENUE, scope: 'venue' });
    if (!res.ok) throw new Error(res.error);
    expect(res.filename).toMatch(/^plusone-export-club-vesper-\d{4}-\d{2}-\d{2}\.zip$/);
    const files = readZip(Buffer.from(res.zipBase64, 'base64'));
    expect([...files.keys()]).toEqual(['guests.csv', 'contacts.csv', 'requests.csv', 'door.csv']);

    const guests = files.get('guests.csv')!;
    expect(guests.startsWith('﻿event_name,event_date,full_name,')).toBe(true);
    expect(guests).toContain('"Bakker, Tom"');
    expect(guests).toContain(`"line 1\nsays ""hi"""`);
    expect(guests).toContain(`"'=HYPERLINK(""https://evil.example"")"`);
    expect(guests).toContain("'+31612345678");
    expect(guests).toContain('Max de Vries');
    expect(guests).toContain('2026-10-10T21:00:00+00:00');
    expect(guests).toContain('Guest #4'); // anonymised rows come along as they are
    expect(guests).not.toContain('Leaked Elsewhere');

    const contacts = files.get('contacts.csv')!.split('\r\n');
    expect(contacts.find((l) => l.startsWith('"Bakker, Tom"'))).toMatch(/,true,2026-09-01T10:00:00\+00:00,Launch Night$/);
    expect(contacts.find((l) => l.startsWith('Not Opted'))).toContain(',false,');
    expect(files.get('contacts.csv')).not.toContain('Leaked Contact');

    const requests = files.get('requests.csv')!;
    expect(requests).toContain('birthday,true,approved,,Max de Vries');
    expect(requests).toContain('Instagram');

    const door = files.get('door.csv')!.split('\r\n');
    expect(door[1]).toContain('check_in,3,,Max de Vries,dev-1');
    expect(door[2]).toContain('refusal,,dress code,Max de Vries,dev-2');

    expect(res.counts).toEqual({ guests: 3, contacts: 2, requests: 1, door: 2 });
    expect(auditCalls()).toEqual([
      {
        name: 'log_venue_export',
        args: { p_venue_id: VENUE, p_event_id: null, p_guests: 3, p_contacts: 2, p_requests: 1, p_door: 2 },
      },
    ]);
  });

  it('filters every data read on venue_id, pages it, and never uses .in() on event ids', async () => {
    await exportVenueData({ venueId: VENUE, scope: 'venue' });
    const tableReads = dataReads().filter((r) => !r.table.startsWith('rpc:'));
    expect(tableReads.length).toBeGreaterThan(0);
    for (const r of tableReads) {
      expect(r.eqs).toContainEqual(['venue_id', VENUE]);
      expect(r.ranged).toBe(true);
      expect(r.ins).not.toContain('event_id');
    }
  });

  it('passes the event scope through to the audit row', async () => {
    const res = await exportVenueData({ venueId: VENUE, scope: { eventId: EVENT } });
    expect(res.ok).toBe(true);
    expect(auditCalls()[0]!.args).toMatchObject({ p_venue_id: VENUE, p_event_id: EVENT });
    for (const r of dataReads().filter((x) => ['guests', 'guest_requests', 'check_ins', 'refusals'].includes(x.table))) {
      expect(r.eqs).toContainEqual(['event_id', EVENT]);
    }
  });
});

describe('pageAll — size cap', () => {
  it('reads every page until a short one', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => i);
    const out = await pageAll('guests', async (from, to) => ({ data: rows.slice(from, to + 1), error: null }), 10, 100);
    expect(out).toEqual(rows);
  });

  it('throws ExportTooLargeError above the cap instead of returning a half file', async () => {
    const rows = Array.from({ length: 101 }, (_, i) => i);
    await expect(
      pageAll('guests', async (from, to) => ({ data: rows.slice(from, to + 1), error: null }), 10, 100),
    ).rejects.toBeInstanceOf(ExportTooLargeError);
  });
});

describe('exportVenueData — too large', () => {
  it('answers too_large and writes no audit row', async () => {
    H.store.guests = Array.from({ length: 50_001 }, (_, i) => ({
      ...H.store.guests![0]!,
      id: `g${i}`,
      contact_id: null,
    }));
    expect(await exportVenueData({ venueId: VENUE, scope: 'venue' })).toEqual({ ok: false, error: 'too_large' });
    expect(auditCalls()).toEqual([]);
  });
});
