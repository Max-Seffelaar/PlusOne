'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser, getAuthContext } from '@/lib/auth/context';
import { getMyMemberships } from '@/lib/auth/memberships';
import { assertAal2, AuthorizationError } from '@/lib/auth/guards';
import { ACTIVE_VENUE_COOKIE } from '@/lib/auth/active-venue';
import { canGrantRoles, type VenueRole } from '@/features/auth/roles';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import {
  venueSettingsSchema,
  createVenueSchema,
  memberRolesSchema,
  removeMemberSchema,
  setActiveVenueSchema,
  type CreateVenueInput,
} from './schemas';
import { removalWouldOrphanVenue, roleChangeWouldOrphanVenue } from './access';

export interface ActionState {
  ok: boolean;
  error?: string;
  message?: string;
}

const AAL2_MESSAGE = 'Deze actie vereist MFA. Verifieer eerst met je authenticator.';

// AAL2 assertion mapped to Dutch copy; rethrows anything that isn't an auth error.
async function requireAal2(): Promise<ActionState | null> {
  try {
    await assertAal2();
    return null;
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return {
        ok: false,
        error: e.reason === 'aal2_required' ? AAL2_MESSAGE : 'Je bent niet ingelogd.',
      };
    }
    throw e;
  }
}

// The caller's own roles at a venue (RLS: a user always sees their own
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

// A member's current roles at a venue (RLS: managers + finance may read these).
async function memberRolesAt(venueId: string, userId: string): Promise<VenueRole[] | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('venue_memberships')
    .select('roles')
    .eq('venue_id', venueId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.roles ?? null;
}

// Number of admin memberships at the venue OTHER than the given user (last-admin
// guard input). RLS lets admin/user_manager/finance read the member list.
async function otherAdminCount(venueId: string, excludeUserId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('venue_memberships')
    .select('user_id, roles')
    .eq('venue_id', venueId);
  return (data ?? []).filter((m) => m.user_id !== excludeUserId && m.roles.includes('admin')).length;
}

/**
 * Persist the nav venue switcher (decision #1). Validates the id is a UUID and
 * one of the caller's own memberships before writing the cookie — a forged
 * value is ignored. No PII in the cookie; RLS still scopes every read.
 */
export async function setActiveVenueAction(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;

  const parsed = setActiveVenueSchema.safeParse({ venueId: formData.get('venueId') });
  if (!parsed.success) return;

  const memberships = await getMyMemberships();
  if (!memberships.some((m) => m.venueId === parsed.data.venueId)) return;

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_VENUE_COOKIE, parsed.data.venueId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/', 'layout');
}

/**
 * Update venue name + AVG retention (decision #16/#24). Security checklist:
 * session verified server-side, admin role confirmed in the app AND by RLS
 * (venues_update_admin), input through Zod, the row scoped by id so RLS proves
 * ownership, generic errors. Admin is MFA-mandatory, so the session is already
 * AAL2; venues_update itself does not gate on AAL2, so we don't either.
 */
export async function updateVenueSettingsAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Je bent niet ingelogd.' };

  const parsed = venueSettingsSchema.safeParse({
    venueId: formData.get('venueId'),
    name: formData.get('name'),
    retentionMonths: formData.get('retentionMonths'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Controleer de invoer.' };
  }
  const { venueId, name, retentionMonths } = parsed.data;

  const callerRoles = await callerRolesAt(venueId, user.id);
  if (!callerRoles.includes('admin')) {
    return { ok: false, error: 'Alleen een beheerder kan de venue-instellingen wijzigen.' };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from('venues')
    .update({ name, retention_months: retentionMonths }, { count: 'exact' })
    .eq('id', venueId);

  if (error || !count) {
    if (error) console.error('updateVenueSettings: update failed', error.message);
    return { ok: false, error: 'Kon de instellingen niet opslaan.' };
  }

  revalidatePath('/admin/venue');
  return { ok: true, message: 'Instellingen opgeslagen.' };
}

/**
 * Change a member's roles (AAL2 — role grant is sensitive). Mirrors RLS
 * venue_memberships_update: manager authority + the escalation guard on BOTH
 * the member's current roles (USING) and the new roles (WITH CHECK). Adds an
 * app-only last-admin guard so a venue can never be left without an admin.
 */
export async function updateMemberRolesAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Je bent niet ingelogd.' };

  const parsed = memberRolesSchema.safeParse({
    venueId: formData.get('venueId'),
    userId: formData.get('userId'),
    roles: formData.getAll('roles'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Controleer de invoer.' };
  }
  const { venueId, userId, roles } = parsed.data;
  const newRoles = roles as VenueRole[];

  const aal2 = await requireAal2();
  if (aal2) return aal2;

  const callerRoles = await callerRolesAt(venueId, user.id);
  const currentRoles = await memberRolesAt(venueId, userId);
  if (!currentRoles) return { ok: false, error: 'Lid niet gevonden.' };

  // Escalation guard, both directions (mirrors RLS USING + WITH CHECK).
  if (!canGrantRoles(callerRoles, currentRoles) || !canGrantRoles(callerRoles, newRoles)) {
    return { ok: false, error: 'Je mag deze rollen hier niet wijzigen.' };
  }

  const others = await otherAdminCount(venueId, userId);
  if (roleChangeWouldOrphanVenue(currentRoles, newRoles, others)) {
    return {
      ok: false,
      error: 'Dit is de laatste beheerder. Maak eerst iemand anders beheerder.',
    };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from('venue_memberships')
    .update({ roles: newRoles }, { count: 'exact' })
    .eq('venue_id', venueId)
    .eq('user_id', userId);

  if (error || !count) {
    if (error) console.error('updateMemberRoles: update failed', error.message);
    return { ok: false, error: 'Kon de rollen niet wijzigen (geen toegang of MFA vereist).' };
  }

  revalidatePath('/admin/team');
  return { ok: true, message: 'Rollen bijgewerkt.' };
}

/**
 * Remove a membership (decision #24): revokes access to THIS venue only — the
 * user account and any other venue/event access stay intact. AAL2 + manager
 * authority + escalation guard (mirrors RLS venue_memberships_delete) + the
 * last-admin guard. Soft-delete does not apply: a membership is an access grant,
 * not guest history, and DELETE on it is allowed by the schema (decision #21/#24).
 */
export async function removeMemberAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: 'Je bent niet ingelogd.' };

  const parsed = removeMemberSchema.safeParse({
    venueId: formData.get('venueId'),
    userId: formData.get('userId'),
  });
  if (!parsed.success) return { ok: false, error: 'Ongeldige invoer.' };
  const { venueId, userId } = parsed.data;

  const aal2 = await requireAal2();
  if (aal2) return aal2;

  const callerRoles = await callerRolesAt(venueId, user.id);
  const targetRoles = await memberRolesAt(venueId, userId);
  if (!targetRoles) return { ok: false, error: 'Lid niet gevonden.' };

  if (!canGrantRoles(callerRoles, targetRoles)) {
    return { ok: false, error: 'Je mag dit lid hier niet verwijderen.' };
  }

  const others = await otherAdminCount(venueId, userId);
  if (removalWouldOrphanVenue(targetRoles, others)) {
    return {
      ok: false,
      error: 'Dit is de laatste beheerder. Maak eerst iemand anders beheerder.',
    };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from('venue_memberships')
    .delete({ count: 'exact' })
    .eq('venue_id', venueId)
    .eq('user_id', userId);

  if (error || !count) {
    if (error) console.error('removeMember: delete failed', error.message);
    return { ok: false, error: 'Kon het lid niet verwijderen (geen toegang of MFA vereist).' };
  }

  revalidatePath('/admin/team');
  return { ok: true, message: 'Toegang tot deze venue ingetrokken.' };
}

// ── Self-service venue creation (#40a) ───────────────────────────────────────

export type CreateVenueResult = { ok: true; venueId: string } | MutationError;

/**
 * Create a venue and make the caller its Admin (#40a). Runs through the
 * SECURITY DEFINER RPC create_venue_with_owner on the USER-scoped client: it
 * executes as the logged-in user (auth.uid()), so the venue + the owner's Admin
 * membership + a trialing subscription are written atomically and the audit
 * trigger attributes the ownership grant to the real actor — impossible with a
 * raw service-role connection (no auth.uid()). No AAL2 gate: a brand-new owner
 * has not enrolled MFA yet, and creating your own venue is not a sensitive
 * cross-tenant grant. Idempotent — a retried submit returns the owner's existing
 * in-onboarding venue instead of a duplicate.
 */
export async function createVenueAction(input: CreateVenueInput): Promise<CreateVenueResult> {
  const parsed = createVenueSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { name, address, venueType, retentionMonths } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { data, error } = await supabase.rpc('create_venue_with_owner', {
    p_name: name,
    p_address: address,
    p_venue_type: venueType,
    p_retention_months: retentionMonths,
  });
  if (error || !data) return mapMutationError(error);

  // A new membership changes the nav + onboarding gate everywhere.
  revalidatePath('/', 'layout');
  revalidatePath('/dashboard');
  return { ok: true, venueId: data };
}
