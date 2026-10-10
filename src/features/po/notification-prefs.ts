'use client';

// Profile → Notifications (6b): the caller's own preferences. Read through the
// my_notification_prefs RPC (the table is closed to app roles), written
// through saveNotificationPrefsAction. Optimistic: the switch moves at once,
// a failed save rolls it back. A change is applied to the latest cached value,
// so quick taps never overwrite each other.

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
  const mutationKey = [...prefsKey(userId), 'save'] as const;
  const mutation = useMutation({
    mutationKey,
    mutationFn: async ({ next }: { next: NotificationPrefs; before: NotificationPrefs | undefined }) => {
      const res = await saveNotificationPrefsAction(next);
      if (!res.ok) throw new Error(res.message ?? 'save failed');
      return res.prefs;
    },
    onError: (_e, { before }) => {
      if (before) qc.setQueryData(prefsKey(userId), before);
    },
    // Only the last save in flight writes the server's answer back, so an
    // earlier answer never undoes a later tap.
    onSuccess: (prefs) => {
      if (qc.isMutating({ mutationKey }) <= 1) qc.setQueryData(prefsKey(userId), prefs);
    },
  });
  /**
   * Apply a change to the LATEST preferences, synchronously: two quick taps
   * each build on the one before (review #458 N6), never on a stale render.
   */
  const update = (change: (prefs: NotificationPrefs) => NotificationPrefs): void => {
    const before = qc.getQueryData<NotificationPrefs>(prefsKey(userId));
    if (!before) return;
    const next = change(before);
    void qc.cancelQueries({ queryKey: prefsKey(userId), exact: true });
    qc.setQueryData(prefsKey(userId), next);
    mutation.mutate({ next, before });
  };
  return { ...mutation, update };
}
