'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getSessionUser } from '@/lib/auth/context';
import { assertAal2, AuthorizationError } from '@/lib/auth/guards';
import { inviteSchema, revokeInviteSchema } from './schemas';
import { canGrantRoles, type VenueRole } from './roles';

export interface ActionState {
  ok: boolean;
  error?: string;
  message?: string;
}

const INVITE_TTL_DAYS = 7;

// Loads the caller's roles at a venue (RLS: the user always sees their own
// membership). Empty when not a member.
async function callerRolesAt(venueId: string, userId: string): Promise<VenueRole[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('venue_memberships')
    .select('roles')
    .eq('venue_id', venueId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.roles ?? [];
}

function alreadyRegistered(error: { code?: string; status?: number; message?: string }): boolean {
  return (
    error.code === 'email_exists' ||
    error.status === 422 ||
    Boolean(error.message && /already|exists|registered/i.test(error.message))
  );
}

/**
 * Invite a user to a venue with a set of roles (decision #20/#24). Security
 * checklist applied: session verified server-side, AAL2 enforced (role grant
 * is sensitive), caller's venue role + escalation guard checked in the app AND
 * again by RLS on the invite insert, all input through Zod.
 *
 * The auth user is created up-front (service role) so invite-only OTP login
 * works without public signups; the invite row — written through the
 * user-scoped client so RLS re-validates — is what actually grants access when
 * the invitee accepts on first login. The audit trigger records the invite.
 */
export async function inviteUserAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Je bent niet ingelogd.' };

  const parsed = inviteSchema.safeParse({
    venueId: formData.get('venueId'),
    email: formData.get('email'),
    roles: formData.getAll('roles'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Controleer de invoer.' };
  }
  const { venueId, email, roles } = parsed.data;
  const typedRoles = roles as VenueRole[];

  try {
    await assertAal2();
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return {
        ok: false,
        error:
          e.reason === 'aal2_required'
            ? 'Deze actie vereist MFA. Verifieer eerst met je authenticator.'
            : 'Je bent niet ingelogd.',
      };
    }
    throw e;
  }

  // App-layer authority + escalation guard (RLS is the real boundary).
  const callerRoles = await callerRolesAt(venueId, user.id);
  if (!canGrantRoles(callerRoles, typedRoles)) {
    return { ok: false, error: 'Je mag deze rollen hier niet toekennen.' };
  }

  // 1) Ensure an auth identity exists so OTP login is possible (invite-only —
  //    no public signups). Duplicate e-mail just means the account is already
  //    there (e.g. a user from another venue, decision #24).
  const service = createServiceClient();
  const { error: createError } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: email.split('@')[0] },
  });
  if (createError && !alreadyRegistered(createError)) {
    console.error('inviteUser: createUser failed', createError.message);
    return { ok: false, error: 'Kon de uitnodiging niet aanmaken. Probeer het opnieuw.' };
  }

  // 2) Record the invite through the user-scoped client → RLS enforces
  //    manager-role + AAL2 + escalation + invited_by = self once more.
  const supabase = await createClient();
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error: inviteError } = await supabase.from('invites').insert({
    venue_id: venueId,
    email,
    roles: typedRoles,
    invited_by: user.id,
    expires_at: expiresAt,
  });

  if (inviteError) {
    if (inviteError.code === '23505') {
      return { ok: false, error: 'Er staat al een open uitnodiging voor dit e-mailadres.' };
    }
    console.error('inviteUser: invite insert failed', inviteError.message);
    return { ok: false, error: 'Kon de uitnodiging niet vastleggen.' };
  }

  revalidatePath('/admin/team');
  return { ok: true, message: `Uitnodiging klaargezet voor ${email}.` };
}

/** Cancel a pending invite (RLS enforces manager + AAL2 + escalation). */
export async function revokeInviteAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = revokeInviteSchema.safeParse({ inviteId: formData.get('inviteId') });
  if (!parsed.success) return { ok: false, error: 'Ongeldige uitnodiging.' };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from('invites')
    .delete({ count: 'exact' })
    .eq('id', parsed.data.inviteId);

  if (error || !count) {
    return { ok: false, error: 'Kon de uitnodiging niet intrekken (geen toegang of al geaccepteerd).' };
  }

  revalidatePath('/admin/team');
  return { ok: true, message: 'Uitnodiging ingetrokken.' };
}

/** Accept the caller's own pending invites (used by the banner). */
export async function acceptInvitesAction(): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Je bent niet ingelogd.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('accept_pending_invites');
  if (error) {
    return { ok: false, error: 'Kon de uitnodiging niet accepteren.' };
  }

  revalidatePath('/dashboard');
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Uitnodiging geaccepteerd.' };
}
