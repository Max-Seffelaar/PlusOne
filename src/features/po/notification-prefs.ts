'use client';

// Profile → Notifications (6b): the caller's own preferences. Read through the
// my_notification_prefs RPC (the table is closed to app roles), written
// through saveNotificationPrefsAction. Optimistic: the switch moves at once,
// a failed save rolls it back.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { saveNotificationPrefsAction } from '@/features/notifications/prefs-actions';
import { toNotificationPrefs, type NotificationPrefs } from '@/features/notifications/prefs-schema';
import { usePoIdentity } from './PoLiveProvider';
import { poKeys } from './keys';

const prefsKey = (userId: string) => [...poKeys.all, 'notification-prefs', userId] as const;

export function usePoNotificationPrefs() {
  const { userId } = usePoIdentity();
  return useQuery<NotificationPrefs>({
    queryKey: prefsKey(userId),
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await createClient().rpc('my_notification_prefs');
      if (error) throw error;
      return toNotificationPrefs(data);
    },
  });
}

export function usePoSaveNotificationPrefs() {
  const { userId } = usePoIdentity();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (prefs: NotificationPrefs) => {
      const res = await saveNotificationPrefsAction(prefs);
      if (!res.ok) throw new Error(res.message ?? 'save failed');
      return res.prefs;
    },
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: prefsKey(userId) });
      const before = qc.getQueryData<NotificationPrefs>(prefsKey(userId));
      qc.setQueryData(prefsKey(userId), prefs);
      return { before };
    },
    onError: (_e, _prefs, ctx) => {
      if (ctx?.before) qc.setQueryData(prefsKey(userId), ctx.before);
    },
    onSuccess: (prefs) => qc.setQueryData(prefsKey(userId), prefs),
  });
}
