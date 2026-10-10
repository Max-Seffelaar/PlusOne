import 'server-only';

// Team notification mail hook for the server actions (Gastcommunicatie F, PR
// 6b, z8uq9m2vpy). The outbox rows themselves are written by the database
// triggers on guest_requests / quota_requests (per recipient, per channel,
// per preference); an action only asks for the due ones to go out now, in
// after(): the response has already gone, the user never waits on the mail
// provider, and a failure is logged (codes only) and changes nothing. The
// pg_cron tick sends anything this misses within a minute.

import { after } from 'next/server';
import { guestMailActive } from './config';
import { defaultTeamMailDeps, drainTeamMails } from './team-job';

/** Send the team mails that are due now (a new request, quota request or decision). */
export function drainTeamMailsSoon(): void {
  if (!guestMailActive()) return;
  after(async () => {
    try {
      await drainTeamMails(defaultTeamMailDeps());
    } catch (err) {
      console.warn(JSON.stringify({ job: 'team-mails', event: 'drain_failed', error: err instanceof Error ? err.name : 'unknown' }));
    }
  });
}
