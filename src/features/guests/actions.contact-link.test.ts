import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';
import { addGuest, addGuestsBulk } from './actions';
import { addGuestSchema, bulkAddSchema } from './schemas';
import { createClient } from '@/lib/supabase/server';

// K4: a client-supplied `contactId` is UNTRUSTED. These tests pin the rule that
// it only reaches an insert when search_contacts_for_reuse — scoped to the
// EVENT'S OWN venue, queried with the guest's own name — hands the same id back.

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const USER_ID = '00000000-0000-0000-0000-000000000001';
const EVENT_ID = '33333333-3333-3333-3333-333333333333';
const TIER_ID = '22222222-2222-2222-2222-222222222222';
const VENUE_ID = '44444444-4444-4444-4444-444444444444';
const CONTACT_ID = '55555555-5555-5555-5555-555555555555';
const OTHER_CONTACT_ID = '66666666-6666-6666-6666-666666666666';

interface FakeOpts {
  /** The venue the event resolves to, or null when RLS hides the event. */
  venueId?: string | null;
  /** Rows search_contacts_for_reuse returns for a given query. */
  contacts?: { id: string; full_name: string }[];
  rpcError?: boolean;
}

function makeClient(opts: FakeOpts = {}) {
  const inserted: unknown[] = [];
  const rpcCalls: { p_venue_id: string; p_query: string }[] = [];
  const insert = vi.fn((rows: unknown) => {
    inserted.push(rows);
    return { then: (r: (v: unknown) => unknown) => r({ data: null, error: null, count: 1 }) };
  });
  interface EventChain {
    select: Mock;
    eq: Mock;
    maybeSingle: Mock;
  }
  const eventChain: EventChain = {
    select: vi.fn(() => eventChain),
    eq: vi.fn(() => eventChain),
    maybeSingle: vi.fn(async () => ({
      data: opts.venueId === null ? null : { venue_id: opts.venueId ?? VENUE_ID },
      error: null,
    })),
  };
  const client = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } } })) },
    from: vi.fn((table: string) => (table === 'events' ? eventChain : { insert })),
    rpc: vi.fn(async (_fn: string, args: { p_venue_id: string; p_query: string }) => {
      rpcCalls.push(args);
      if (opts.rpcError) return { data: null, error: { message: 'nope' } };
      const q = args.p_query.toLowerCase();
      return {
        data: (opts.contacts ?? []).filter((c) => c.full_name.toLowerCase().includes(q)),
        error: null,
      };
    }),
  };
  return { client, inserted, rpcCalls, insert };
}

const base = {
  eventId: EVENT_ID,
  tierId: TIER_ID,
  fullName: 'Juri Braakman',
  plusOnes: 0,
  source: 'app' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('schemas accept an optional contactId', () => {
  it('addGuestSchema', () => {
    expect(addGuestSchema.safeParse({ ...base, contactId: CONTACT_ID }).success).toBe(true);
    expect(addGuestSchema.safeParse({ ...base, contactId: 'not-a-uuid' }).success).toBe(false);
    expect(addGuestSchema.safeParse(base).success).toBe(true);
  });

  it('bulkAddSchema rows', () => {
    const row = { tierId: TIER_ID, fullName: 'Juri Braakman', plusOnes: 0 };
    expect(bulkAddSchema.safeParse({ eventId: EVENT_ID, guests: [{ ...row, contactId: CONTACT_ID }] }).success).toBe(true);
    expect(bulkAddSchema.safeParse({ eventId: EVENT_ID, guests: [{ ...row, contactId: 'nope' }] }).success).toBe(false);
  });
});

describe('addGuest · contact link verification', () => {
  it('a verified id is inserted as contact_id', async () => {
    const fake = makeClient({ contacts: [{ id: CONTACT_ID, full_name: 'Juri Braakman' }] });
    (createClient as Mock).mockResolvedValue(fake.client);

    await expect(addGuest({ ...base, contactId: CONTACT_ID })).resolves.toEqual({ ok: true });
    expect(fake.inserted[0]).toMatchObject({ contact_id: CONTACT_ID, full_name: 'Juri Braakman' });
    // Scoped to the EVENT's venue, queried with the guest's own name.
    expect(fake.rpcCalls).toEqual([{ p_venue_id: VENUE_ID, p_query: 'juri braakman' }]);
  });

  it('an id the venue lookup does not return is refused (cross-venue / forged)', async () => {
    const fake = makeClient({ contacts: [{ id: CONTACT_ID, full_name: 'Juri Braakman' }] });
    (createClient as Mock).mockResolvedValue(fake.client);

    const res = await addGuest({ ...base, contactId: OTHER_CONTACT_ID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toBe("Couldn't link the contact.");
    expect(fake.inserted).toHaveLength(0);
  });

  it('an id belonging to a DIFFERENT name at the same venue is refused', async () => {
    const fake = makeClient({ contacts: [{ id: CONTACT_ID, full_name: 'Noor de Wit' }] });
    (createClient as Mock).mockResolvedValue(fake.client);

    const res = await addGuest({ ...base, contactId: CONTACT_ID });
    expect(res.ok).toBe(false);
    expect(fake.inserted).toHaveLength(0);
  });

  it('two same-name contacts still verify the id the user picked', async () => {
    const fake = makeClient({
      contacts: [
        { id: CONTACT_ID, full_name: 'Juri Braakman' },
        { id: OTHER_CONTACT_ID, full_name: 'Juri Braakman' },
      ],
    });
    (createClient as Mock).mockResolvedValue(fake.client);
    await expect(addGuest({ ...base, contactId: OTHER_CONTACT_ID })).resolves.toEqual({ ok: true });
  });

  it('an event the caller cannot see resolves no venue -> refused, no insert', async () => {
    const fake = makeClient({ venueId: null });
    (createClient as Mock).mockResolvedValue(fake.client);

    const res = await addGuest({ ...base, contactId: CONTACT_ID });
    expect(res.ok).toBe(false);
    expect(fake.inserted).toHaveLength(0);
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it('a failing lookup fails CLOSED (no link is better than a wrong link)', async () => {
    const fake = makeClient({ rpcError: true });
    (createClient as Mock).mockResolvedValue(fake.client);

    const res = await addGuest({ ...base, contactId: CONTACT_ID });
    expect(res.ok).toBe(false);
    expect(fake.inserted).toHaveLength(0);
  });

  it('no contactId -> no lookup at all, and no contact_id on the row', async () => {
    const fake = makeClient();
    (createClient as Mock).mockResolvedValue(fake.client);

    await expect(addGuest(base)).resolves.toEqual({ ok: true });
    expect(fake.rpcCalls).toHaveLength(0);
    expect(fake.inserted[0]).not.toHaveProperty('contact_id');
  });
});

describe('addGuestsBulk · contact link verification', () => {
  const bulk = (guests: Array<Record<string, unknown>>) => ({
    eventId: EVENT_ID,
    source: 'app' as const,
    guests: guests.map((g) => ({ tierId: TIER_ID, plusOnes: 0, ...g })) as never,
  });

  it('verifies once per distinct name and inserts every verified link', async () => {
    const fake = makeClient({
      contacts: [
        { id: CONTACT_ID, full_name: 'Juri Braakman' },
        { id: OTHER_CONTACT_ID, full_name: 'Noor de Wit' },
      ],
    });
    (createClient as Mock).mockResolvedValue(fake.client);

    await expect(
      addGuestsBulk(
        bulk([
          { fullName: 'Juri Braakman', contactId: CONTACT_ID },
          { fullName: 'juri  braakman', contactId: CONTACT_ID },
          { fullName: 'Noor de Wit', contactId: OTHER_CONTACT_ID },
          { fullName: 'Sem Aaltink' },
        ]),
      ),
    ).resolves.toEqual({ ok: true });

    // Two distinct linked names -> two lookups, not four.
    expect(fake.rpcCalls.map((c) => c.p_query).sort()).toEqual(['juri braakman', 'noor de wit']);
    const rows = fake.inserted[0] as Array<Record<string, unknown>>;
    expect(rows[0].contact_id).toBe(CONTACT_ID);
    expect(rows[1].contact_id).toBe(CONTACT_ID);
    expect(rows[2].contact_id).toBe(OTHER_CONTACT_ID);
    expect(rows[3]).not.toHaveProperty('contact_id');
  });

  it('one bad id fails the whole batch — nothing is inserted', async () => {
    const fake = makeClient({ contacts: [{ id: CONTACT_ID, full_name: 'Juri Braakman' }] });
    (createClient as Mock).mockResolvedValue(fake.client);

    const res = await addGuestsBulk(
      bulk([
        { fullName: 'Juri Braakman', contactId: CONTACT_ID },
        { fullName: 'Noor de Wit', contactId: OTHER_CONTACT_ID },
      ]),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toBe("Couldn't link the contact.");
    expect(fake.inserted).toHaveLength(0);
  });

  it('a paste with no links does no lookups (unchanged hot path)', async () => {
    const fake = makeClient();
    (createClient as Mock).mockResolvedValue(fake.client);

    await expect(addGuestsBulk(bulk([{ fullName: 'Sem Aaltink' }]))).resolves.toEqual({ ok: true });
    expect(fake.rpcCalls).toHaveLength(0);
  });
});
