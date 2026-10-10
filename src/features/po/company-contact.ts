'use client';

// Guest contact of the active company (Gastcommunicatie F, z8uq9m2vpy): the
// contact address every guest mail names (reply-to + footer), the optional
// channels on the guest status page, and the default of the "Send
// confirmation" box. Read over the browser client (RLS: company members);
// written through updateCompanyContactAction (admins). Its own module so the
// venue-settings fetcher and task 3b's location work stay untouched.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { updateCompanyContactAction } from '@/features/venues/contact-actions';
import { CONTACT_CHANNELS, type ContactChannel } from '@/features/venues/contact-schema';
import { usePoIdentity } from './PoLiveProvider';
import { poKeys } from './keys';

export interface PoCompanyContact {
  contactEmail: string;
  channels: Record<ContactChannel, string>;
  guestConfirmationDefault: boolean;
}

type Client = ReturnType<typeof createClient>;

export function toPoCompanyContact(row: {
  contact_email: string | null;
  contact_channels: unknown;
  guest_confirmation_default: boolean;
}): PoCompanyContact {
  const raw = row.contact_channels && typeof row.contact_channels === 'object' ? (row.contact_channels as Record<string, unknown>) : {};
  const channels = Object.fromEntries(
    CONTACT_CHANNELS.map((k) => [k, typeof raw[k] === 'string' ? (raw[k] as string) : '']),
  ) as Record<ContactChannel, string>;
  return {
    contactEmail: row.contact_email ?? '',
    channels,
    guestConfirmationDefault: row.guest_confirmation_default,
  };
}

export async function fetchCompanyContact(client: Client, venueId: string): Promise<PoCompanyContact | null> {
  const { data, error } = await client
    .from('venues')
    .select('contact_email, contact_channels, guest_confirmation_default')
    .eq('id', venueId)
    .maybeSingle();
  if (error) throw error;
  return data ? toPoCompanyContact(data) : null;
}

export function usePoCompanyContact({ enabled = true }: { enabled?: boolean } = {}) {
  const { venueId } = usePoIdentity();
  return useQuery<PoCompanyContact | null>({
    queryKey: poKeys.companyContact(venueId ?? ''),
    enabled: enabled && !!venueId,
    queryFn: async () => (venueId ? fetchCompanyContact(createClient(), venueId) : null),
  });
}

/**
 * The default of the "Send confirmation" box when adding a guest: the
 * company's setting, on while it loads (decision: default on).
 */
export function useSendConfirmationDefault(): boolean {
  const { data } = usePoCompanyContact();
  return data?.guestConfirmationDefault ?? true;
}

export function usePoUpdateCompanyContact() {
  const qc = useQueryClient();
  const { venueId } = usePoIdentity();
  return useMutation({
    mutationFn: async (input: PoCompanyContact) => {
      if (!venueId) throw new Error('No active company selected.');
      const res = await updateCompanyContactAction({
        venueId,
        contactEmail: input.contactEmail,
        channels: input.channels,
        guestConfirmationDefault: input.guestConfirmationDefault,
      });
      if (!res.ok) throw new Error(res.error);
      return res;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: poKeys.companyContact(venueId ?? '') });
    },
  });
}
