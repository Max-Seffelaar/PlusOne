'use client';

import { useQuery } from '@tanstack/react-query';
import { getDoorClient } from '@/features/door/offline/device';

/**
 * May THIS user undo a check-in at this event? Asked of the database
 * (`can_uncheck_check_in`, the same function the RESTRICTIVE check_ins policy
 * uses), so the cockpit's ✗ and the boundary give the same answer — including
 * for a platform admin without an admin membership (review of PR #423).
 * `fallback` (the role-based guess) is used until the answer arrives or if the
 * rpc fails; the database stays the boundary either way.
 */
export function useCanUncheck(eventId: string, fallback: boolean): boolean {
  const q = useQuery({
    queryKey: ['can-uncheck', eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await getDoorClient().rpc('can_uncheck_check_in', { p_event_id: eventId });
      if (error) throw error;
      return data === true;
    },
  });
  return typeof q.data === 'boolean' ? q.data : fallback;
}
