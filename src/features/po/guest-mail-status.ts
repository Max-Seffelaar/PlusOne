'use client';

// The confirmation-mail state per guest (ClickUp z8uq9m49k1, decision Max
// 2026-10-11 #1): read through event_guest_mail_status (members and organizers
// of the event; the queue itself is closed to app roles), one read per event
// shared by the guest list and the guest's event sheet. Resend goes through
// resendGuestConfirmation (RLS decides who may).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { resendGuestConfirmation } from '@/features/guests/confirmation-actions';
import { poKeys } from './keys';

export type ConfirmationState =
  | 'not_sent'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'opted_out';

export interface GuestConfirmation {
  state: ConfirmationState;
  canResend: boolean;
  needsNewAddress: boolean;
}

const STATES: readonly ConfirmationState[] = [
  'not_sent', 'queued', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'opted_out',
];

const statusKey = (eventId: string) => [...poKeys.all, 'guest-mail-status', eventId] as const;

/** guestId → confirmation state, for one event. Guests without an address are absent. */
export async function fetchGuestMailStatus(eventId: string): Promise<Map<string, GuestConfirmation>> {
  const { data, error } = await createClient().rpc('event_guest_mail_status', { p_event_id: eventId });
  if (error) throw error;
  const out = new Map<string, GuestConfirmation>();
  for (const row of data ?? []) {
    const state = STATES.includes(row.status as ConfirmationState) ? (row.status as ConfirmationState) : null;
    if (!row.guest_id || !state) continue;
    out.set(row.guest_id, { state, canResend: row.can_resend === true, needsNewAddress: row.needs_new_address === true });
  }
  return out;
}

export function usePoGuestMailStatus(eventId: string | null | undefined) {
  return useQuery({
    queryKey: statusKey(eventId ?? ''),
    enabled: !!eventId,
    staleTime: 30_000,
    queryFn: () => fetchGuestMailStatus(eventId as string),
  });
}

export function usePoResendConfirmation(eventId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (guestId: string) => {
      const res = await resendGuestConfirmation({ guestId });
      if (!res.ok) throw new Error(res.message);
    },
    onSettled: () => {
      if (eventId) void qc.invalidateQueries({ queryKey: statusKey(eventId) });
    },
  });
}
