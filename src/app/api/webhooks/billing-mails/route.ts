// Billing-mail job endpoint (Billing-mails B1, z8uq9m2z19). The only caller is
// pg_net: billing_mails_tick (pg_cron, hourly 08:00 to 20:59 Amsterdam) mints a
// single-use token and POSTs here with it in `x-billing-mails-token`. There is
// no user session: the middleware exempts /api/webhooks/, and authentication
// is billing_mails_begin(), which CONSUMES the token before anything is read
// and refuses (42501) an unknown, expired or reused one. Nothing from the body
// is read. The 200 body is `{"ok":true}` only: pg_net stores every response
// in net._http_response, which app roles can read on Supabase, so even the
// run's counts stay in the server log (the job's `done` line), as in the
// platform digest (#440).

import { defaultBillingMailDeps, runBillingMails } from '@/features/billing/mail-job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A run sends a handful of mails at most; pg_net waits 60 s.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const result = await runBillingMails(req.headers.get('x-billing-mails-token'), defaultBillingMailDeps());
  const body = result.status === 200 ? { ok: true } : { error: result.error };
  return Response.json(body, { status: result.status });
}

export function GET(): Response {
  return Response.json({ error: 'method_not_allowed' }, { status: 405 });
}
