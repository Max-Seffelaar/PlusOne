/**
 * The team mail job endpoint answers {"ok":true} only on success (review
 * #458): pg_net stores every response in net._http_response, readable by app
 * roles, so the counts stay in the server log.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const H = vi.hoisted(() => ({
  result: { status: 200, totals: { claimed: 3, sent: 2, failed: 1 } } as
    | { status: 200; totals: { claimed: number; sent: number; failed: number } }
    | { status: 401; error: string },
}));

vi.mock('@/features/mail/team-job', () => ({
  defaultTeamMailDeps: () => ({}),
  runTeamMailsRoute: vi.fn(async () => H.result),
}));

import { POST } from './route';

afterEach(() => {
  vi.restoreAllMocks();
});

function call() {
  return POST(new Request('http://localhost/api/webhooks/team-mails', { method: 'POST', headers: { 'x-team-mails-token': 'a'.repeat(64) } }));
}

describe('POST /api/webhooks/team-mails', () => {
  it('a run answers {"ok":true} and nothing else; the counts go to the log', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(info.mock.calls[0]?.[0]).toContain('"sent":2');
  });

  it('a refused token answers the error code only', async () => {
    H.result = { status: 401, error: 'invalid_token' };
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_token' });
  });
});
