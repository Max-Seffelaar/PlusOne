/**
 * Resend adapter (Mail-infra F0): request shape (Idempotency-Key, sender) and
 * the failure mapping, incl. the daily-quota 429 that must not turn into a
 * retry storm. fetch is stubbed; nothing leaves the process.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchReceivedMailMeta, ResendAdapter } from './resend-adapter';
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

describe('ResendAdapter.sendBatch', () => {
  const second: OutgoingMail = { ...MAIL, to: 'b@example.test', idempotencyKey: 'mail_log/2' };

  it('posts all mails to the batch endpoint with one key, sender/reply-to/headers per mail', async () => {
    const fetchFn = stubFetch(200, { data: [{ id: 're_a' }, { id: 're_b' }] });
    const res = await new ResendAdapter('re_test_key').sendBatch(
      [{ ...MAIL, from: '"Neon via PlusOne" <noreply+k@plus-one.io>', replyTo: 'hi@club.test', headers: { 'List-Unsubscribe': '<https://x/u/t>' } }, second],
      'guest_batch/abc',
    );
    expect(res).toEqual([
      { ok: true, providerMessageId: 're_a' },
      { ok: true, providerMessageId: 're_b' },
    ]);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails/batch');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('guest_batch/abc');
    const body = JSON.parse(String(init.body)) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(2);
    expect(body[0].from).toBe('"Neon via PlusOne" <noreply+k@plus-one.io>');
    expect(body[0].reply_to).toEqual(['hi@club.test']);
    expect(body[0].headers).toEqual({ 'List-Unsubscribe': '<https://x/u/t>' });
    expect(body[1].from).toBe('PlusOne <noreply@plus-one.io>');
    expect(body[1].reply_to).toBeUndefined();
  });

  it('a refused batch fails every mail with the mapped code (daily quota: no retry storm)', async () => {
    stubFetch(429, { name: 'daily_quota_exceeded', message: 'quota for b@example.test' });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await new ResendAdapter('k').sendBatch([MAIL, second], 'guest_batch/x');
    expect(res).toEqual([
      { ok: false, errorCode: 'daily_quota_exceeded' },
      { ok: false, errorCode: 'daily_quota_exceeded' },
    ]);
  });

  it('a network error fails the batch without throwing; an empty batch makes no call', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    vi.stubGlobal('fetch', fetchFn);
    expect(await new ResendAdapter('k').sendBatch([MAIL], 'x')).toEqual([{ ok: false, errorCode: 'network' }]);
    expect(await new ResendAdapter('k').sendBatch([], 'x')).toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('fetchReceivedMailMeta (inbound auto-reply gate)', () => {
  it('reads the verdicts and loop headers of a received mail, nothing else', async () => {
    const fetchFn = stubFetch(200, {
      id: 'in_1',
      from: 'lotte@example.test',
      subject: 'SECRET',
      headers: { 'Auto-Submitted': 'auto-replied', precedence: 'bulk', 'List-Id': '<l.example.test>' },
      authentication: { spf: 'pass', dkim: 'gray', dmarc: 'fail' },
    });
    const meta = await fetchReceivedMailMeta('re_test_key', 'in_1');
    expect(meta).toEqual({
      spf: 'pass',
      dkim: 'gray',
      dmarc: 'fail',
      headers: { autoSubmitted: 'auto-replied', precedence: 'bulk', listId: '<l.example.test>' },
    });
    expect(JSON.stringify(meta)).not.toContain('SECRET');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails/receiving/in_1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
  });

  it('an old mail without authentication reads as unknown; errors and odd ids give null (fail closed)', async () => {
    stubFetch(200, { id: 'in_2', headers: {}, authentication: null });
    expect(await fetchReceivedMailMeta('k', 'in_2')).toMatchObject({ spf: 'unknown', dkim: 'unknown', dmarc: 'unknown' });
    stubFetch(404, { name: 'not_found' });
    expect(await fetchReceivedMailMeta('k', 'in_3')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await fetchReceivedMailMeta('k', 'in_4')).toBeNull();
    const fetchFn = stubFetch(200, {});
    expect(await fetchReceivedMailMeta('k', '../emails')).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
