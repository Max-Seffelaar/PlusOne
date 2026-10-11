/**
 * Guest-mail job (Gastcommunicatie F): token gate, claim payload parsing,
 * the outgoing mail (per-mail sender, reply-to, one-click unsubscribe) and
 * settle bookkeeping. The DB side (claim re-checks, opt-out, budgets, settle
 * retries) is proven in pgTAP (guest_mail.test.sql); here the RPCs are mocked.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: vi.fn() }) }));
vi.mock('./config', () => ({
  guestMailActive: () => true,
  MAIL_DOMAIN: 'plus-one.io',
  MAIL_FROM: 'PlusOne <noreply@plus-one.io>',
  mailConfig: { resendEnabled: false, apiKey: null, webhookSecret: null },
  teamMailActive: () => true,
}));

import {
  buildGuestMail,
  drainGuestMails,
  parseClaimedMail,
  runGuestMailsRoute,
  type GuestMailDeps,
} from './guest-job';
import type { OutgoingMail, SendResult } from './provider';

const STATUS = 'A'.repeat(43);
const UNSUB = 'B'.repeat(43);
const REPLY = 'c'.repeat(40);

function claimed(over: Record<string, unknown> = {}) {
  return {
    queue_id: '01a12200-0000-7000-8000-000000000001',
    mail_log_id: '01a12200-0000-7000-8000-0000000000a1',
    type: 'guest_on_list',
    to: 'lotte@example.test',
    first_name: 'Lotte',
    remark: null,
    event: {
      id: 'ee000000-0000-7000-8000-000000000001',
      name: 'Neon Friday',
      starts_at: '2026-10-17T21:00:00Z',
      ends_at: '2026-10-18T03:00:00Z',
      location_name: 'Club Vesper',
      location_address: 'Keizersgracht 1',
      house_rules: null,
      updated_at: '2026-10-09T10:00:00Z',
    },
    company: { name: 'Vesper Group', contact_email: 'hi@vesper.test' },
    spot: { plus_ones: 1, tier_name: 'Guest', price_cents: 1500 },
    plus_ones: 1,
    asked_people: null,
    links: { status: STATUS, unsubscribe: UNSUB, reply: REPLY },
    ...over,
  };
}

function deps(over: Partial<GuestMailDeps> = {}) {
  const sent: OutgoingMail[][] = [];
  const rpc = vi.fn(async (fn: string) => {
    if (fn === 'guest_mails_begin' || fn === 'guest_mails_claim') {
      return { data: { now: '2026-10-09T12:00:00Z', mails: [claimed()] }, error: null };
    }
    return { data: 1, error: null };
  });
  const sendBatch = vi.fn(async (mails: OutgoingMail[]): Promise<SendResult[]> => {
    sent.push(mails);
    return mails.map((_, i) => ({ ok: true, providerMessageId: `re_${i}` }));
  });
  const d: GuestMailDeps = { rpc, sendBatch, active: true, appUrl: 'https://app.plus-one.io', ...over };
  return { d, rpc, sendBatch, sent };
}

describe('parseClaimedMail', () => {
  it('accepts a well-formed row and joins the event location', () => {
    const m = parseClaimedMail(claimed());
    expect(m?.event.location).toBe('Club Vesper, Keizersgracht 1');
    expect(m?.spot).toEqual({ plusOnes: 1, tierName: 'Guest', priceCents: 1500 });
  });

  it('refuses malformed rows (never mailed)', () => {
    expect(parseClaimedMail(claimed({ to: 'not-an-address' }))).toBeNull();
    expect(parseClaimedMail(claimed({ to: 'a@b.c\r\nBcc: x@y.z' }))).toBeNull();
    expect(parseClaimedMail(claimed({ type: 'team_join' }))).toBeNull();
    expect(parseClaimedMail(claimed({ company: { name: 'X', contact_email: null } }))).toBeNull();
    expect(parseClaimedMail(claimed({ links: { status: STATUS, unsubscribe: 'short', reply: REPLY } }))).toBeNull();
    expect(parseClaimedMail(claimed({ links: { status: STATUS, unsubscribe: UNSUB, reply: 'not-hex' } }))).toBeNull();
    expect(parseClaimedMail(null)).toBeNull();
  });
});

describe('buildGuestMail', () => {
  it('sends as "{event} via PlusOne" from a per-mail noreply+key, reply-to the company', () => {
    const m = buildGuestMail(parseClaimedMail(claimed())!, 'https://app.plus-one.io/');
    expect(m.from).toBe(`"Neon Friday via PlusOne" <noreply+${REPLY}@plus-one.io>`);
    expect(m.replyTo).toBe('hi@vesper.test');
    expect(m.idempotencyKey).toBe('mail_log/01a12200-0000-7000-8000-0000000000a1');
    expect(m.headers).toEqual({
      'List-Unsubscribe': `<https://app.plus-one.io/u/${UNSUB}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(m.html).toContain(`https://app.plus-one.io/s/${STATUS}`);
    expect(m.html).toContain(`https://app.plus-one.io/s/${STATUS}/calendar.ics`);
    expect(m.text).toContain('Guest · You +1 (2 people)');
  });

  it('a mail without a status token has no status button and no calendar', () => {
    const m = buildGuestMail(
      parseClaimedMail(claimed({ type: 'guest_removed', spot: null, plus_ones: 2, remark: 'Sorry.', links: { status: null, unsubscribe: UNSUB, reply: REPLY } }))!,
      'https://app.plus-one.io',
    );
    expect(m.html).not.toContain('/s/');
    expect(m.text).toContain('Your +2 are off the list too.');
  });
});

// z8uq9m2vga: the claim lists every part of a split request decision.
describe('tiers from the claim (Requests E)', () => {
  const split = {
    type: 'guest_request_partly',
    remark: 'We could fit three of you.',
    asked_people: 4,
    spot: { plus_ones: 1, tier_name: 'Regular', price_cents: null },
    tiers: [
      { tier_name: 'Regular', people: 2, price_cents: null },
      { tier_name: 'VIP', people: 1, price_cents: null },
    ],
  };

  it('parses the tiers and the partly mail names every part and the real total', () => {
    const mail = parseClaimedMail(claimed(split))!;
    expect(mail.tiers).toEqual([
      { name: 'Regular', people: 2, priceCents: null },
      { name: 'VIP', people: 1, priceCents: null },
    ]);
    const out = buildGuestMail(mail, 'https://app.plus-one.io');
    expect(out.subject).toBe('On the list for Neon Friday: 3 people');
    expect(out.text).toContain('so your spot covers 3 people.');
    expect(out.text).toContain('Your spot: 3 people');
    expect(out.text).toContain('Regular: 2 people');
    expect(out.text).toContain('VIP: 1 person');
  });

  it('without tiers (an older claim) the one spot is rendered as before', () => {
    const mail = parseClaimedMail(claimed())!;
    expect(mail.tiers).toBeNull();
    expect(buildGuestMail(mail, 'https://app.plus-one.io').text).toContain('Guest · You +1 (2 people)');
  });

  it('a malformed tier entry fails the row closed (never mailed)', () => {
    expect(parseClaimedMail(claimed({ ...split, tiers: [{ tier_name: 'VIP', people: 0 }] }))).toBeNull();
    expect(parseClaimedMail(claimed({ ...split, tiers: [{ people: 2 }] }))).toBeNull();
  });
});

describe('runGuestMailsRoute', () => {
  it('refuses a missing or malformed token before any RPC', async () => {
    const { d, rpc } = deps();
    expect(await runGuestMailsRoute(null, d)).toEqual({ status: 401, error: 'invalid_token' });
    expect(await runGuestMailsRoute('nope', d)).toEqual({ status: 401, error: 'invalid_token' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a refused (reused/expired) token is 401 and sends nothing', async () => {
    const { d, sendBatch } = deps({
      rpc: vi.fn(async () => ({ data: null, error: { code: '42501' } })),
    });
    expect(await runGuestMailsRoute('a'.repeat(64), d)).toEqual({ status: 401, error: 'invalid_token' });
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('inactive mail: the token is spent, nothing is claimed or sent', async () => {
    const { d, rpc, sendBatch } = deps({ active: false });
    expect(await runGuestMailsRoute('a'.repeat(64), d)).toEqual({ status: 503, error: 'mail_not_configured' });
    expect(rpc).toHaveBeenCalledWith('guest_mails_begin', { p_token: 'a'.repeat(64), p_limit: 0 });
    expect(sendBatch).not.toHaveBeenCalled();
  });

  it('sends the claimed mails in one batch and settles each', async () => {
    const { d, rpc, sent } = deps();
    const res = await runGuestMailsRoute('a'.repeat(64), d);
    expect(res).toEqual({ status: 200, totals: { claimed: 1, sent: 1, failed: 0 } });
    expect(sent).toHaveLength(1);
    expect(rpc).toHaveBeenLastCalledWith('guest_mails_settle', {
      p_results: [{ queue_id: '01a12200-0000-7000-8000-000000000001', ok: true, provider_message_id: 're_0' }],
    });
  });
});

describe('drainGuestMails', () => {
  it('splits 250 mails into batches of 100 and pauses between them', async () => {
    const mails = Array.from({ length: 250 }, (_, i) =>
      claimed({
        queue_id: `01a12200-0000-7000-8000-${String(i).padStart(12, '0')}`,
        mail_log_id: `01a12200-0000-7000-9000-${String(i).padStart(12, '0')}`,
      }),
    );
    const pause = vi.fn(async () => undefined);
    const { d, sent } = deps({
      pause,
      rpc: vi.fn(async (fn: string) =>
        fn === 'guest_mails_claim' ? { data: { mails }, error: null } : { data: 1, error: null },
      ),
    });
    const totals = await drainGuestMails(d);
    expect(totals).toEqual({ claimed: 250, sent: 250, failed: 0 });
    expect(sent.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('a malformed row is settled as failed, the rest still goes', async () => {
    const { d, sent } = deps({
      rpc: vi.fn(async (fn: string) =>
        fn === 'guest_mails_claim'
          ? { data: { mails: [claimed(), claimed({ queue_id: '01a12200-0000-7000-8000-0000000000ff', to: 'bad' })] }, error: null }
          : { data: 1, error: null },
      ),
    });
    const totals = await drainGuestMails(d);
    expect(totals).toEqual({ claimed: 2, sent: 1, failed: 1 });
    expect(sent[0]).toHaveLength(1);
    const settle = ((d.rpc as ReturnType<typeof vi.fn>).mock.calls as unknown as Array<[string, { p_results: unknown[] }]>).find((c) => c[0] === 'guest_mails_settle');
    expect(settle?.[1].p_results).toContainEqual({ queue_id: '01a12200-0000-7000-8000-0000000000ff', ok: false, error_code: 'malformed' });
  });

  it('a provider failure settles every mail of the batch as failed with its code', async () => {
    const { d, rpc } = deps({
      sendBatch: vi.fn(async (mails: OutgoingMail[]) => mails.map(() => ({ ok: false as const, errorCode: 'daily_quota_exceeded' as const }))),
    });
    const totals = await drainGuestMails(d);
    expect(totals.failed).toBe(1);
    expect(rpc).toHaveBeenLastCalledWith('guest_mails_settle', {
      p_results: [{ queue_id: '01a12200-0000-7000-8000-000000000001', ok: false, error_code: 'daily_quota_exceeded' }],
    });
  });

  it('does nothing when guest mail is not active', async () => {
    const { d, rpc } = deps({ active: false });
    expect(await drainGuestMails(d)).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });
});
