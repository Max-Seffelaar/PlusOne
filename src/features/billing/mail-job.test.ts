/**
 * Billing-mail job core (z8uq9m2z19). The RPCs are mocked here; the database
 * side (token consumption, recipient/role re-check, once per company per
 * trial type, once per Stripe event, comped/paused) is proven in pgTAP
 * (supabase/tests/database/billing_mails.test.sql).
 */
import { describe, expect, it, vi } from 'vitest';
import { parseBegin, runBillingMails, type BillingMailDeps, type RpcResult } from './mail-job';

const TOKEN = 'a'.repeat(64);
const V1 = '0199a000-0000-7000-8000-000000000001';
const V2 = '0199a000-0000-7000-8000-000000000002';
const U1 = '0199b000-0000-7000-8000-000000000001';
const U2 = '0199b000-0000-7000-8000-000000000002';
const NOW = '2026-10-15T09:00:00.000Z';
const D = 86_400_000;

type Handler = (args: Record<string, unknown>) => RpcResult | Promise<RpcResult>;

function makeDeps(handlers: Record<string, Handler>, over: Partial<BillingMailDeps> = {}) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const sent: Parameters<BillingMailDeps['send']>[0][] = [];
  let logSeq = 0;
  const defaults: Record<string, Handler> = {
    billing_mail_recipients: () => ({
      data: {
        company: 'Club Vesper',
        recipients: [
          { id: U1, email: 'admin@vesper.test', first_name: 'Sanne' },
          { id: U2, email: 'finance@vesper.test', first_name: null },
        ],
      },
      error: null,
    }),
    log_billing_mail: () => ({ data: `0199c000-0000-7000-8000-00000000000${++logSeq}`, error: null }),
    record_mail_send_result: () => ({ data: true, error: null }),
  };
  const deps: BillingMailDeps = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push([fn, args]);
      const h = handlers[fn] ?? defaults[fn];
      if (!h) throw new Error(`unexpected rpc ${fn}`);
      return h(args);
    }),
    send: vi.fn(async (mail) => {
      sent.push(mail);
      return { ok: true as const, providerMessageId: `msg_${sent.length}` };
    }),
    active: true,
    appUrl: 'https://app.plus-one.io',
    log: () => undefined,
    ...over,
  };
  return { deps, calls, sent };
}

function begin(trials: unknown[] = [], events: unknown[] = []): Handler {
  return () => ({ data: { now: NOW, trials, events }, error: null });
}

/** A trial whose effective end lies `endOffsetDays` from NOW. */
function trialEndingIn(venueId: string, endOffsetDays: number, over: Record<string, unknown> = {}) {
  const end = Date.parse(NOW) + endOffsetDays * D - 3_600_000; // moment 1 h before NOW
  return {
    venue_id: venueId,
    created_at: new Date(end - 14 * D).toISOString(),
    trial_ends_at: new Date(end).toISOString(),
    stripe_linked: false,
    ...over,
  };
}

describe('runBillingMails: authentication', () => {
  it('refuses a missing or malformed token without any database call', async () => {
    const { deps } = makeDeps({});
    for (const token of [null, '', 'abc', 'A'.repeat(64), `${TOKEN}0`]) {
      expect(await runBillingMails(token, deps)).toEqual({ status: 401, error: 'invalid_token' });
    }
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it('a token the database refuses (42501) is a 401 and nothing else happens', async () => {
    const { deps, calls } = makeDeps({
      billing_mails_begin: () => ({ data: null, error: { code: '42501', message: 'not authorized' } }),
    });
    expect(await runBillingMails(TOKEN, deps)).toEqual({ status: 401, error: 'invalid_token' });
    expect(calls.map((c) => c[0])).toEqual(['billing_mails_begin']);
    expect(deps.send).not.toHaveBeenCalled();
  });

  it('without a mail transport: 503 after auth, no mail_log row written', async () => {
    const { deps, calls } = makeDeps({ billing_mails_begin: begin([trialEndingIn(V1, 7)]) }, { active: false });
    expect(await runBillingMails(TOKEN, deps)).toEqual({ status: 503, error: 'mail_not_configured' });
    expect(calls.map((c) => c[0])).toEqual(['billing_mails_begin']);
  });

  it('a malformed begin payload mails nothing', async () => {
    const { deps } = makeDeps({ billing_mails_begin: () => ({ data: { now: NOW, trials: [{ venue_id: 'x' }], events: [] }, error: null }) });
    expect(await runBillingMails(TOKEN, deps)).toEqual({ status: 502, error: 'rpc_failed' });
    expect(deps.send).not.toHaveBeenCalled();
  });
});

describe('runBillingMails: trial mails', () => {
  it('one due type per company -> one mail per recipient, keyed by the type', async () => {
    const { deps, calls, sent } = makeDeps({
      billing_mails_begin: begin([trialEndingIn(V1, 7), trialEndingIn(V2, 2)]),
    });
    const res = await runBillingMails(TOKEN, deps);
    expect(res).toEqual({ status: 200, totals: { mails: 2, sent: 4, skipped: 0, failed: 0 } });
    const logs = calls.filter((c) => c[0] === 'log_billing_mail').map((c) => c[1]);
    expect(logs).toEqual([
      { p_venue_id: V1, p_type: 'billing_trial_day7', p_dedupe_key: 'billing_trial_day7', p_recipient_id: U1 },
      { p_venue_id: V1, p_type: 'billing_trial_day7', p_dedupe_key: 'billing_trial_day7', p_recipient_id: U2 },
      { p_venue_id: V2, p_type: 'billing_trial_day12', p_dedupe_key: 'billing_trial_day12', p_recipient_id: U1 },
      { p_venue_id: V2, p_type: 'billing_trial_day12', p_dedupe_key: 'billing_trial_day12', p_recipient_id: U2 },
    ]);
    expect(sent.map((m) => m.to)).toEqual([
      'admin@vesper.test',
      'finance@vesper.test',
      'admin@vesper.test',
      'finance@vesper.test',
    ]);
    expect(sent[0]).toMatchObject({
      subject: 'Keep PlusOne after 22 October?',
      type: 'billing_trial_day7',
      from: 'PlusOne <support@plus-one.io>',
      replyTo: 'support@plus-one.io',
      idempotencyKey: 'mail_log/0199c000-0000-7000-8000-000000000001',
    });
    expect(sent[1].text).toContain('Hi there,');
  });

  it('a second run (log_billing_mail returns NULL) sends nothing', async () => {
    const { deps, sent } = makeDeps({
      billing_mails_begin: begin([trialEndingIn(V1, 7)]),
      log_billing_mail: () => ({ data: null, error: null }),
    });
    const res = await runBillingMails(TOKEN, deps);
    expect(res).toEqual({ status: 200, totals: { mails: 1, sent: 0, skipped: 2, failed: 0 } });
    expect(sent).toEqual([]);
  });

  it('a company between mail moments gets nothing (no catch-up)', async () => {
    const { deps, calls } = makeDeps({ billing_mails_begin: begin([trialEndingIn(V1, 6), trialEndingIn(V1, 1)]) });
    const res = await runBillingMails(TOKEN, deps);
    expect(res).toEqual({ status: 200, totals: { mails: 0, sent: 0, skipped: 0, failed: 0 } });
    expect(calls.map((c) => c[0])).toEqual(['billing_mails_begin']);
  });

  it('a Stripe-linked trial only ever gets the welcome mail', async () => {
    const { deps, sent } = makeDeps({
      billing_mails_begin: begin([trialEndingIn(V1, 7, { stripe_linked: true })]),
    });
    await runBillingMails(TOKEN, deps);
    expect(sent).toEqual([]);
  });

  it('a recipient refused by the database (42501: role gone, paused) is skipped, the rest go', async () => {
    const { deps, sent } = makeDeps({
      billing_mails_begin: begin([trialEndingIn(V1, 0)]),
      log_billing_mail: (a) =>
        a.p_recipient_id === U1
          ? { data: null, error: { code: '42501', message: 'not a billing recipient' } }
          : { data: '0199c000-0000-7000-8000-0000000000aa', error: null },
    });
    const res = await runBillingMails(TOKEN, deps);
    expect(res).toEqual({ status: 200, totals: { mails: 1, sent: 1, skipped: 1, failed: 0 } });
    expect(sent.map((m) => [m.to, m.type])).toEqual([['finance@vesper.test', 'billing_trial_ended']]);
  });
});

describe('runBillingMails: Stripe mails', () => {
  it('one mail per queued event, keyed stripe:<event id>, Stripe-invoices line in the footer', async () => {
    const { deps, calls, sent } = makeDeps({
      billing_mails_begin: begin(
        [],
        [
          { stripe_event_id: 'evt_1', venue_id: V1, type: 'billing_payment_failed' },
          { stripe_event_id: 'evt_2', venue_id: V1, type: 'billing_payment_failed' },
          { stripe_event_id: 'evt_3', venue_id: V2, type: 'billing_canceled' },
        ]
      ),
    });
    const res = await runBillingMails(TOKEN, deps);
    expect(res).toEqual({ status: 200, totals: { mails: 3, sent: 6, skipped: 0, failed: 0 } });
    expect(calls.filter((c) => c[0] === 'log_billing_mail').map((c) => c[1].p_dedupe_key)).toEqual([
      'stripe:evt_1',
      'stripe:evt_1',
      'stripe:evt_2',
      'stripe:evt_2',
      'stripe:evt_3',
      'stripe:evt_3',
    ]);
    expect(sent[0].text).toContain('Stripe sends your invoices separately.');
    expect(sent[4].subject).toBe('Your PlusOne subscription has ended');
  });
});

describe('runBillingMails: send failures', () => {
  it('a provider failure settles the row as failed with the machine code only', async () => {
    const { deps, calls } = makeDeps(
      { billing_mails_begin: begin([trialEndingIn(V1, 7)]) },
      { send: vi.fn(async () => ({ ok: false as const, errorCode: 'daily_quota_exceeded' as const })) }
    );
    const res = await runBillingMails(TOKEN, deps);
    expect(res).toEqual({ status: 200, totals: { mails: 1, sent: 0, skipped: 0, failed: 2 } });
    const settles = calls.filter((c) => c[0] === 'record_mail_send_result').map((c) => c[1]);
    expect(settles[0]).toMatchObject({ p_status: 'failed', p_error_code: 'daily_quota_exceeded' });
  });

  it('a throwing provider counts as failed and never throws out of the run', async () => {
    const { deps } = makeDeps(
      { billing_mails_begin: begin([trialEndingIn(V1, 7)]) },
      { send: vi.fn(async () => { throw new Error('boom'); }) }
    );
    const res = await runBillingMails(TOKEN, deps);
    expect(res).toEqual({ status: 200, totals: { mails: 1, sent: 0, skipped: 0, failed: 2 } });
  });

  it('never logs an address, a name or the token', async () => {
    const lines: string[] = [];
    const { deps } = makeDeps(
      {
        billing_mails_begin: begin([trialEndingIn(V1, 7)]),
        log_billing_mail: () => ({ data: null, error: { code: 'XX000', message: 'admin@vesper.test boom' } }),
      },
      { log: (e, f) => lines.push(JSON.stringify({ e, ...f })) }
    );
    await runBillingMails(TOKEN, deps);
    const all = lines.join('\n');
    expect(all).not.toContain('@');
    expect(all).not.toContain('Sanne');
    expect(all).not.toContain(TOKEN);
  });
});

describe('parseBegin', () => {
  it('rejects an unknown event type', () => {
    expect(
      parseBegin({ now: NOW, trials: [], events: [{ stripe_event_id: 'evt', venue_id: V1, type: 'billing_trial_day7' }] })
    ).toBeNull();
  });
});
