import type { JSX } from 'react';
import type { Metadata } from 'next';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { landingClientIpHash } from '@/features/requests/ip-hash';
import { toRequestStatusView } from '@/features/requests/status-view';
import { RequestStatus } from '@/components/po/request-status';

export const metadata: Metadata = {
  title: 'Your request · PlusOne',
  // Bearer status URLs are private; never index them.
  robots: { index: false, follow: false },
};

// See src/lib/public-route-viewport.ts — overrides the root layout's locked
// viewport for this public route (WCAG 1.4.4).
export { publicRouteViewport as viewport } from '@/lib/public-route-viewport';

/**
 * Guest status page (/r/[token], #28). The URL carries a bearer token; only its
 * sha256 is looked up (get_request_status: SECURITY DEFINER, throttled, minimal
 * payload: no contact data, no decision reason). Invalid, revoked, anonymized
 * and throttled tokens all render the identical neutral not-found: the adapter
 * turns anything that is not a found payload into `null`. What a found token
 * sees per state (z8uq9m0hw6: the window, and on approval the venue address,
 * the approved count and the venue's message) is decided by the RPC and
 * re-gated in `toRequestStatusView`.
 */
export default async function RequestStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<JSX.Element> {
  const { token } = await params;
  const supabase = await createClient();

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data } = await supabase.rpc('get_request_status', {
    p_token_hash: tokenHash,
    p_ip_hash: await landingClientIpHash(),
  });

  return <RequestStatus data={toRequestStatusView(data)} />;
}
