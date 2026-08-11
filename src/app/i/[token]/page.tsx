import type { JSX } from 'react';
import type { Metadata } from 'next';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { landingClientIpHash } from '@/features/requests/ip-hash';
import { InfluencerStats, type InfluencerStatsData, type InfluencerStatsEvent } from '@/components/po/influencer-stats';
import { t } from '@/lib/i18n';

export const metadata: Metadata = {
  title: t.influencerStats.pageTitle,
  // Bearer stats URLs are private; never index them.
  robots: { index: false, follow: false },
};

// See src/lib/public-route-viewport.ts — overrides the root layout's locked
// viewport for this public route (WCAG 1.4.4).
export { publicRouteViewport as viewport } from '@/lib/public-route-viewport';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Europe/Amsterdam',
});

interface StatsEventPayload {
  event_name?: string;
  starts_at?: string;
  ends_at?: string | null;
  slug?: string | null;
  views?: number;
  requests?: number;
  approved_heads?: number;
  checked_in_heads?: number;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Public influencer stats page (/i/[token], F2 86ey6b3fe — S16). The URL carries
 * a bearer token; only its sha256 is looked up (get_influencer_stats: SECURITY
 * DEFINER, IP-throttled, minimal payload — the influencer's own funnel numbers,
 * no guest PII). Invalid and revoked tokens render the identical neutral
 * not-found, mirroring /r/[token].
 */
export default async function InfluencerStatsPage({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<JSX.Element> {
  const { token } = await params;
  const supabase = await createClient();

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const { data } = await supabase.rpc('get_influencer_stats', {
    p_token_hash: tokenHash,
    p_ip_hash: await landingClientIpHash(),
  });

  const payload = (data ?? {}) as {
    found?: boolean;
    name?: string;
    handle?: string | null;
    venue_name?: string;
    totals?: { views?: number; requests?: number; approved_heads?: number; checked_in_heads?: number };
    events?: StatsEventPayload[];
  };

  let view: InfluencerStatsData | null = null;
  if (payload.found && payload.name && payload.venue_name) {
    const now = Date.now();
    const venueName = payload.venue_name;
    const events: InfluencerStatsEvent[] = (payload.events ?? [])
      .filter((e): e is StatsEventPayload & { event_name: string; starts_at: string } => !!e.event_name && !!e.starts_at)
      .map((e, i) => {
        const startsMs = Date.parse(e.starts_at);
        const endsMs = e.ends_at ? Date.parse(e.ends_at) : startsMs + SIX_HOURS_MS;
        return {
          key: e.slug ?? `${e.event_name}-${i}`,
          name: e.event_name,
          dateLabel: `${dateFmt.format(new Date(startsMs))} · ${venueName}`,
          past: endsMs < now,
          slug: e.slug ?? null,
          startsMs,
          f: {
            views: e.views ?? 0,
            requests: e.requests ?? 0,
            approved: e.approved_heads ?? 0,
            checkedIn: e.checked_in_heads ?? 0,
          },
        };
      })
      // Upcoming soonest-first, past most-recent-first.
      .sort((a, b) => (a.past === b.past ? (a.past ? b.startsMs - a.startsMs : a.startsMs - b.startsMs) : a.past ? 1 : -1))
      .map(({ startsMs: _startsMs, ...rest }) => rest);

    view = {
      name: payload.name,
      venueName,
      totals: {
        views: payload.totals?.views ?? 0,
        requests: payload.totals?.requests ?? 0,
        approved: payload.totals?.approved_heads ?? 0,
        checkedIn: payload.totals?.checked_in_heads ?? 0,
      },
      events,
    };
  }

  return <InfluencerStats data={view} />;
}
