'use client';

// Guest-mail bits of the event screens (Gastcommunicatie F, z8uq9m2vpy): the
// event's house rules (shown in "You're on the list") and the platform-admin
// "Send reminder" test button. Reads over the browser client (RLS); writes
// through the shared event server actions. Its own module so the event-edit
// form and its fetchers stay untouched.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { guestReminderAvailable, sendGuestReminder, updateEvent } from '@/features/events/actions';
import { poKeys } from './keys';

const houseRulesKey = (eventId: string) => [...poKeys.all, 'house-rules', eventId] as const;
const reminderKey = () => [...poKeys.all, 'guest-reminder-available'] as const;

export function usePoHouseRules(eventId: string) {
  return useQuery<string>({
    queryKey: houseRulesKey(eventId),
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await createClient().from('events').select('house_rules').eq('id', eventId).maybeSingle();
      if (error) throw error;
      return data?.house_rules ?? '';
    },
  });
}

export function usePoSaveHouseRules(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (houseRules: string) => {
      const res = await updateEvent({ eventId, houseRules: houseRules.trim() || null });
      if (!res.ok) throw new Error(res.message ?? 'Something went wrong.');
      return res;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: houseRulesKey(eventId) }),
  });
}

/** Whether to show "Send reminder" (platform admin + GUEST_REMINDER_ENABLED). */
export function usePoGuestReminderAvailable() {
  return useQuery<boolean>({
    queryKey: reminderKey(),
    staleTime: 5 * 60 * 1000,
    queryFn: () => guestReminderAvailable(),
  });
}

export function usePoSendGuestReminder(eventId: string) {
  return useMutation({
    mutationFn: async () => {
      const res = await sendGuestReminder({ eventId });
      if (!res.ok) throw new Error(res.message ?? 'Something went wrong.');
      return res;
    },
  });
}
