'use client';

// Profile → Product analytics (PostHog, decision 1): the caller's own opt-out.
// Read through my_profile() (the column has no SELECT grant, 20261018120000),
// written through setAnalyticsOptOutAction. Optimistic like the notification
// prefs: the switch moves at once, a failed save rolls it back.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { setAnalyticsOptOutAction } from '@/features/analytics/actions';
import { analytics } from '@/features/analytics/provider';
import { usePoIdentity } from './PoLiveProvider';
import { poKeys } from './keys';

const optOutKey = (userId: string) => [...poKeys.all, 'analytics-opt-out', userId] as const;

/** `true` = opted out. */
export function usePoAnalyticsOptOut() {
  const { userId } = usePoIdentity();
  return useQuery<boolean>({
    queryKey: optOutKey(userId),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await createClient()
        .rpc('my_profile')
        .select('analytics_opt_out_at')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      return (data?.analytics_opt_out_at ?? null) !== null;
    },
  });
}

export function usePoSetAnalyticsOptOut() {
  const { userId } = usePoIdentity();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (optOut: boolean) => {
      const res = await setAnalyticsOptOutAction({ optOut });
      if (!res.ok) throw new Error(res.message ?? 'save failed');
      return res.optedOut;
    },
    onMutate: async (optOut) => {
      await qc.cancelQueries({ queryKey: optOutKey(userId), exact: true });
      const before = qc.getQueryData<boolean>(optOutKey(userId));
      qc.setQueryData(optOutKey(userId), optOut);
      // Stop at once on this device, before the server answers: an opt-out must
      // not wait on the network. Turning it back on is left to AnalyticsGate,
      // which re-reads the stored choice after the action refreshes the layout.
      if (optOut) analytics.optOut();
      return { before };
    },
    onError: (_e, _optOut, ctx) => {
      if (ctx?.before !== undefined) qc.setQueryData(optOutKey(userId), ctx.before);
    },
    onSuccess: (optedOut) => qc.setQueryData(optOutKey(userId), optedOut),
  });
}
