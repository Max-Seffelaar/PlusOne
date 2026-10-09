// The guest's calendar file (/s/[token]/calendar.ics, guest mail F): "Apple or
// Outlook (.ics)" in the mail and on the status page. Same token, same
// throttled RPC and the same neutral answer as the status page: anything that
// is not a live status token, or a spot that no longer holds, is a bare 404.
// The UID is the event id, so a later download updates the entry already in
// the guest's calendar.

import { buildIcs } from '@/features/mail/ics';
import { loadGuestStatus } from '@/features/mail/guest-status-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const view = await loadGuestStatus(token);
  if (!view || (view.state !== 'on_list' && view.state !== 'checked_in')) {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  return new Response(buildIcs(view.calendar), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="event.ics"',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
    },
  });
}
