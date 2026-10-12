import 'server-only';

import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { analyticsConfigured } from './config';

/**
 * Whether the signed-in user turned in-app analytics off (20261018120000), for
 * the `/app` layout to hand to AnalyticsGate.
 *
 * A separate read, not a column in `getMyProfile()`, on purpose: Vercel deploys
 * on merge and the schema follows in the prod push, so for a while the deployed
 * app can run against a database without the column. Inside the shared profile
 * read that would fail the consent gate for every user; here it only means "not
 * tracked". Fail closed throughout: an error or a missing row reads as opted out.
 *
 * Without a PostHog key nothing is tracked anyway, so there is no query at all.
 */
export const getAnalyticsOptOut = cache(async (userId: string): Promise<boolean> => {
  if (!analyticsConfigured()) return true;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc('my_profile')
      .select('analytics_opt_out_at')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return true;
    return data.analytics_opt_out_at !== null;
  } catch {
    return true;
  }
});
