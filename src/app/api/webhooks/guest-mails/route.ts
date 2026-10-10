// Guest-mail job endpoint (Gastcommunicatie F, z8uq9m2vpy). The only caller is
// pg_net: guest_mails_tick (pg_cron, every minute, only when a row is due)
// mints a single-use token and POSTs here with it in `x-guest-mails-token`.
// There is no user session: the middleware exempts /api/webhooks/, and
// authentication is guest_mails_begin(), which CONSUMES the token before
// anything is read and refuses (42501) an unknown, expired or reused one.
// Nothing from the body is read. A success answers {"ok":true} only: pg_net
// keeps every response in net._http_response, which app roles can read, so
// the run's counts go to the server log (the #440/#446 rule; review #458).

import { defaultGuestMailDeps, runGuestMailsRoute } from '@/features/mail/guest-job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Four batches of 100 at most, paced for Resend's rate limit; pg_net waits 55 s.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const result = await runGuestMailsRoute(req.headers.get('x-guest-mails-token'), defaultGuestMailDeps());
  if (result.status !== 200) return Response.json({ error: result.error }, { status: result.status });
  console.info(JSON.stringify({ job: 'guest-mails', event: 'run', ...result.totals }));
  return Response.json({ ok: true }, { status: 200 });
}

export function GET(): Response {
  return Response.json({ error: 'method_not_allowed' }, { status: 405 });
}
