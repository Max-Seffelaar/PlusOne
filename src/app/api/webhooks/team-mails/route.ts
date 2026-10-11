// Team notification mail job endpoint (Gastcommunicatie F, PR 6b, z8uq9m2vpy).
// The only caller is pg_net: team_mails_tick (pg_cron, every minute, only when
// something is due) and the notification_outbox insert trigger mint a
// single-use token and POST here with it in `x-team-mails-token`. There is no
// user session: the middleware exempts /api/webhooks/, and authentication is
// team_mails_begin(), which CONSUMES the token before anything is read and
// refuses (42501) an unknown, expired or reused one. Nothing from the body is
// read. A success answers {"ok":true} only: pg_net keeps every response in
// net._http_response, which app roles can read, so the counts go to the
// server log instead (the #440/#446/#453 rule; review #458).

import { defaultTeamMailDeps, runTeamMailsRoute } from '@/features/mail/team-job';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Four batches of 100 at most, paced for Resend's rate limit; pg_net waits 55 s.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const result = await runTeamMailsRoute(req.headers.get('x-team-mails-token'), defaultTeamMailDeps());
  if (result.status !== 200) return Response.json({ error: result.error }, { status: result.status });
  console.info(JSON.stringify({ job: 'team-mails', event: 'run', ...result.totals }));
  return Response.json({ ok: true }, { status: 200 });
}

export function GET(): Response {
  return Response.json({ error: 'method_not_allowed' }, { status: 405 });
}
