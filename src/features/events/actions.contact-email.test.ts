/**
 * The event contact address in the event actions (guest mail 6c): required on
 * create (blank and from a template), never cleared by a save, the domain
 * checked server-side (a refused domain writes nothing), and an unchanged
 * address not looked up again. Supabase and DNS are fakes.
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const H = vi.hoisted(() => ({
  domain: 'ok' as 'ok' | 'no_mail_domain',
  checked: [] as string[],
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/context', () => ({ getAuthContext: vi.fn(), getMyProfile: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/features/billing/gate', () => ({ assertVenueBillingActive: vi.fn(async () => null) }));
vi.mock('@/features/mail/guest-queue', () => ({ queueEventMail: vi.fn() }));
vi.mock('./mail-domain', () => ({
  checkMailDomain: vi.fn(async (email: string) => {
    H.checked.push(email);
    return H.domain;
  }),
}));

import { createEvent, createEventFromTemplate, updateEvent } from './actions';
import { createClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth/context';
import { t } from '@/lib/i18n';

const VENUE = '00000000-0000-7000-8000-000000000001';
const EVENT = '00000000-0000-7000-8000-0000000000e1';
const TEMPLATE = '00000000-0000-7000-8000-0000000000a1';
const STARTS = '2026-10-16T21:00:00.000Z';

interface Op {
  table: string;
  kind: 'insert' | 'update' | 'select';
  values?: Record<string, unknown>;
}

/** A recording PostgREST fake: every chain resolves; `stored` is the event's current contact_email. */
function fakeClient(stored: { contact_email: string | null } | null) {
  const ops: Op[] = [];
  const rpc = vi.fn(async () => ({ data: EVENT, error: null }));
  const from = (table: string) => {
    let op: Op = { table, kind: 'select' };
    const chain = {
      insert(values: Record<string, unknown>) {
        op = { table, kind: 'insert', values };
        ops.push(op);
        return chain;
      },
      update(values: Record<string, unknown>) {
        op = { table, kind: 'update', values };
        ops.push(op);
        return chain;
      },
      select() {
        if (op.kind === 'select') ops.push(op);
        return chain;
      },
      eq() {
        return chain;
      },
      single: async () => ({ data: { id: EVENT }, error: null }),
      maybeSingle: async () => ({ data: table === 'event_templates' ? { venue_id: VENUE } : stored, error: null }),
      then: (resolve: (v: { error: null; count: number }) => unknown) => resolve({ error: null, count: 1 }),
    };
    return chain;
  };
  return { client: { from: vi.fn(from), rpc }, ops, rpc };
}

function writes(ops: Op[]): Op[] {
  return ops.filter((o) => o.kind !== 'select' && o.table === 'events');
}

beforeEach(() => {
  H.domain = 'ok';
  H.checked = [];
  (getAuthContext as Mock).mockResolvedValue({ user: { id: 'u1' } });
});

describe('createEvent', () => {
  it('writes the typed address, lower-cased, after the domain check', async () => {
    const f = fakeClient(null);
    (createClient as Mock).mockResolvedValue(f.client);
    const res = await createEvent({ venueId: VENUE, name: 'Night', startsAt: STARTS, contactEmail: ' Guests@Club.nl ' });
    expect(res.ok).toBe(true);
    expect(H.checked).toEqual(['guests@club.nl']);
    expect(writes(f.ops)[0].values).toMatchObject({ contact_email: 'guests@club.nl' });
  });

  it('without an address: refused, nothing written', async () => {
    const f = fakeClient(null);
    (createClient as Mock).mockResolvedValue(f.client);
    const res = await createEvent({ venueId: VENUE, name: 'Night', startsAt: STARTS } as never);
    expect(res.ok).toBe(false);
    expect(f.ops).toHaveLength(0);
  });

  it('a domain that takes no mail: the clear error, nothing written', async () => {
    H.domain = 'no_mail_domain';
    const f = fakeClient(null);
    (createClient as Mock).mockResolvedValue(f.client);
    const res = await createEvent({ venueId: VENUE, name: 'Night', startsAt: STARTS, contactEmail: 'a@nomail.invalid' });
    expect(res).toMatchObject({ ok: false, message: t.events.contactEmail.noDomain });
    expect(writes(f.ops)).toHaveLength(0);
  });
});

describe('createEventFromTemplate', () => {
  it('checks the domain before the RPC, then writes the address onto the new event', async () => {
    const f = fakeClient(null);
    (createClient as Mock).mockResolvedValue(f.client);
    const res = await createEventFromTemplate({ templateId: TEMPLATE, name: 'Night', startsAt: STARTS, contactEmail: 'night@club.nl' });
    expect(res).toMatchObject({ ok: true, eventId: EVENT, contactSaved: true });
    expect(writes(f.ops)).toEqual([{ table: 'events', kind: 'update', values: { contact_email: 'night@club.nl' } }]);
  });

  it('a refused domain stops before the RPC: no event is made', async () => {
    H.domain = 'no_mail_domain';
    const f = fakeClient(null);
    (createClient as Mock).mockResolvedValue(f.client);
    const res = await createEventFromTemplate({ templateId: TEMPLATE, name: 'Night', startsAt: STARTS, contactEmail: 'a@b.nl' });
    expect(res.ok).toBe(false);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it('is refused without an address (templates never carry one)', async () => {
    const f = fakeClient(null);
    (createClient as Mock).mockResolvedValue(f.client);
    const res = await createEventFromTemplate({ templateId: TEMPLATE, name: 'Night', startsAt: STARTS } as never);
    expect(res.ok).toBe(false);
    expect(f.rpc).not.toHaveBeenCalled();
  });
});

describe('updateEvent', () => {
  it('an older event without an address cannot be saved without one', async () => {
    const f = fakeClient({ contact_email: null });
    (createClient as Mock).mockResolvedValue(f.client);
    const res = await updateEvent({ eventId: EVENT, name: 'Renamed' });
    expect(res).toMatchObject({ ok: false, message: t.events.contactEmail.required });
    expect(writes(f.ops)).toHaveLength(0);
  });

  it('an event that has one saves without sending it again', async () => {
    const f = fakeClient({ contact_email: 'night@club.nl' });
    (createClient as Mock).mockResolvedValue(f.client);
    expect((await updateEvent({ eventId: EVENT, name: 'Renamed' })).ok).toBe(true);
    expect(H.checked).toEqual([]);
  });

  it('an unchanged address is not looked up again; a changed one is', async () => {
    const f = fakeClient({ contact_email: 'night@club.nl' });
    (createClient as Mock).mockResolvedValue(f.client);
    await updateEvent({ eventId: EVENT, contactEmail: 'Night@Club.nl' });
    expect(H.checked).toEqual([]);
    await updateEvent({ eventId: EVENT, contactEmail: 'promo@club.nl' });
    expect(H.checked).toEqual(['promo@club.nl']);
    expect(writes(f.ops).at(-1)?.values).toMatchObject({ contact_email: 'promo@club.nl' });
  });

  it('a changed address on a refused domain writes nothing', async () => {
    H.domain = 'no_mail_domain';
    const f = fakeClient({ contact_email: 'night@club.nl' });
    (createClient as Mock).mockResolvedValue(f.client);
    const res = await updateEvent({ eventId: EVENT, name: 'X', contactEmail: 'a@nomail.invalid' });
    expect(res).toMatchObject({ ok: false, message: t.events.contactEmail.noDomain });
    expect(writes(f.ops)).toHaveLength(0);
  });

  it('can never clear the address', async () => {
    const f = fakeClient({ contact_email: 'night@club.nl' });
    (createClient as Mock).mockResolvedValue(f.client);
    expect((await updateEvent({ eventId: EVENT, contactEmail: '' })).ok).toBe(false);
    expect(writes(f.ops)).toHaveLength(0);
  });
});
