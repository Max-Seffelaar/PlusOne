'use server';

// "Resend confirmation" (ClickUp z8uq9m49k1, decision Max 2026-10-11 #2/#3).
// Whoever may edit the guest may resend: RLS decides, through the caller's own
// session (can_edit_guest, a rolled-back probe of the real guests_update
// policy and its guard triggers, list lock included). Then the service client
// queues the confirmation with resend_guest_confirmation, which holds the
// rules in the database: same queue, same budgets, idempotent while one is
// queued, and never to an address that bounced (PMB01) until it is changed.

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthContext } from '@/lib/auth/context';
import { invalidInput, unauthorized, type MutationError } from '@/lib/db-errors';
import { drainQueuedGuestMails } from '@/features/mail/guest-queue';
import { guestMailActive } from '@/features/mail/config';
import { t } from '@/lib/i18n';

const schema = z.object({ guestId: z.string().uuid() }).strict();

export type ResendConfirmationResult = { ok: true } | MutationError;

export async function resendGuestConfirmation(input: z.input<typeof schema>): Promise<ResendConfirmationResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const m = t.guests.mail;

  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  if (!guestMailActive()) return { ok: false, code: 'not_configured', message: m.errFailed };

  const supabase = await createClient();
  const { data: allowed, error: probeError } = await supabase.rpc('can_edit_guest', { p_guest_id: parsed.data.guestId });
  if (probeError) {
    console.error('resendGuestConfirmation: can_edit_guest failed', { code: probeError.code });
    return { ok: false, code: 'error', message: m.errFailed };
  }
  if (allowed !== true) return { ok: false, code: '42501', message: m.errNoRights };

  const { error } = await createServiceClient().rpc('resend_guest_confirmation', {
    p_guest_id: parsed.data.guestId,
    p_actor: ctx.user.id,
  });
  if (error) {
    if (error.code === 'PMB01') return { ok: false, code: 'PMB01', message: m.errBounced };
    if (error.code === '22023') return { ok: false, code: '22023', message: m.errNothing };
    console.error('resendGuestConfirmation: resend_guest_confirmation failed', { code: error.code });
    return { ok: false, code: 'error', message: m.errFailed };
  }
  drainQueuedGuestMails();
  return { ok: true };
}
