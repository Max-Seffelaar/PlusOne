/**
 * Inbound auto-reply on noreply@ (Gastcommunicatie F): who gets an answer,
 * what it says, and that it is never a relay or a mirror. The webhook's
 * signature + ledger gate (a replay never answers twice) is in
 * resend-webhook.test.ts; the per-sender budget in pgTAP.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: vi.fn() }) }));
vi.mock('./config', () => ({
  MAIL_DOMAIN: 'plus-one.io',
  MAIL_FROM: 'PlusOne <noreply@plus-one.io>',
  mailConfig: { resendEnabled: false, apiKey: null, webhookSecret: null },
}));

import { answerInbound, bareAddress, renderAutoReply, replyKeyFrom, shouldAnswer, trustedHumanMail, type InboundDeps } from './inbound';
import type { ReceivedMailMeta } from './resend-adapter';

const KEY = 'ab'.repeat(20);

/** A human mail whose From domain passed DKIM: the only kind that gets an answer. */
function verified(over: Partial<ReceivedMailMeta> = {}, headers: Partial<ReceivedMailMeta['headers']> = {}): ReceivedMailMeta {
  return {
    spf: 'pass',
    dkim: 'pass',
    dmarc: 'pass',
    ...over,
    headers: { autoSubmitted: null, precedence: null, listId: null, ...headers },
  };
}

function deps(over: Partial<InboundDeps> = {}) {
  const send = vi.fn(async () => ({ ok: true as const, providerMessageId: 're_1' }));
  const d: InboundDeps = {
    resolve: vi.fn(async () => ({ found: true, company: 'Vesper Group', contactEmail: 'hi@vesper.test' })),
    consume: vi.fn(async () => true),
    meta: vi.fn(async () => verified()),
    provider: { send },
    ...over,
  };
  return { d, send };
}

describe('address parsing', () => {
  it('reads the bare address from a header value', () => {
    expect(bareAddress('Lotte <Lotte@Example.test>')).toBe('lotte@example.test');
    expect(bareAddress('lotte@example.test')).toBe('lotte@example.test');
    expect(bareAddress('no address')).toBeNull();
    expect(bareAddress(42)).toBeNull();
  });

  it('finds the reply key only on noreply+<40 hex>@plus-one.io', () => {
    expect(replyKeyFrom([`noreply+${KEY}@plus-one.io`])).toBe(KEY);
    expect(replyKeyFrom([`"x" <NOREPLY+${KEY.toUpperCase()}@Plus-One.io>`])).toBe(KEY);
    expect(replyKeyFrom(['noreply@plus-one.io'])).toBeNull();
    expect(replyKeyFrom([`noreply+${KEY}@evil.test`])).toBeUndefined();
    expect(replyKeyFrom(['support@plus-one.io'])).toBeUndefined();
    expect(replyKeyFrom([`noreply+${KEY}x@plus-one.io`])).toBeUndefined();
  });

  it('never answers daemons, no-reply senders or our own domain', () => {
    expect(shouldAnswer('lotte@example.test')).toBe(true);
    for (const s of ['mailer-daemon@x.test', 'postmaster@x.test', 'noreply@x.test', 'no-reply@x.test', 'bounces+1@x.test', 'a@plus-one.io', 'a@mail.plus-one.io']) {
      expect(shouldAnswer(s), s).toBe(false);
    }
    expect(shouldAnswer(null)).toBe(false);
  });
});

describe('answerInbound', () => {
  it('answers the sender once with the company contact behind a live key', async () => {
    const { d, send } = deps();
    const out = await answerInbound('msg_1', { email_id: 'in_1', from: 'Lotte <lotte@example.test>', to: [`noreply+${KEY}@plus-one.io`] }, d);
    expect(out).toBe('answered');
    expect(send).toHaveBeenCalledTimes(1);
    const mail = (send.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(mail.to).toBe('lotte@example.test');
    expect(mail.text).toContain('To reach Vesper Group, mail hi@vesper.test.');
    expect(mail.idempotencyKey).toBe('inbound/msg_1');
    expect(mail.headers).toMatchObject({ 'Auto-Submitted': 'auto-replied' });
  });

  it('a bare noreply@ or an unknown key gets the generic footer answer, no lookup leak', async () => {
    const { d, send } = deps({ resolve: vi.fn(async () => ({ found: false })) });
    await answerInbound('msg_2', { email_id: 'in_1', from: 'lotte@example.test', to: ['noreply@plus-one.io'] }, d);
    expect(d.resolve).not.toHaveBeenCalled();
    await answerInbound('msg_3', { email_id: 'in_1', from: 'lotte@example.test', to: [`noreply+${KEY}@plus-one.io`] }, d);
    const texts = (send.mock.calls as unknown as Array<[{ text: string }]>).map((c) => c[0].text);
    for (const text of texts) {
      expect(text).toContain('names who to contact at the bottom');
      expect(text).not.toContain('@');
    }
  });

  it('never echoes the inbound mail and never mails anyone but the sender', async () => {
    const { d, send } = deps();
    await answerInbound(
      'msg_4',
      { email_id: 'in_4', from: 'lotte@example.test', to: [`noreply+${KEY}@plus-one.io`, 'victim@example.test'], subject: 'SECRET', html: '<b>x</b>' } as never,
      d,
    );
    const mail = (send.mock.calls[0] as unknown as [Record<string, string>])[0];
    expect(mail.to).toBe('lotte@example.test');
    expect(JSON.stringify(mail)).not.toContain('SECRET');
    expect(JSON.stringify(mail)).not.toContain('victim');
  });

  it('ignores mail not addressed to noreply@ and senders it must not answer', async () => {
    const { d, send } = deps();
    expect(await answerInbound('m', { email_id: 'in_1', from: 'a@example.test', to: ['support@plus-one.io'] }, d)).toBe('ignored');
    expect(await answerInbound('m', { email_id: 'in_1', from: 'mailer-daemon@example.test', to: ['noreply@plus-one.io'] }, d)).toBe('ignored');
    expect(await answerInbound('m', { email_id: 'in_1', from: 'garbage', to: ['noreply@plus-one.io'] }, d)).toBe('ignored');
    expect(send).not.toHaveBeenCalled();
  });

  it('respects the budget (one per sender per day)', async () => {
    const { d, send } = deps({ consume: vi.fn(async () => false) });
    expect(await answerInbound('m', { email_id: 'in_1', from: 'a@example.test', to: ['noreply@plus-one.io'] }, d)).toBe('throttled');
    expect(send).not.toHaveBeenCalled();
  });

  it('never answers a From that did not authenticate (no backscatter), before spending the budget', async () => {
    for (const meta of [
      null,
      verified({ dkim: 'gray', dmarc: 'gray' }),
      verified({ dkim: 'fail', dmarc: 'fail', spf: 'pass' }),
      verified({ dkim: 'processing_failed', dmarc: 'unknown' }),
    ]) {
      const { d, send } = deps({ meta: vi.fn(async () => meta) });
      expect(await answerInbound('m', { email_id: 'in_9', from: 'victim@example.test', to: [`noreply+${KEY}@plus-one.io`] }, d)).toBe('unverified');
      expect(d.consume).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    }
  });

  it('never answers auto-generated mail (loops, lists, bulk)', async () => {
    for (const headers of [
      { autoSubmitted: 'auto-replied' },
      { autoSubmitted: 'Auto-Generated' },
      { precedence: 'bulk' },
      { precedence: ' List ' },
      { precedence: 'junk' },
      { listId: '<news.example.test>' },
    ]) {
      const { d, send } = deps({ meta: vi.fn(async () => verified({}, headers)) });
      expect(await answerInbound('m', { email_id: 'in_9', from: 'a@example.test', to: ['noreply@plus-one.io'] }, d)).toBe('unverified');
      expect(send).not.toHaveBeenCalled();
    }
    expect(trustedHumanMail(verified({}, { autoSubmitted: 'no' }))).toBe(true);
    expect(trustedHumanMail(verified({ dkim: 'gray', dmarc: 'pass' }))).toBe(true);
  });

  it('without an email id there is nothing to verify: no answer', async () => {
    const { d, send } = deps();
    expect(await answerInbound('m', { from: 'a@example.test', to: ['noreply@plus-one.io'] }, d)).toBe('unverified');
    expect(d.meta).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('escapes the company name in the HTML', () => {
    const r = renderAutoReply({ company: '<script>x</script>', contactEmail: 'hi@vesper.test' });
    expect(r.html).not.toContain('<script>');
  });
});
