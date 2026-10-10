/**
 * One guard for every mail job route under /api/webhooks/*-mails (review #458):
 * the only caller is pg_net, which keeps every response in net._http_response,
 * readable by app roles on Supabase. So a successful run answers {"ok":true}
 * and nothing else; its counts belong in the server log (#440/#446). A new
 * *-mails route fails here until it is listed below.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const TOTALS = { claimed: 7, sent: 6, failed: 1 };

vi.mock('@/features/mail/guest-job', () => ({
  defaultGuestMailDeps: () => ({}),
  runGuestMailsRoute: vi.fn(async () => ({ status: 200, totals: TOTALS })),
}));
vi.mock('@/features/mail/team-job', () => ({
  defaultTeamMailDeps: () => ({}),
  runTeamMailsRoute: vi.fn(async () => ({ status: 200, totals: TOTALS })),
}));
vi.mock('@/features/billing/mail-job', () => ({
  defaultBillingMailDeps: () => ({}),
  runBillingMails: vi.fn(async () => ({ status: 200, totals: TOTALS, sent: 6 })),
}));

const ROUTES: Record<string, () => Promise<{ POST: (req: Request) => Promise<Response> }>> = {
  'guest-mails': () => import('@/app/api/webhooks/guest-mails/route'),
  'team-mails': () => import('@/app/api/webhooks/team-mails/route'),
  'billing-mails': () => import('@/app/api/webhooks/billing-mails/route'),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mail job routes answer {"ok":true} only', () => {
  it('every *-mails webhook route is covered by this guard', () => {
    const dir = path.resolve(process.cwd(), 'src/app/api/webhooks');
    const jobRoutes = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.endsWith('-mails'))
      .map((d) => d.name)
      .sort();
    expect(jobRoutes).toEqual(Object.keys(ROUTES).sort());
  });

  it.each(Object.keys(ROUTES))('%s: a run answers exactly {"ok":true}, no counts', async (name) => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { POST } = await (ROUTES[name] as () => Promise<{ POST: (req: Request) => Promise<Response> }>)();
    const res = await POST(new Request(`http://localhost/api/webhooks/${name}`, { method: 'POST' }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ ok: true });
    expect(text).not.toMatch(/claimed|sent|failed/);
  });
});
