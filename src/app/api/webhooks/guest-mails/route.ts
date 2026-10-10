// Guest-mail job endpoint (Gastcommunicatie F, z8uq9m2vpy). The only caller is
// pg_net: guest_mails_tick (pg_cron, every minute, only when a row is due)
// mints a single-use token and POSTs here with it in `x-guest-mails-token`.
// There is no user session: the middleware exempts /api/webhooks/, and
// authentication is guest_mails_begin(), which CONSUMES the token before
// anything is read and refuses (42501) an unknown, expired or reused one.
// Nothing from the body is read. Responses carry counts only.

import { defaultGuestMailDeps, runGuestMailsRoute } from '@/features/mail/guest-job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Four batches of 100 at most, paced for Resend's rate limit; pg_net waits 55 s.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const result = await runGuestMailsRoute(req.headers.get('x-guest-mails-token'), defaultGuestMailDeps());
  const body = result.status === 200 ? result.totals : { error: result.error };
  return Response.json(body, { status: result.status });
}

export function GET(): Response {
  return Response.json({ error: 'method_not_allowed' }, { status: 405 });
}
