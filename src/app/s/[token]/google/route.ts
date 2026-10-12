// The guest's live Google Calendar link (/s/[token]/google, z8uq9m4a5n;
// decision Max 2026-10-11). The guest mails link here instead of a Google
// URL frozen at send time: every click reads the CURRENT event (name, time,
// location, info for guests) through the same token-gated, throttled RPC as
// the status page and calendar.ics, then answers a 302 to Google's "add
// event" form. Same neutral answer as calendar.ics: anything that is not a
// live status token, or a spot that no longer holds, is a bare 404, so the
// route never says whether a guest exists.
//
// The token is the only identifier in the URL, and it never travels on:
// `Referrer-Policy: no-referrer` on the redirect stops the browser sending
// this URL to Google as the Referer, and nothing is cached on the way.

import { googleCalendarUrl } from '@/features/mail/ics';
import { loadGuestStatus } from '@/features/mail/guest-status-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
} as const;

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const view = await loadGuestStatus(token);
  if (!view || (view.state !== 'on_list' && view.state !== 'checked_in')) {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return new Response(null, {
    status: 302,
    headers: { ...PRIVATE_HEADERS, Location: googleCalendarUrl(view.calendar) },
  });
}
