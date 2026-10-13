'use client';

// Guest-mail bits of the event screens (Gastcommunicatie F, z8uq9m2vpy): the
// platform-admin "Send reminder" test button. House rules moved into the event
// form (fetchEventForEdit + updateEvent) with the info for guests
// (z8uq9m4a5n follow-up), so they save with the event.

import { useMutation, useQuery } from '@tanstack/react-query';
import { guestReminderAvailable, sendGuestReminder } from '@/features/events/actions';
import { poKeys } from './keys';

const reminderKey = () => [...poKeys.all, 'guest-reminder-available'] as const;

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
