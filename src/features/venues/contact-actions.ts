'use server';

// Company contact for guest mail (Gastcommunicatie F, z8uq9m2vpy). Security
// checklist: session verified server-side, admin role confirmed in the app
// AND by RLS (venues update policy), input through Zod, the row scoped by id
// through the USER-scoped client so RLS proves ownership, generic errors.
//
// Guest mail for a company without a contact address waits in the queue (the
// claim skips it): saving one here releases what is waiting, so the action
// drains once, after the response.

import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/context';
import { t } from '@/lib/i18n';
import { channelsToJson, companyContactSchema, type CompanyContactInput } from './contact-schema';
import { drainQueuedGuestMails } from '@/features/mail/guest-queue';

export type ContactActionResult = { ok: true } | { ok: false; error: string };

export async function updateCompanyContactAction(input: CompanyContactInput): Promise<ContactActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };

  const parsed = companyContactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? t.settings.contact.saveFailed };
  }
  const { venueId, contactEmail, channels, guestConfirmationDefault } = parsed.data;

  const supabase = await createClient();
  const { data: membership } = await supabase
    .from('venue_memberships')
    .select('roles')
    .eq('venue_id', venueId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership?.roles?.includes('admin')) {
    return { ok: false, error: t.settings.contact.adminOnly };
  }

  const { error, count } = await supabase
    .from('venues')
    .update(
      {
        contact_email: contactEmail,
        contact_channels: channelsToJson(channels),
        guest_confirmation_default: guestConfirmationDefault,
      },
      { count: 'exact' },
    )
    .eq('id', venueId);
  if (error || !count) {
    if (error) console.error('updateCompanyContact: update failed', { code: error.code });
    return { ok: false, error: t.settings.contact.saveFailed };
  }

  if (contactEmail) drainQueuedGuestMails();
  return { ok: true };
}
