import 'server-only';

// Invitation-mail budget per company (decision Max 2026-10-07, review of PR
// #413). Every invitation mail a company causes goes over the ONE Resend
// account that also carries every login OTP: the Resend team mail (existing
// account, logged by sendTeamMail) and the Supabase invite mail (new or
// unconfirmed account, sent by GoTrue over Resend SMTP, recorded here). The
// database owns the number (mail_venue_daily_cap(), 20261007130000).
//
// inviteMailCapReached is the ONE pre-check the team invite, both resends and
// (after 0d) the crew invite call BEFORE they create anything, so an admin at
// the cap gets a clear refusal instead of an invite row whose mail never goes.
// Platform invites carry no company and never reach either function.

import { createServiceClient } from '@/lib/supabase/service';
import { recipientHash } from './send';

/**
 * True when the company sent its invitation mails for the UTC day. Fails OPEN
 * on a database error (logged): the send-time backstop in log_mail_attempt
 * still holds for the team mail, and an outage here must not block invites.
 */
export async function inviteMailCapReached(venueId: string): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient().rpc('mail_venue_cap_reached', { p_venue_id: venueId });
    if (error) {
      console.error('inviteMailCapReached: rpc failed', { code: error.code });
      return false;
    }
    return data === true;
  } catch (err) {
    console.error('inviteMailCapReached: unexpected error', { error: err instanceof Error ? err.name : 'unknown' });
    return false;
  }
}

/** Count a Supabase invite mail toward the company's cap. Best effort: the
 *  mail is already out, a failed bookkeeping write is only logged. */
export async function recordAuthInviteMail(venueId: string, email: string): Promise<void> {
  try {
    const { error } = await createServiceClient().rpc('record_auth_invite_mail', {
      p_venue_id: venueId,
      p_recipient_hash: recipientHash(email),
    });
    if (error) console.error('recordAuthInviteMail: rpc failed', { code: error.code });
  } catch (err) {
    console.error('recordAuthInviteMail: unexpected error', { error: err instanceof Error ? err.name : 'unknown' });
  }
}
