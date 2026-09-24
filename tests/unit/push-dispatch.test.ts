// push-dispatch Edge Function (Fase 17 N2, 86ey6bfbe) — unit suite.
//
// CI runs no Deno tests, so the function's logic lives in a runtime-agnostic
// module (supabase/functions/push-dispatch/dispatch.ts) and is exercised here
// under Node with a mocked fetch standing in for PostgREST, Google OAuth and
// FCM HTTP v1. The SQL half (claim/complete/prune semantics, the single-use
// token gate) is covered by supabase/tests/database/push_dispatch.test.sql.

import { describe, it, expect, beforeAll } from 'vitest';
import {
  classifyFcmError,
  handleDispatch,
  parseServiceAccount,
  rowOutcome,
  signServiceAccountJwt,
  type ClaimedRow,
  type DispatchEnv,
} from '../../supabase/functions/push-dispatch/dispatch';

const TOKEN = 'ab'.repeat(32); // 64 hex chars, the shape kick_push_dispatch mints
const SUPABASE_URL = 'https://ref.supabase.test';
const SERVICE_KEY = 'service-role-key-for-tests';
const DEVICE_A = 'device-token-A';
const DEVICE_B = 'device-token-B';

let privatePem = '';
let publicKey: CryptoKey;

function toPem(der: ArrayBuffer): string {
  const b64 = Buffer.from(der).toString('base64');
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
  privatePem = toPem(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  publicKey = pair.publicKey;
});

function env(overrides: Partial<DispatchEnv> = {}): DispatchEnv {
  return {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    FCM_PROJECT_ID: 'plusone-test',
    FCM_SERVICE_ACCOUNT_JSON: JSON.stringify({
      type: 'service_account',
      client_email: 'push@plusone-test.iam.gserviceaccount.com',
      private_key: privatePem,
      token_uri: 'https://oauth2.googleapis.test/token',
    }),
    ...overrides,
  };
}

function row(id: string, tokens: string[], kind = 'guest_request_created'): ClaimedRow {
  return {
    id,
    kind,
    attempts: 1,
    payload: { kind, venue_id: 'v1', event_id: 'e1', request_id: `req-${id}` },
    tokens: tokens.map((t, i) => ({ id: `${id}-tok-${i}`, token: t })),
  };
}

interface Call {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/**
 * Scripted fake of the three upstreams. `fcm` maps a device token to the
 * response FCM gives for it.
 */
function fakeUpstreams(opts: {
  batches?: ClaimedRow[][];
  claimStatus?: number;
  claimCode?: string;
  oauthStatus?: number;
  fcm?: Record<string, { status: number; body?: unknown } | 'throw'>;
}) {
  const calls: Call[] = [];
  const batches = [...(opts.batches ?? [])];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const raw = typeof init?.body === 'string' ? init.body : '';
    let body: unknown = raw;
    try {
      body = JSON.parse(raw);
    } catch {
      /* form-encoded */
    }
    calls.push({ url, body, headers });

    if (url.endsWith('/rest/v1/rpc/claim_push_outbox')) {
      if (opts.claimStatus) {
        return new Response(JSON.stringify({ code: opts.claimCode ?? null }), { status: opts.claimStatus });
      }
      return Response.json(batches.shift() ?? []);
    }
    if (url.endsWith('/rest/v1/rpc/complete_push_outbox')) return Response.json('ok');
    if (url.endsWith('/rest/v1/rpc/prune_push_tokens')) {
      return Response.json((body as { p_ids: string[] }).p_ids.length);
    }
    if (url.startsWith('https://oauth2.googleapis.test/token')) {
      if (opts.oauthStatus) return new Response('{}', { status: opts.oauthStatus });
      return Response.json({ access_token: 'ya29.test-access', expires_in: 3600 });
    }
    if (url.startsWith('https://fcm.googleapis.com/')) {
      const token = (body as { message: { token: string } }).message.token;
      const r = opts.fcm?.[token] ?? { status: 200, body: { name: 'projects/x/messages/1' } };
      if (r === 'throw') throw new TypeError('network down');
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { fetchFn, calls };
}

function post(token: string | null = TOKEN): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers['x-push-dispatch-token'] = token;
  return new Request('https://ref.functions.test/push-dispatch', { method: 'POST', headers, body: '{}' });
}

const completes = (calls: Call[]) =>
  calls
    .filter((c) => c.url.endsWith('/complete_push_outbox'))
    .map((c) => c.body as { p_id: string; p_outcome: string; p_error: string | null });

const unregistered = {
  status: 404,
  body: {
    error: {
      code: 404,
      status: 'NOT_FOUND',
      message: 'Requested entity was not found.',
      details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }],
    },
  },
};

describe('push-dispatch caller gate', () => {
  it('rejects non-POST', async () => {
    const { fetchFn, calls } = fakeUpstreams({});
    const res = await handleDispatch(new Request('https://x/', { method: 'GET' }), { env: env(), fetch: fetchFn, log: () => {} });
    expect(res.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it('rejects a missing or malformed token without touching the database', async () => {
    const { fetchFn, calls } = fakeUpstreams({});
    for (const s of [null, '', 'short', 'x'.repeat(64), 'AB'.repeat(32), 'ab'.repeat(33)]) {
      const res = await handleDispatch(post(s), { env: env(), fetch: fetchFn, log: () => {} });
      expect(res.status).toBe(401);
    }
    expect(calls).toHaveLength(0);
  });

  it('maps a refused token (42501: unknown, used or expired) to 401 and sends nothing', async () => {
    const { fetchFn, calls } = fakeUpstreams({ claimStatus: 403, claimCode: '42501' });
    const res = await handleDispatch(post('cd'.repeat(32)), { env: env(), fetch: fetchFn, log: () => {} });
    expect(res.status).toBe(401);
    expect(calls.map((c) => c.url)).toEqual([`${SUPABASE_URL}/rest/v1/rpc/claim_push_outbox`]);
  });

  it('forwards the caller token to claim_push_outbox with the service_role key', async () => {
    const { fetchFn, calls } = fakeUpstreams({ batches: [[]] });
    const res = await handleDispatch(post(), { env: env(), fetch: fetchFn, log: () => {} });
    expect(res.status).toBe(200);
    expect(calls[0].body).toEqual({ p_token: TOKEN, p_limit: 200 });
    expect(calls[0].headers.authorization).toBe(`Bearer ${SERVICE_KEY}`);
  });

  it('sleeps (503, no claim) when FCM secrets are absent — no attempt burned', async () => {
    for (const missing of [{ FCM_SERVICE_ACCOUNT_JSON: undefined }, { FCM_PROJECT_ID: undefined }, { FCM_SERVICE_ACCOUNT_JSON: '{not json' }]) {
      const { fetchFn, calls } = fakeUpstreams({ batches: [[row('r1', [DEVICE_A])]] });
      const res = await handleDispatch(post(), { env: env(missing), fetch: fetchFn, log: () => {} });
      expect(res.status).toBe(503);
      expect(calls).toHaveLength(0);
    }
  });
});

describe('push-dispatch delivery', () => {
  it('sends via FCM v1 with an OAuth bearer and marks the row sent', async () => {
    const { fetchFn, calls } = fakeUpstreams({ batches: [[row('r1', [DEVICE_A])]] });
    const res = await handleDispatch(post(), { env: env(), fetch: fetchFn, log: () => {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ claimed: 1, sent: 1, pruned: 0 });

    const send = calls.find((c) => c.url.startsWith('https://fcm.googleapis.com/'))!;
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/plusone-test/messages:send');
    expect(send.headers.authorization).toBe('Bearer ya29.test-access');
    const msg = (send.body as { message: { token: string; notification: { title: string }; data: Record<string, string> } }).message;
    expect(msg.token).toBe(DEVICE_A);
    expect(msg.notification.title).toBe('New guest request');
    expect(msg.data).toEqual({ kind: 'guest_request_created', venue_id: 'v1', event_id: 'e1', request_id: 'req-r1' });
    expect(completes(calls)).toEqual([{ p_id: 'r1', p_outcome: 'sent', p_error: null }]);
  });

  it('prunes UNREGISTERED tokens and still counts the row sent if another device got it', async () => {
    const { fetchFn, calls } = fakeUpstreams({
      batches: [[row('r1', [DEVICE_A, DEVICE_B])]],
      fcm: { [DEVICE_A]: unregistered },
    });
    const res = await handleDispatch(post(), { env: env(), fetch: fetchFn, log: () => {} });
    expect(await res.json()).toMatchObject({ sent: 1, pruned: 1 });
    const prune = calls.find((c) => c.url.endsWith('/prune_push_tokens'))!;
    expect(prune.body).toEqual({ p_ids: ['r1-tok-0'] });
    expect(completes(calls)[0]).toMatchObject({ p_outcome: 'sent', p_error: 'fcm:UNREGISTERED' });
  });

  it('marks a row skipped when it has no live tokens (nothing sent to FCM)', async () => {
    const { fetchFn, calls } = fakeUpstreams({ batches: [[row('r1', [])]] });
    await handleDispatch(post(), { env: env(), fetch: fetchFn, log: () => {} });
    expect(calls.some((c) => c.url.startsWith('https://fcm.googleapis.com/'))).toBe(false);
    expect(completes(calls)).toEqual([{ p_id: 'r1', p_outcome: 'skipped', p_error: 'no live device tokens' }]);
  });

  it('retries on 5xx / 429 / network errors without pruning', async () => {
    const { fetchFn, calls } = fakeUpstreams({
      batches: [[row('r1', [DEVICE_A]), row('r2', [DEVICE_B])]],
      fcm: { [DEVICE_A]: { status: 503, body: { error: { status: 'UNAVAILABLE' } } }, [DEVICE_B]: 'throw' },
    });
    const res = await handleDispatch(post(), { env: env(), fetch: fetchFn, log: () => {} });
    expect(await res.json()).toMatchObject({ retry: 2, pruned: 0 });
    expect(completes(calls).map((c) => [c.p_id, c.p_outcome, c.p_error])).toEqual([
      ['r1', 'retry', 'fcm:UNAVAILABLE'],
      ['r2', 'retry', 'fcm:NETWORK'],
    ]);
    expect(calls.some((c) => c.url.endsWith('/prune_push_tokens'))).toBe(false);
  });

  it('puts every claimed row back to retry when OAuth fails, and sends nothing', async () => {
    const { fetchFn, calls } = fakeUpstreams({ batches: [[row('r1', [DEVICE_A]), row('r2', [DEVICE_B])]], oauthStatus: 400 });
    const res = await handleDispatch(post(), { env: env(), fetch: fetchFn, log: () => {} });
    expect(res.status).toBe(502);
    expect(calls.some((c) => c.url.startsWith('https://fcm.googleapis.com/'))).toBe(false);
    expect(completes(calls).map((c) => [c.p_id, c.p_outcome, c.p_error])).toEqual([
      ['r1', 'retry', 'oauth_400'],
      ['r2', 'retry', 'oauth_400'],
    ]);
  });

  it('claims exactly once per invocation (single-use token) and mints one OAuth token', async () => {
    const full = Array.from({ length: 200 }, (_, i) => row(`a${i}`, [`tok-a${i}`]));
    const { fetchFn, calls } = fakeUpstreams({ batches: [full, [row('b0', ['tok-b0'])]] });
    const res = await handleDispatch(post(), { env: env(), fetch: fetchFn, log: () => {} });
    expect(await res.json()).toMatchObject({ claimed: 200, sent: 200 });
    expect(calls.filter((c) => c.url.endsWith('/claim_push_outbox'))).toHaveLength(1);
    expect(calls.filter((c) => c.url.startsWith('https://oauth2.googleapis.test/'))).toHaveLength(1);
  });

  it('does not mint an OAuth token when there is nothing to send', async () => {
    const { fetchFn, calls } = fakeUpstreams({ batches: [[]] });
    await handleDispatch(post(), { env: env(), fetch: fetchFn, log: () => {} });
    expect(calls.map((c) => c.url)).toEqual([`${SUPABASE_URL}/rest/v1/rpc/claim_push_outbox`]);
  });

  it('never logs the service-account JSON, device tokens, access token or caller token', async () => {
    const lines: string[] = [];
    const log = (event: string, fields?: Record<string, unknown>) => lines.push(JSON.stringify({ event, ...fields }));
    const { fetchFn } = fakeUpstreams({ batches: [[row('r1', [DEVICE_A, DEVICE_B])]], fcm: { [DEVICE_A]: unregistered } });
    await handleDispatch(post(), { env: env(), fetch: fetchFn, log });
    const { fetchFn: f2 } = fakeUpstreams({ batches: [[row('r2', [DEVICE_A])]], oauthStatus: 401 });
    await handleDispatch(post(), { env: env(), fetch: f2, log });
    const all = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of [TOKEN, DEVICE_A, DEVICE_B, 'ya29.test-access', 'PRIVATE KEY', 'client_email', SERVICE_KEY]) {
      expect(all).not.toContain(secret);
    }
  });
});

describe('FCM error classification', () => {
  const fcmErr = (status: string, errorCode?: string, message = '') => ({
    error: {
      status,
      message,
      details: errorCode ? [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }] : [],
    },
  });

  it.each([
    [404, fcmErr('NOT_FOUND', 'UNREGISTERED'), 'prune'],
    [403, fcmErr('PERMISSION_DENIED', 'SENDER_ID_MISMATCH'), 'prune'],
    [400, fcmErr('INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'The registration token is not a valid FCM registration token'), 'prune'],
    [400, fcmErr('INVALID_ARGUMENT', 'INVALID_ARGUMENT', 'Invalid value at message.data'), 'permanent'],
    [429, fcmErr('RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED'), 'transient'],
    [500, fcmErr('INTERNAL', 'INTERNAL'), 'transient'],
    [401, fcmErr('UNAUTHENTICATED', 'THIRD_PARTY_AUTH_ERROR'), 'transient'],
    [502, null, 'transient'],
  ] as const)('HTTP %i → %s', (status, body, kind) => {
    expect(classifyFcmError(status, body).kind).toBe(kind);
  });

  it('aggregates row outcomes: any ok → sent, else transient → retry, else permanent → failed, else skipped', () => {
    expect(rowOutcome([{ kind: 'ok' }, { kind: 'transient', code: 'X' }]).outcome).toBe('sent');
    expect(rowOutcome([{ kind: 'prune', code: 'UNREGISTERED' }, { kind: 'transient', code: 'X' }]).outcome).toBe('retry');
    expect(rowOutcome([{ kind: 'permanent', code: 'INVALID_ARGUMENT' }]).outcome).toBe('failed');
    expect(rowOutcome([{ kind: 'prune', code: 'UNREGISTERED' }]).outcome).toBe('skipped');
    expect(rowOutcome([]).outcome).toBe('skipped');
  });
});

describe('service-account JWT', () => {
  it('parses only a usable service account', () => {
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount('{')).toBeNull();
    expect(parseServiceAccount('{"client_email":"a"}')).toBeNull();
    expect(parseServiceAccount('{"client_email":"a","private_key":"k"}')?.token_uri).toBe('https://oauth2.googleapis.com/token');
  });

  it('signs an RS256 JWT with the FCM scope that verifies against the public key', async () => {
    const sa = parseServiceAccount(env().FCM_SERVICE_ACCOUNT_JSON)!;
    const jwt = await signServiceAccountJwt(sa, 1_700_000_000_000);
    const [h, c, s] = jwt.split('.');
    const dec = (x: string) => JSON.parse(Buffer.from(x, 'base64url').toString('utf8'));
    expect(dec(h)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(dec(c)).toEqual({
      iss: 'push@plusone-test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.test/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      Buffer.from(s, 'base64url'),
      new TextEncoder().encode(`${h}.${c}`)
    );
    expect(ok).toBe(true);
  });
});
