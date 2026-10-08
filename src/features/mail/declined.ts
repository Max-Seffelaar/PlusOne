import 'server-only';

// The two mails an invite decline causes (z8uq9m2yvp): to the inviter, which
// address declined, and to the decliner, a confirmation. BEST EFFORT, like all
// team mail: it never throws and never undoes a recorded decline.
//
// Service role, documented exception: the inviter's e-mail address lives in
// auth.users and the invitee must never be able to read it, so the read is the
// service_role-only RPC declined_invite_mail_context. The caller
// (declineInviteAction) has already authorized the actor: it passes an id that
// decline_invite() just closed for the signed-in user, and the RPC returns
// nothing for an invite that is not declined. decline_invite() returns true only
// on the open -> declined transition, so a retry or double tap never mails twice.
//
// The inviter mail names the address as typed on the invite, never a profile
// name: the invitee has not shared a profile with that company.

import { createServiceClient } from '@/lib/supabase/service';
import { sendTeamMail } from './send';

export async function notifyInviteDeclined(inviteId: string): Promise<void> {
  try {
    const { data, error } = await createServiceClient().rpc('declined_invite_mail_context', {
      p_invite_id: inviteId,
    });
    const ctx = data?.[0];
    if (error || !ctx) {
      console.error('notifyInviteDeclined: context read failed', { code: error?.code });
      return;
    }

    const shared = { venueId: null, companyName: ctx.company_name, crew: ctx.is_crew, eventName: ctx.event_name } as const;

    // The inviter's account can be gone (invited_by is kept, the auth row is not).
    if (ctx.inviter_email) {
      await sendTeamMail({
        template: 'team_invite_declined',
        to: ctx.inviter_email,
        inviteeEmail: ctx.invitee_email,
        ...shared,
      });
    }
    await sendTeamMail({ template: 'team_invite_declined_confirm', to: ctx.invitee_email, ...shared });
  } catch (err) {
    console.error('notifyInviteDeclined: unexpected error', { error: err instanceof Error ? err.name : 'unknown' });
  }
}
