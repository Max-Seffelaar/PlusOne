/**
 * Billing-mail job route (z8uq9m2z19): the 200 body is {"ok":true} only. pg_net
 * keeps every response in net._http_response, which app roles can read on
 * Supabase, so not even the run's counts may leave the server here.
 */
import { describe, expect, it, vi } from 'vitest';

const run = vi.fn();
vi.mock('@/features/billing/mail-job', () => ({
  runBillingMails: (...args: unknown[]) => run(...args),
  defaultBillingMailDeps: () => ({}),
}));

const { POST, GET } = await import('./route');

function req(token?: string): Request {
  return new Request('http://localhost/api/webhooks/billing-mails', {
    method: 'POST',
    headers: token ? { 'x-billing-mails-token': token } : {},
  });
}

describe('POST /api/webhooks/billing-mails', () => {
  it('answers {"ok":true} on a run, never the counts', async () => {
    run.mockResolvedValueOnce({ status: 200, totals: { mails: 3, sent: 5, skipped: 1, failed: 0 } });
    const res = await POST(req('a'.repeat(64)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(run).toHaveBeenLastCalledWith('a'.repeat(64), {});
  });

  it('passes the header (or null) and answers the error code only', async () => {
    run.mockResolvedValueOnce({ status: 401, error: 'invalid_token' });
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_token' });
    expect(run).toHaveBeenLastCalledWith(null, {});
  });

  it('GET is 405', async () => {
    expect(GET().status).toBe(405);
  });
});
