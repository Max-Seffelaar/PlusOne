/**
 * Resend webhook (Mail-infra F0): Svix signature gate, the response contract
 * and replay = no-op. The DB side of idempotency (resend_webhook_events ledger,
 * forward-only status) is proven in pgTAP (mail_log.test.sql); here the RPC is
 * mocked and we assert it is (not) reached.
 */
import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  config: { resendEnabled: false, apiKey: null as string | null, webhookSecret: null as string | null },
  rpc: vi.fn(),
}));

vi.mock('./config', () => ({ mailConfig: H.config, teamMailActive: () => true, MAIL_FROM: 'PlusOne <noreply@plus-one.io>', MAIL_DOMAIN: 'plus-one.io' }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: H.rpc }) }));

import { handleResendWebhook, verifySvixSignature, TIMESTAMP_TOLERANCE_SECONDS } from './resend-webhook';

// Svix's published test vector (docs.svix.com, "Verifying payloads manually").
const VECTOR = {
  secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
  id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: '1614265330',
  body: '{"test": 2432232314}',
  signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
};

const SECRET = 'whsec_' + Buffer.from('plusone-test-webhook-secret').toString('base64');

function sign(id: string, ts: string, body: string, secret = SECRET): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  return 'v1,' + createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
}

function delivery(type: string, emailId = 're_abc', id = 'msg_1') {
  const body = JSON.stringify({ type, created_at: '2026-10-07T10:00:00Z', data: { email_id: emailId, to: ['crew@example.test'], subject: 'x' } });
  const ts = String(Math.floor(Date.now() / 1000));
  return { body, headers: { id, timestamp: ts, signature: sign(id, ts, body) } };
}

beforeEach(() => {
  H.config.webhookSecret = SECRET;
  H.rpc.mockReset();
  H.rpc.mockResolvedValue({ data: true, error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('verifySvixSignature', () => {
  it('accepts Svix\'s published test vector', () => {
    expect(
      verifySvixSignature(VECTOR.body, { id: VECTOR.id, timestamp: VECTOR.timestamp, signature: VECTOR.signature }, VECTOR.secret, 1614265330)
    ).toBe(true);
  });

  it('accepts when any one of several space-separated candidates matches', () => {
    const sig = `v1,AAAA ${VECTOR.signature}`;
    expect(verifySvixSignature(VECTOR.body, { id: VECTOR.id, timestamp: VECTOR.timestamp, signature: sig }, VECTOR.secret, 1614265330)).toBe(true);
  });

  it('rejects a changed body, id or timestamp', () => {
    const h = { id: VECTOR.id, timestamp: VECTOR.timestamp, signature: VECTOR.signature };
    expect(verifySvixSignature('{"test": 2432232315}', h, VECTOR.secret, 1614265330)).toBe(false);
    expect(verifySvixSignature(VECTOR.body, { ...h, id: 'msg_other' }, VECTOR.secret, 1614265330)).toBe(false);
    expect(verifySvixSignature(VECTOR.body, { ...h, timestamp: '1614265331' }, VECTOR.secret, 1614265331)).toBe(false);
  });

  it('rejects the right signature under the wrong secret, and non-v1 schemes', () => {
    const h = { id: VECTOR.id, timestamp: VECTOR.timestamp, signature: VECTOR.signature };
    expect(verifySvixSignature(VECTOR.body, h, SECRET, 1614265330)).toBe(false);
    expect(verifySvixSignature(VECTOR.body, { ...h, signature: VECTOR.signature.replace('v1,', 'v1a,') }, VECTOR.secret, 1614265330)).toBe(false);
  });

  it('enforces the timestamp tolerance both ways', () => {
    const h = { id: VECTOR.id, timestamp: VECTOR.timestamp, signature: VECTOR.signature };
    const t0 = 1614265330;
    expect(verifySvixSignature(VECTOR.body, h, VECTOR.secret, t0 + TIMESTAMP_TOLERANCE_SECONDS)).toBe(true);
    expect(verifySvixSignature(VECTOR.body, h, VECTOR.secret, t0 + TIMESTAMP_TOLERANCE_SECONDS + 1)).toBe(false);
    expect(verifySvixSignature(VECTOR.body, h, VECTOR.secret, t0 - TIMESTAMP_TOLERANCE_SECONDS - 1)).toBe(false);
  });

  it('rejects missing headers and a non-numeric timestamp without throwing', () => {
    expect(verifySvixSignature(VECTOR.body, { id: null, timestamp: VECTOR.timestamp, signature: VECTOR.signature }, VECTOR.secret)).toBe(false);
    expect(verifySvixSignature(VECTOR.body, { id: VECTOR.id, timestamp: 'now', signature: VECTOR.signature }, VECTOR.secret)).toBe(false);
    expect(verifySvixSignature(VECTOR.body, { id: VECTOR.id, timestamp: VECTOR.timestamp, signature: null }, VECTOR.secret)).toBe(false);
  });
});

describe('handleResendWebhook', () => {
  it('refuses everything (503) when the secret is not configured, before touching the DB', async () => {
    H.config.webhookSecret = null;
    const d = delivery('email.delivered');
    expect(await handleResendWebhook(d.body, d.headers)).toEqual({ status: 503, body: 'not configured' });
    expect(H.rpc).not.toHaveBeenCalled();
  });

  it('refuses a forged signature (400) without processing', async () => {
    const d = delivery('email.bounced');
    const forged = { ...d.headers, signature: sign(d.headers.id, d.headers.timestamp, d.body, 'whsec_' + Buffer.from('attacker').toString('base64')) };
    expect(await handleResendWebhook(d.body, forged)).toEqual({ status: 400, body: 'invalid signature' });
    expect(H.rpc).not.toHaveBeenCalled();
  });

  it('refuses a validly signed body that was altered in transit', async () => {
    const d = delivery('email.delivered');
    const res = await handleResendWebhook(d.body.replace('delivered', 'complained'), d.headers);
    expect(res.status).toBe(400);
    expect(H.rpc).not.toHaveBeenCalled();
  });

  it('applies a valid delivery through the RPC with the Svix id as the ledger key', async () => {
    const d = delivery('email.bounced', 're_xyz', 'msg_bounce_1');
    expect(await handleResendWebhook(d.body, d.headers)).toEqual({ status: 200, body: 'ok' });
    expect(H.rpc).toHaveBeenCalledWith('apply_resend_webhook_event', {
      p_event_id: 'msg_bounce_1',
      p_event_type: 'email.bounced',
      p_provider_message_id: 're_xyz',
    });
  });

  it('answers a replay with 200 "replay" (the RPC ledger returned false)', async () => {
    const d = delivery('email.delivered');
    H.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect((await handleResendWebhook(d.body, d.headers)).body).toBe('ok');
    expect(await handleResendWebhook(d.body, d.headers)).toEqual({ status: 200, body: 'replay' });
  });

  it.each(['email.sent', 'email.opened', 'email.clicked', 'contact.created'])('ignores %s without a DB call', async (type) => {
    const d = delivery(type);
    expect(await handleResendWebhook(d.body, d.headers)).toEqual({ status: 200, body: 'ignored' });
    expect(H.rpc).not.toHaveBeenCalled();
  });

  it('answers 200 "ignored" for a signed but unparseable body (poison, never retried)', async () => {
    const body = 'not json';
    const ts = String(Math.floor(Date.now() / 1000));
    const res = await handleResendWebhook(body, { id: 'msg_p', timestamp: ts, signature: sign('msg_p', ts, body) });
    expect(res).toEqual({ status: 200, body: 'ignored' });
    expect(H.rpc).not.toHaveBeenCalled();
  });

  it('answers 500 on a DB error and logs no payload content', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    H.rpc.mockResolvedValue({ data: null, error: { code: '57014', message: 'timeout' } });
    const d = delivery('email.complained');
    expect(await handleResendWebhook(d.body, d.headers)).toEqual({ status: 500, body: 'processing failed' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('crew@example.test');
  });

  it('refuses an oversized body before verifying it', async () => {
    const res = await handleResendWebhook('x'.repeat(300 * 1024), { id: 'a', timestamp: '1', signature: 'v1,a' });
    expect(res.status).toBe(413);
  });

  it('email.received: ledgers first, answers once; a replay neither mutates nor answers again', async () => {
    const body = JSON.stringify({
      type: 'email.received',
      data: { email_id: 'in_1', from: 'Lotte <lotte@example.test>', to: ['noreply@plus-one.io'] },
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const headers = { id: 'msg_in_1', timestamp: ts, signature: sign('msg_in_1', ts, body) };
    const answer = vi.fn(async () => true);
    const inbound = () => ({
      resolve: vi.fn(async () => null),
      consume: answer,
      provider: { send: vi.fn(async () => ({ ok: true as const, providerMessageId: 're_r' })) },
    });
    H.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    expect(await handleResendWebhook(body, headers, inbound)).toEqual({ status: 200, body: 'ok' });
    expect(H.rpc).toHaveBeenCalledWith('apply_resend_webhook_event', {
      p_event_id: 'msg_in_1',
      p_event_type: 'email.received',
      p_provider_message_id: 'in_1',
    });
    expect(answer).toHaveBeenCalledTimes(1);
    expect(await handleResendWebhook(body, headers, inbound)).toEqual({ status: 200, body: 'replay' });
    expect(answer).toHaveBeenCalledTimes(1);
  });
});
