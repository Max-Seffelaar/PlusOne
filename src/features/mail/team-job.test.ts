/**
 * Team notification mail job (guest mail 6b): token gate, claim payload
 * parsing, the outgoing mail (one-click unsubscribe, idempotency key) and the
 * settle bookkeeping (a bundled slot settles all its rows). The DB side
 * (fan-out, re-checks, digest, unsubscribe) is pgTAP team_mail.test.sql.
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

import { buildTeamMail, drainTeamMails, parseTeamMail, runTeamMailsRoute, type TeamMailDeps } from './team-job';
import type { OutgoingMail, SendResult } from './provider';

const TOKEN = 'T'.repeat(43);
const Q1 = '01a12200-0000-7000-8000-000000000001';
const Q2 = '01a12200-0000-7000-8000-000000000002';
const LOG = '01a12200-0000-7000-8000-0000000000a1';

function claimed(over: Record<string, unknown> = {}) {
  return {
    queue_ids: [Q1, Q2],
    mail_log_id: LOG,
    type: 'team_request',
    to: 'admin@vesper.test',
    first_name: 'Max',
    link: { token: TOKEN, pref: 'requests' },
    company: { id: 'aa', name: 'Club Vesper' },
    event: { id: 'ee000000-0000-7000-8000-000000000001', name: 'Neon Friday', starts_at: '2026-10-16T21:00:00Z' },
    count: 2,
    ...over,
  };
}

function deps(over: Partial<TeamMailDeps> = {}) {
  const sent: OutgoingMail[][] = [];
  const rpc = vi.fn(async (fn: string) => {
    if (fn === 'team_mails_claim' || fn === 'team_mails_begin') return { data: { mails: [claimed()] }, error: null };
    return { data: 1, error: null };
  });
  const d: TeamMailDeps = {
    rpc,
    sendBatch: vi.fn(async (mails: OutgoingMail[]): Promise<SendResult[]> => {
      sent.push(mails);
      return mails.map(() => ({ ok: true as const, providerMessageId: 're_1' }));
    }),
    active: true,
    appUrl: 'https://app.plus-one.io',
    ...over,
  };
  return { d, rpc, sent };
}

describe('parseTeamMail', () => {
  it('takes a well-formed entry', () => {
    const m = parseTeamMail(claimed());
    expect(m?.type).toBe('team_request');
    expect(m?.queueIds).toEqual([Q1, Q2]);
    expect(m?.count).toBe(2);
  });

  it('refuses anything off: unknown type, bad address, bad token, a digest without companies', () => {
    expect(parseTeamMail(claimed({ type: 'team_join' }))).toBeNull();
    expect(parseTeamMail(claimed({ to: 'a@b.c>, x@y.z' }))).toBeNull();
    expect(parseTeamMail(claimed({ link: { token: 'short', pref: 'requests' } }))).toBeNull();
    expect(parseTeamMail(claimed({ type: 'team_digest', event: null, digest: [] }))).toBeNull();
    expect(parseTeamMail(claimed({ queue_ids: ['not-a-uuid'] }))).toBeNull();
  });
});

describe('parseTeamMail: a bundle over more than one event (review #458 S3)', () => {
  it('takes a bundled request or quota mail without an event', () => {
    expect(parseTeamMail(claimed({ event: null, count: 5 }))?.event).toBeNull();
    expect(parseTeamMail(claimed({ type: 'team_quota', event: null, count: 2, quota: { requester: 'Tom', extra: 1 } }))).not.toBeNull();
  });

  it('still refuses a single mail or a decision without its event', () => {
    expect(parseTeamMail(claimed({ event: null, count: 1 }))).toBeNull();
    expect(parseTeamMail(claimed({ type: 'team_decision', event: null, count: 2, decision: { status: 'approved', extra: 1 } }))).toBeNull();
  });
});

describe('buildTeamMail', () => {
  it('one-click unsubscribe headers, the /n link, the mail_log idempotency key', () => {
    const m = parseTeamMail(claimed());
    if (!m) throw new Error('parse');
    const out = buildTeamMail(m, 'https://app.plus-one.io/');
    expect(out.idempotencyKey).toBe(`mail_log/${LOG}`);
    expect(out.headers).toEqual({
      'List-Unsubscribe': `<https://app.plus-one.io/n/${TOKEN}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(out.subject).toBe('2 new requests for Neon Friday');
    expect(out.from).toBeUndefined(); // the default PlusOne sender
  });
});

describe('runTeamMailsRoute', () => {
  it('a missing or malformed token is refused before any RPC', async () => {
    const { d, rpc } = deps();
    expect(await runTeamMailsRoute(null, d)).toEqual({ status: 401, error: 'invalid_token' });
    expect(await runTeamMailsRoute('xyz', d)).toEqual({ status: 401, error: 'invalid_token' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a refused token (42501) is a 401; mail off is a 503 after the token is spent', async () => {
    const refused = deps({ rpc: vi.fn(async () => ({ data: null, error: { code: '42501' } })) });
    expect(await runTeamMailsRoute('a'.repeat(64), refused.d)).toEqual({ status: 401, error: 'invalid_token' });
    const off = deps({ active: false });
    expect(await runTeamMailsRoute('a'.repeat(64), off.d)).toEqual({ status: 503, error: 'mail_not_configured' });
    expect(off.rpc).toHaveBeenCalledWith('team_mails_begin', { p_token: 'a'.repeat(64), p_limit: 0 });
  });

  it('sends and settles every row of the bundled slot together', async () => {
    const { d, rpc, sent } = deps();
    const res = await runTeamMailsRoute('a'.repeat(64), d);
    expect(res).toEqual({ status: 200, totals: { claimed: 1, sent: 1, failed: 0 } });
    expect(sent[0]).toHaveLength(1);
    expect(rpc).toHaveBeenCalledWith('team_mails_settle', {
      p_results: [{ mail_log_id: LOG, queue_ids: [Q1, Q2], ok: true, provider_message_id: 're_1' }],
    });
  });
});

describe('drainTeamMails', () => {
  it('a failed send settles failed with the provider code; a malformed entry settles malformed', async () => {
    const rpc = vi.fn(async (fn: string) =>
        fn === 'team_mails_claim'
          ? { data: { mails: [claimed(), { mail_log_id: LOG.replace('a1', 'a2'), queue_ids: [Q1], type: 'nope' }] }, error: null }
          : { data: 1, error: null },
    );
    const { d } = deps({
      rpc,
      sendBatch: vi.fn(async (mails: OutgoingMail[]) => mails.map(() => ({ ok: false as const, errorCode: 'rate_limited' as const }))),
    });
    const totals = await drainTeamMails(d);
    expect(totals).toEqual({ claimed: 2, sent: 0, failed: 2 });
    const settle = (rpc.mock.calls as unknown as Array<[string, { p_results: Array<Record<string, unknown>> }]>).find(
      (c) => c[0] === 'team_mails_settle',
    );
    expect(settle?.[1].p_results.map((r) => r.error_code)).toEqual(['malformed', 'rate_limited']);
  });

  it('does nothing when mail is not active', async () => {
    const { d, rpc } = deps({ active: false });
    expect(await drainTeamMails(d)).toEqual({ claimed: 0, sent: 0, failed: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });
});
