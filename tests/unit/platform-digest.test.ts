// platform-digest Edge Function (z8uq9m2ybj) — unit suite. The function's
// logic lives in a runtime-agnostic module
// (supabase/functions/platform-digest/digest.ts) and is exercised here with a
// mocked fetch, because CI does not run Deno tests. The SQL side (token,
// ledger, wrappers) is proven in supabase/tests/database/platform_digest.test.sql.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleDigest,
  isLocalSupabaseUrl,
  mailTransport,
  overviewUrl,
  parseBegin,
  type DigestEnv,
} from '../../supabase/functions/platform-digest/digest';
import { formatDigestDate, renderPlatformDigest } from '../../supabase/functions/platform-digest/template';

const TOKEN = 'ab'.repeat(32);
const SUPABASE = 'https://ref.supabase.test';
const SERVICE_KEY = 'service-key-secret';
const RESEND_KEY = 're_secret_key';

const NUMBERS = {
  digest_date: '2026-10-08',
  subscriptions: {
    total_companies: 12,
    trialing: 4,
    trial_lapsed: 1,
    paid_monthly: 3,
    paid_yearly: 2,
    paid_unknown: 0,
    past_due: 1,
    canceled: 0,
    comped: 1,
    no_subscription: 0,
    trialing_payment_set_up: 1,
  },
  funnel: { ending_7d: 3, ended_30d: 5, converted_30d: 2, ended_90d: 9, converted_90d: 4, canceled_30d: 1 },
  usage: { active_companies: 6, events: 21, check_ins: 840, dormant_companies: 2 },
};

const ADMINS = [
  { id: '99999999-9999-4999-8999-999999999999', email: 'max@example.test' },
  { id: '99999999-9999-4999-8999-999999999998', email: 'joeri@example.test' },
];

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

type Handler = (call: Call) => Response | Promise<Response>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A fake PostgREST + Resend + Mailpit. Per-RPC handlers; every call recorded. */
function fakeFetch(handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const call = { url, init, body };
    calls.push(call);
    const key = url.includes('/rest/v1/rpc/') ? url.split('/rest/v1/rpc/')[1]! : new URL(url).host + new URL(url).pathname;
    const handler = handlers[key];
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    return handler(call);
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

function okBegin(recipients = ADMINS): Handler {
  return () => jsonResponse(200, { ...NUMBERS, recipients });
}

let logSeq = 0;
function okLog(): Handler {
  return () => jsonResponse(200, `01a11d73-ce73-7019-8cc7-${String(++logSeq).padStart(12, '0')}`);
}

function request(token: string | null = TOKEN, method = 'POST'): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== null) headers['x-platform-digest-token'] = token;
  return new Request('https://ref.functions.test/platform-digest', {
    method,
    headers,
    body: method === 'POST' ? '{"recipients":[{"id":"x","email":"attacker@evil.test"}]}' : undefined,
  });
}

// Every handler call below logs through `capture`; the totals live only in
// the `done` event (the response body is just { ok: true }).
let logged: [string, Record<string, unknown> | undefined][] = [];
const capture = (event: string, fields?: Record<string, unknown>) => {
  logged.push([event, fields]);
};
beforeEach(() => {
  logged = [];
});
function doneTotals(): Record<string, unknown> | undefined {
  return logged.find(([e]) => e === 'done')?.[1];
}

const ENV: DigestEnv = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  RESEND_API_KEY: RESEND_KEY,
  APP_URL: 'https://app.example.test',
};

describe('platform-digest caller gate', () => {
  it('405 for anything but POST, before any DB call', async () => {
    const f = fakeFetch({});
    const res = await handleDigest(request(TOKEN, 'GET'), { env: ENV, fetch: f.fetch, log: capture });
    expect(res.status).toBe(405);
    expect(f.calls).toHaveLength(0);
  });

  it.each([null, '', 'short', 'AB'.repeat(32), `${TOKEN}0`])('401 without a well-formed token (%s), no DB call', async (t) => {
    const f = fakeFetch({});
    const res = await handleDigest(request(t), { env: ENV, fetch: f.fetch, log: capture });
    expect(res.status).toBe(401);
    expect(f.calls).toHaveLength(0);
  });

  it('401 when begin refuses the token (42501): nothing logged, nothing sent', async () => {
    const f = fakeFetch({ platform_digest_begin: () => jsonResponse(401, { code: '42501', message: 'not authorized' }) });
    const res = await handleDigest(request(), { env: ENV, fetch: f.fetch, log: capture });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_token' });
    expect(f.calls.map((c) => c.url)).toEqual([`${SUPABASE}/rest/v1/rpc/platform_digest_begin`]);
  });

  it('a 401 WITHOUT 42501 is our service key being rejected (502), never "bad caller"', async () => {
    const f = fakeFetch({ platform_digest_begin: () => jsonResponse(401, { message: 'Invalid API key' }) });
    const res = await handleDigest(request(), { env: ENV, fetch: f.fetch, log: capture });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'service_key_rejected' });
  });

  it('500 when the runtime env is missing, before any DB call', async () => {
    const f = fakeFetch({});
    const res = await handleDigest(request(), { env: { RESEND_API_KEY: RESEND_KEY }, fetch: f.fetch, log: capture });
    expect(res.status).toBe(500);
    expect(f.calls).toHaveLength(0);
  });

  it('passes the token to begin with the service key and reads nothing from the request body', async () => {
    const f = fakeFetch({ platform_digest_begin: okBegin([]) });
    const res = await handleDigest(request(), { env: ENV, fetch: f.fetch, log: capture });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(doneTotals()).toMatchObject({ recipients: 0, sent: 0, skipped: 0, failed: 0 });
    const begin = f.calls[0]!;
    expect(begin.body).toEqual({ p_token: TOKEN });
    expect((begin.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SERVICE_KEY}`);
    // The body's injected recipient never shows up anywhere.
    expect(JSON.stringify(f.calls)).not.toContain('attacker@evil.test');
  });

  it('a malformed begin payload is a 502 and mails nobody', async () => {
    const f = fakeFetch({
      platform_digest_begin: () => jsonResponse(200, { ...NUMBERS, recipients: [{ id: 'nope', email: 'x@y.z' }] }),
    });
    const res = await handleDigest(request(), { env: ENV, fetch: f.fetch, log: capture });
    expect(res.status).toBe(502);
    expect(f.calls).toHaveLength(1);
  });
});

describe('platform-digest delivery', () => {
  it('one log + one Resend send + one settle per recipient, keyed by the mail_log row', async () => {
    const f = fakeFetch({
      platform_digest_begin: okBegin(),
      log_platform_digest_mail: okLog(),
      'api.resend.com/emails': () => jsonResponse(200, { id: 'resend-msg-1' }),
      record_mail_send_result: () => jsonResponse(200, true),
    });
    const res = await handleDigest(request(), { env: ENV, fetch: f.fetch, log: capture });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(doneTotals()).toMatchObject({ recipients: 2, sent: 2, skipped: 0, failed: 0 });

    const logs = f.calls.filter((c) => c.url.endsWith('/log_platform_digest_mail'));
    expect(logs.map((c) => c.body)).toEqual(ADMINS.map((a) => ({ p_recipient_id: a.id })));

    const sends = f.calls.filter((c) => c.url === 'https://api.resend.com/emails');
    expect(sends).toHaveLength(2);
    expect(sends.map((c) => (c.body.to as string[])[0])).toEqual(ADMINS.map((a) => a.email));
    for (const s of sends) {
      const headers = s.init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${RESEND_KEY}`);
      expect(headers['Idempotency-Key']).toMatch(/^mail_log\/01a11d73-/);
      expect(s.body.from).toBe('PlusOne <noreply@plus-one.io>');
      expect(s.body.tags).toEqual([{ name: 'type', value: 'platform_digest' }]);
    }

    const settles = f.calls.filter((c) => c.url.endsWith('/record_mail_send_result'));
    expect(settles.map((c) => c.body.p_status)).toEqual(['sent', 'sent']);
    expect(settles[0]!.body.p_provider_message_id).toBe('resend-msg-1');
  });

  it('a recipient already mailed today (log returns null) gets nothing', async () => {
    const f = fakeFetch({
      platform_digest_begin: okBegin(),
      log_platform_digest_mail: () => jsonResponse(200, null),
    });
    const res = await handleDigest(request(), { env: ENV, fetch: f.fetch, log: capture });
    expect(await res.json()).toEqual({ ok: true });
    expect(doneTotals()).toMatchObject({ recipients: 2, sent: 0, skipped: 2, failed: 0 });
    expect(f.calls.some((c) => c.url.includes('resend'))).toBe(false);
  });

  it('a Resend 429 settles that row as failed with the quota code, and the next recipient still goes', async () => {
    let n = 0;
    const f = fakeFetch({
      platform_digest_begin: okBegin(),
      log_platform_digest_mail: okLog(),
      'api.resend.com/emails': () =>
        ++n === 1
          ? jsonResponse(429, { name: 'daily_quota_exceeded', message: 'quota for max@example.test' })
          : jsonResponse(200, { id: 'm2' }),
      record_mail_send_result: () => jsonResponse(200, true),
    });
    const res = await handleDigest(request(), { env: ENV, fetch: f.fetch, log: capture });
    expect(await res.json()).toEqual({ ok: true });
    expect(doneTotals()).toMatchObject({ recipients: 2, sent: 1, skipped: 0, failed: 1 });
    const settles = f.calls.filter((c) => c.url.endsWith('/record_mail_send_result'));
    expect(settles[0]!.body).toMatchObject({ p_status: 'failed', p_error_code: 'daily_quota_exceeded' });
    expect(settles[1]!.body).toMatchObject({ p_status: 'sent' });
    // Never the provider message (it quotes the address), never the address.
    expect(JSON.stringify(logged)).not.toContain('example.test');
  });

  it('a recipient who stopped being a platform admin mid-run (42501 on log) is skipped', async () => {
    const f = fakeFetch({
      platform_digest_begin: okBegin([ADMINS[0]!]),
      log_platform_digest_mail: () => jsonResponse(403, { code: '42501' }),
    });
    const res = await handleDigest(request(), { env: ENV, fetch: f.fetch, log: capture });
    expect(await res.json()).toEqual({ ok: true });
    expect(doneTotals()).toMatchObject({ recipients: 1, sent: 0, skipped: 1, failed: 0 });
  });

  it('without a Resend key and off the local stack: 503 after auth, no mail_log row', async () => {
    const f = fakeFetch({ platform_digest_begin: okBegin() });
    const res = await handleDigest(request(), {
      env: { ...ENV, RESEND_API_KEY: undefined, PLATFORM_DIGEST_MAIL_CATCHER_URL: 'http://mailpit:8025' },
      fetch: f.fetch,
      log: capture,
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'mail_not_configured' });
    expect(f.calls.map((c) => c.url)).toEqual([`${SUPABASE}/rest/v1/rpc/platform_digest_begin`]);
  });

  it('on the local stack without a key the mail goes to Mailpit', async () => {
    const f = fakeFetch({
      platform_digest_begin: okBegin([ADMINS[0]!]),
      log_platform_digest_mail: okLog(),
      'mailpit:8025/api/v1/send': () => jsonResponse(200, { ID: 'x' }),
      record_mail_send_result: () => jsonResponse(200, true),
    });
    const env = {
      SUPABASE_URL: 'http://kong:8000',
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      PLATFORM_DIGEST_MAIL_CATCHER_URL: 'http://mailpit:8025/',
    };
    // fakeFetch keys RPCs by path, so the kong URL works the same.
    const res = await handleDigest(request(), { env, fetch: f.fetch, log: capture });
    expect(await res.json()).toEqual({ ok: true });
    expect(doneTotals()).toMatchObject({ recipients: 1, sent: 1, skipped: 0, failed: 0 });
    const sent = f.calls.find((c) => c.url === 'http://mailpit:8025/api/v1/send')!;
    expect(sent.body.To).toEqual([{ Email: ADMINS[0]!.email }]);
  });

  it('the response body is only { ok: true }: pg_net stores it where app roles can read', async () => {
    const f = fakeFetch({
      platform_digest_begin: okBegin(),
      log_platform_digest_mail: okLog(),
      'api.resend.com/emails': () => jsonResponse(200, { id: 'm' }),
      record_mail_send_result: () => jsonResponse(200, true),
    });
    const res = await handleDigest(request(), { env: ENV, fetch: f.fetch, log: capture });
    expect(await res.text()).toBe('{"ok":true}');
  });

  it('never logs an address, the token or a key', async () => {
    const f = fakeFetch({
      platform_digest_begin: okBegin(),
      log_platform_digest_mail: okLog(),
      'api.resend.com/emails': () => jsonResponse(500, { name: 'internal', message: 'boom max@example.test' }),
      record_mail_send_result: () => jsonResponse(500, { message: 'down' }),
    });
    const lines: string[] = [];
    await handleDigest(request(), { env: ENV, fetch: f.fetch, log: (e, x) => lines.push(JSON.stringify([e, x])) });
    const all = lines.join('\n');
    for (const secret of ['example.test', TOKEN, SERVICE_KEY, RESEND_KEY]) expect(all).not.toContain(secret);
  });
});

describe('platform-digest config helpers', () => {
  it('only local hosts count as the local stack', () => {
    for (const u of ['http://kong:8000', 'http://127.0.0.1:55321', 'http://localhost:54321', 'http://supabase_kong_x:8000'])
      expect(isLocalSupabaseUrl(u)).toBe(true);
    for (const u of [undefined, '', 'https://tolxwgqhppdcvnogdpel.supabase.co', 'https://kong.evil.test', 'nonsense'])
      expect(isLocalSupabaseUrl(u)).toBe(false);
  });

  it('a Resend key always wins; the catcher never applies to a hosted project', () => {
    expect(mailTransport({ RESEND_API_KEY: 'k', PLATFORM_DIGEST_MAIL_CATCHER_URL: 'http://m' }).kind).toBe('resend');
    expect(
      mailTransport({ SUPABASE_URL: 'https://ref.supabase.co', PLATFORM_DIGEST_MAIL_CATCHER_URL: 'http://m' }).kind
    ).toBe('none');
    expect(mailTransport({ SUPABASE_URL: 'http://kong:8000' }).kind).toBe('none');
  });

  it('the Overview link needs an https origin (or http on localhost) and is otherwise left out', () => {
    expect(overviewUrl('https://app.example.test/some/path')).toBe('https://app.example.test/app/platform/overview');
    expect(overviewUrl('http://localhost:7000')).toBe('http://localhost:7000/app/platform/overview');
    expect(overviewUrl('http://app.example.test')).toBeNull();
    expect(overviewUrl('javascript:alert(1)')).toBeNull();
    expect(overviewUrl(undefined)).toBeNull();
  });

  it('parseBegin rejects a payload that is not the begin document', () => {
    expect(parseBegin(null)).toBeNull();
    expect(parseBegin({ ...NUMBERS, recipients: 'x' })).toBeNull();
    expect(parseBegin({ ...NUMBERS, digest_date: 'yesterday', recipients: [] })).toBeNull();
    expect(parseBegin({ ...NUMBERS, recipients: ADMINS })?.recipients).toEqual(ADMINS);
  });
});

describe('platform-digest template', () => {
  const mail = renderPlatformDigest(NUMBERS, 'https://app.example.test/app/platform/overview');

  it('subject: companies and trials ending, singular/plural right', () => {
    expect(mail.subject).toBe('PlusOne today: 12 companies, 3 trials ending');
    const one = renderPlatformDigest(
      {
        ...NUMBERS,
        subscriptions: { ...NUMBERS.subscriptions, total_companies: 1 },
        funnel: { ...NUMBERS.funnel, ending_7d: 1 },
      },
      null
    );
    expect(one.subject).toBe('PlusOne today: 1 company, 1 trial ending');
  });

  it('carries every aggregate, the date and the support footer, in html and text', () => {
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain('Thu 8 Oct');
      expect(body).toContain('support@plus-one.io');
      expect(body).toContain('840'); // check-ins
      expect(body).toContain('5, 2 now paying');
      expect(body).toContain('Dormant');
      expect(body).toContain('https://app.example.test/app/platform/overview');
    }
    // Paying = monthly + yearly + unknown.
    expect(mail.text).toContain('Paying: 5');
    // The subset of trials with a payment set up (20261013140000).
    expect(mail.text).toContain('Trial, payment set up: 1');
  });

  it('no Overview link when the origin is unknown', () => {
    const m = renderPlatformDigest(NUMBERS, null);
    expect(m.html).not.toContain('<a ');
    expect(m.text).not.toContain('Open the Overview');
  });

  it('a garbage count from the database reads 0, never markup', () => {
    const m = renderPlatformDigest(
      {
        ...NUMBERS,
        usage: { ...NUMBERS.usage, events: '<script>' as unknown as number },
      },
      null
    );
    expect(m.html).not.toContain('<script>');
    expect(m.text).toContain('Events: 0');
  });

  it('copy rules: no em or en dashes in what the reader sees', () => {
    const visible = mail.text + mail.subject;
    expect(visible).not.toMatch(/[–—]/);
  });

  it('formatDigestDate is pure calendar arithmetic', () => {
    expect(formatDigestDate('2026-10-08')).toBe('Thu 8 Oct');
    expect(formatDigestDate('2026-03-29')).toBe('Sun 29 Mar');
    expect(formatDigestDate('2026-02-30')).toBe('today');
    expect(formatDigestDate('nope')).toBe('today');
  });
});
