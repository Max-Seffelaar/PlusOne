/**
 * Resend adapter (Mail-infra F0): request shape (Idempotency-Key, sender) and
 * the failure mapping, incl. the daily-quota 429 that must not turn into a
 * retry storm. fetch is stubbed; nothing leaves the process.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResendAdapter } from './resend-adapter';
import type { OutgoingMail } from './provider';

const MAIL: OutgoingMail = {
  to: 'crew@example.test',
  subject: 'Max invited you to join Club Vesper',
  html: '<p>hi</p>',
  text: 'hi',
  idempotencyKey: 'mail_log/0192f0aa-0000-7000-8000-000000000001',
  type: 'team_join',
};

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ResendAdapter.send', () => {
  it('posts once with the Idempotency-Key, the PlusOne sender and a type tag', async () => {
    const fetchFn = stubFetch(200, { id: 're_123' });
    const res = await new ResendAdapter('re_test_key').send(MAIL);
    expect(res).toEqual({ ok: true, providerMessageId: 're_123' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe(MAIL.idempotencyKey);
    expect(headers.Authorization).toBe('Bearer re_test_key');
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe('PlusOne <noreply@plus-one.io>');
    expect(body.to).toEqual(['crew@example.test']);
    expect(body.tags).toEqual([{ name: 'type', value: 'team_join' }]);
  });

  it.each([
    [{ name: 'daily_quota_exceeded' }, 'daily_quota_exceeded'],
    [{ name: 'monthly_quota_exceeded' }, 'monthly_quota_exceeded'],
    [{ name: 'rate_limit_exceeded' }, 'rate_limited'],
    [null, 'rate_limited'],
  ])('maps a 429 %j to %s with exactly one request (no retry)', async (body, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchFn = stubFetch(429, body);
    expect(await new ResendAdapter('k').send(MAIL)).toEqual({ ok: false, errorCode: code });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('maps 4xx to provider_rejected and 5xx to provider_unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(422, { name: 'validation_error', message: 'crew@example.test is invalid' });
    expect(await new ResendAdapter('k').send(MAIL)).toEqual({ ok: false, errorCode: 'provider_rejected' });
    stubFetch(503, {});
    expect(await new ResendAdapter('k').send(MAIL)).toEqual({ ok: false, errorCode: 'provider_unavailable' });
  });

  it('never logs the provider message or the address', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch(422, { name: 'validation_error', message: 'crew@example.test is invalid' });
    await new ResendAdapter('k').send(MAIL);
    expect(JSON.stringify(log.mock.calls)).not.toContain('crew@example.test');
  });

  it('maps a timeout and a network error without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }));
    expect(await new ResendAdapter('k').send(MAIL)).toEqual({ ok: false, errorCode: 'timeout' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await new ResendAdapter('k').send(MAIL)).toEqual({ ok: false, errorCode: 'network' });
  });
});
