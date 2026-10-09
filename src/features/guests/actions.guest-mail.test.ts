/**
 * Guest mail hooks in the guest actions (Gastcommunicatie F): which mutation
 * queues which mail, and when nothing is queued. queueGuestMails itself (and
 * the enqueue RPC's re-checks) are tested elsewhere; here it is a spy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  queue: vi.fn(),
  active: true,
  insert: vi.fn(),
  update: vi.fn(),
  guestRow: { email: 'lotte@example.test', status: 'approved', plus_ones: 1 } as Record<string, unknown> | null,
}));

vi.mock('@/features/mail/guest-queue', () => ({ queueGuestMails: H.queue }));
vi.mock('@/features/mail/config', () => ({ guestMailActive: () => H.active }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      insert: (rows: unknown) => {
        H.insert(rows);
        return Promise.resolve({ error: null });
      },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: H.guestRow }) }) }),
      update: (patch: unknown) => {
        H.update(patch);
        return { eq: async () => ({ error: null, count: 1 }) };
      },
    }),
  })),
}));

import { addGuest, addGuestsBulk, removeGuest, updateGuest } from './actions';

const EVENT = 'ee000000-0000-7000-8000-000000000001';
const TIER = 'ee000000-0000-7000-8000-0000000000a1';
const GUEST = 'ee000000-0000-7000-8000-0000000000b1';

beforeEach(() => {
  H.queue.mockReset();
  H.insert.mockReset();
  H.update.mockReset();
  H.active = true;
  H.guestRow = { email: 'lotte@example.test', status: 'approved', plus_ones: 1 };
});

describe('addGuest', () => {
  it('ticked box + address: queues "You\'re on the list" for the inserted row', async () => {
    await addGuest({ eventId: EVENT, tierId: TIER, fullName: 'Lotte', email: 'lotte@example.test', sendConfirmation: true });
    const row = H.insert.mock.calls[0][0] as { id: string };
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(H.queue).toHaveBeenCalledWith([{ type: 'guest_on_list', guestId: row.id }], 'u1');
  });

  it('no box, no address, or a door add: nothing queued', async () => {
    await addGuest({ eventId: EVENT, tierId: TIER, fullName: 'A', email: 'a@example.test' });
    await addGuest({ eventId: EVENT, tierId: TIER, fullName: 'B', sendConfirmation: true });
    await addGuest({ eventId: EVENT, tierId: TIER, fullName: 'C', email: 'c@example.test', source: 'door', sendConfirmation: true });
    expect(H.queue).not.toHaveBeenCalled();
  });
});

describe('addGuestsBulk', () => {
  it('queues only the rows with an address', async () => {
    await addGuestsBulk({
      eventId: EVENT,
      sendConfirmation: true,
      guests: [
        { tierId: TIER, fullName: 'A', email: 'a@example.test' },
        { tierId: TIER, fullName: 'B' },
      ],
    });
    const rows = H.insert.mock.calls[0][0] as Array<{ id: string }>;
    expect(H.queue).toHaveBeenCalledWith([{ type: 'guest_on_list', guestId: rows[0].id }], 'u1');
  });
});

describe('updateGuest', () => {
  it('a real +N change queues the plus-ones mail; the same value does not', async () => {
    await updateGuest({ guestId: GUEST, plusOnes: 3 });
    expect(H.queue).toHaveBeenCalledWith([{ type: 'guest_plus_ones', guestId: GUEST }], 'u1');
    H.queue.mockReset();
    await updateGuest({ guestId: GUEST, plusOnes: 1 });
    expect(H.queue).not.toHaveBeenCalled();
  });
});

describe('removeGuest', () => {
  it('a guest with an address needs a note, and the note goes in the mail', async () => {
    const missing = await removeGuest({ guestId: GUEST });
    expect(missing.ok).toBe(false);
    expect(H.update).not.toHaveBeenCalled();
    await removeGuest({ guestId: GUEST, note: 'The list is full.' });
    expect(H.update).toHaveBeenCalledWith({ status: 'removed' });
    expect(H.queue).toHaveBeenCalledWith([{ type: 'guest_removed', guestId: GUEST, remark: 'The list is full.' }], 'u1');
  });

  it('a guest without an address is removed without a note and without mail', async () => {
    H.guestRow = { email: null, status: 'approved' };
    expect((await removeGuest(GUEST)).ok).toBe(true);
    expect(H.queue).not.toHaveBeenCalled();
  });

  it('guest mail off: no note needed, nothing queued', async () => {
    H.active = false;
    expect((await removeGuest(GUEST)).ok).toBe(true);
    expect(H.queue).not.toHaveBeenCalled();
  });
});
