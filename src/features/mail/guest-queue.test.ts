/**
 * Guest-mail hooks (guest-queue.ts): the enqueue RPCs run in after(), on the
 * service client, with the client as `this` (supabase-js' rpc reads
 * this.rest: a detached rpc throws a TypeError inside after(), where nobody
 * sees it but the log). Also: nothing at all happens when guest mail is off.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  active: true,
  calls: [] as Array<{ fn: string; args: Record<string, unknown>; bound: boolean }>,
  drained: 0,
  pending: [] as Array<() => Promise<unknown>>,
}));

vi.mock('next/server', () => ({ after: (cb: () => Promise<unknown>) => H.pending.push(cb) }));
vi.mock('./config', () => ({ guestMailActive: () => H.active }));
vi.mock('./guest-job', () => ({
  defaultGuestMailDeps: () => ({}),
  drainGuestMails: async () => {
    H.drained += 1;
    return { claimed: 0, sent: 0, failed: 0 };
  },
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    const client = {
      marker: 'service-client',
      rpc(this: { marker?: string } | undefined, fn: string, args: Record<string, unknown>) {
        H.calls.push({ fn, args, bound: this?.marker === 'service-client' });
        return Promise.resolve({ data: null, error: null });
      },
    };
    return client;
  },
}));

import { queueEventMail, queueGuestMails, queueRequestDeclinedMail } from './guest-queue';

async function flush(): Promise<void> {
  while (H.pending.length) await H.pending.shift()!();
}

beforeEach(() => {
  H.active = true;
  H.calls = [];
  H.drained = 0;
  H.pending = [];
});

describe('guest-queue', () => {
  it('per-guest mails: one bound enqueue per guest, debounce for +N, then one drain', async () => {
    queueGuestMails(
      [
        { type: 'guest_on_list', guestId: 'g1' },
        { type: 'guest_plus_ones', guestId: 'g2' },
        { type: 'guest_removed', guestId: 'g3', remark: 'Full.' },
      ],
      'u1',
    );
    expect(H.calls).toHaveLength(0); // nothing in the request path
    await flush();
    expect(H.calls.every((c) => c.bound)).toBe(true);
    expect(H.calls.map((c) => [c.fn, c.args.p_type, c.args.p_delay_seconds])).toEqual([
      ['enqueue_guest_mail', 'guest_on_list', 0],
      ['enqueue_guest_mail', 'guest_plus_ones', 60],
      ['enqueue_guest_mail', 'guest_removed', 0],
    ]);
    expect(H.calls[2].args.p_remark).toBe('Full.');
    expect(H.drained).toBe(1);
  });

  it('event and decline mails are bound too', async () => {
    queueEventMail({ type: 'guest_event_changed', eventId: 'e1' }, 'u1');
    queueRequestDeclinedMail('r1', 'Sorry.', 'u1');
    await flush();
    expect(H.calls.map((c) => [c.fn, c.bound])).toEqual([
      ['enqueue_event_mail', true],
      ['enqueue_request_declined_mail', true],
    ]);
    expect(H.calls[0].args.p_delay_seconds).toBe(120);
  });

  it('guest mail off: nothing is scheduled at all', async () => {
    H.active = false;
    queueGuestMails([{ type: 'guest_on_list', guestId: 'g1' }], 'u1');
    queueEventMail({ type: 'guest_reminder', eventId: 'e1' }, 'u1');
    expect(H.pending).toHaveLength(0);
  });
});
