import type { Metadata, Viewport } from 'next';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { RequestStatus, type RequestStatusData } from '@/components/po/landing';

export const metadata: Metadata = {
  title: 'Your request · PlusOne',
  // Bearer status URLs are private; never index them.
  robots: { index: false, follow: false },
};

// Overrides the root layout's locked viewport for this public route (WCAG
// 1.4.4). Next merges viewport per-key across the segment tree rather than
// replacing wholesale (verified against the running dev server: omitting
// maximumScale/userScalable here left the root's `maximum-scale=1,
// user-scalable=no` in the rendered meta tag) — so they must be explicitly
// overridden, not just left out.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  colorScheme: 'dark',
  themeColor: '#0B0B0D',
};

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Amsterdam',
});

async function statusIpHash(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const ip = (forwarded ? forwarded.split(',')[0] : h.get('x-real-ip') ?? '').trim();
  const salt = process.env.LANDING_IP_SALT ?? 'plusone-landing-dev-salt';
  return createHash('sha256').update(`${salt}:${ip || 'no-ip'}`).digest('hex');
}

/**
 * Guest status page (/r/[token], #28). The URL carries a bearer token; only its
 * sha256 is looked up (get_request_status: SECURITY DEFINER, throttled, minimal
 * payload — no contact data, no decision reason). Invalid, revoked and
 * anonymized tokens render the identical neutral not-found.
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
    p_ip_hash: await statusIpHash(),
  });

  const payload = (data ?? {}) as {
    found?: boolean;
    status?: 'pending' | 'approved' | 'denied';
    full_name?: string;
    plus_ones?: number;
    event_name?: string;
    starts_at?: string;
  };

  const view: RequestStatusData | null =
    payload.found && payload.status && payload.event_name
      ? {
          status: payload.status,
          fullName: payload.full_name ?? '',
          plusOnes: payload.plus_ones ?? 0,
          eventName: payload.event_name,
          date: dateFmt.format(new Date(payload.starts_at ?? Date.now())),
        }
      : null;

  return <RequestStatus data={view} />;
}
