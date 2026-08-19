'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser, getAuthContext } from '@/lib/auth/context';
import { getMyMemberships } from '@/lib/auth/memberships';
import { ACTIVE_VENUE_COOKIE } from '@/lib/auth/active-venue';
import { canGrantRoles, type VenueRole } from '@/features/auth/roles';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import { TERMS_VERSION } from '@/lib/legal';
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
 * Outcome of an active-venue switch. Three cases, because the caller has to
 * treat them differently (86eykm7rk):
 *  - `ok`             cookie written, the caller may reload onto the new venue.
 *  - `unauthenticated` no server session — a reload lands on middleware, which
 *                     sends the user to /login. That is the right destination,
 *                     so callers keep reloading on this one.
 *  - `denied`         the id is not (or no longer) one of the caller's
 *                     memberships, or it isn't a UUID at all. Reloading here
 *                     silently returns the user to the OLD venue, so callers
 *                     must surface an error instead.
 */
export type SwitchVenueResult = 'ok' | 'unauthenticated' | 'denied';

/**
 * Persist the active-venue choice (decision #1). Validates the id is a UUID and
 * one of the caller's own memberships before writing the cookie — a forged value
 * is ignored, so the switcher can never select a venue the user lacks access to.
 * No PII in the cookie; RLS still scopes every read. Backs the form-action
 * switcher used by both the desktop and po surfaces.
 *
 * Returns WHY it refused, never throws on a refusal: the membership check is a
 * live read, so a member removed between the render of `myVenues` and the click
 * legitimately lands here. The caller decides what the user sees.
 */
async function persistActiveVenue(venueId: unknown): Promise<SwitchVenueResult> {
  const user = await getSessionUser();
  if (!user) return 'unauthenticated';

  const parsed = setActiveVenueSchema.safeParse({ venueId });
  if (!parsed.success) return 'denied';

  const memberships = await getMyMemberships();
  if (!memberships.some((m) => m.venueId === parsed.data.venueId)) return 'denied';

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_VENUE_COOKIE, parsed.data.venueId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/', 'layout');
  return 'ok';
}

/**
 * Form-action switcher: validate + persist the active-venue cookie.
 *
 * Deliberately still `Promise<void>`: it is passed straight to `<form action={…}>`
 * (VenueSwitcher), and a Next 15 / React 19 form action must return void — a
 * non-void return is a type error there and is not delivered to the client
 * anyway. Programmatic callers that need the outcome use
 * `switchActiveVenueAction` below.
 */
export async function setActiveVenueAction(formData: FormData): Promise<void> {
  await persistActiveVenue(formData.get('venueId'));
}

/**
 * Programmatic switcher (86eykm7rk): same validation as the form action, but it
 * REPORTS the outcome instead of swallowing it. `setActiveVenueAction` resolves
 * even when the switch was refused server-side, so a caller that just chained
 * `.then(reload)` sent the user back to the old venue with no error — an
 * infinitely repeatable dead end once an admin revoked the membership.
 */
export async function switchActiveVenueAction(venueId: string): Promise<SwitchVenueResult> {
  return persistActiveVenue(venueId);
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
  if (!user) return { ok: false, error: "You're not logged in." };

  const parsed = venueSettingsSchema.safeParse({
    venueId: formData.get('venueId'),
    name: formData.get('name'),
    retentionMonths: formData.get('retentionMonths'),
    companyName: formData.get('companyName'),
    kvkNumber: formData.get('kvkNumber'),
    vatNumber: formData.get('vatNumber'),
    financeEmail: formData.get('financeEmail'),
    addressLine: formData.get('addressLine'),
    postalCode: formData.get('postalCode'),
    city: formData.get('city'),
    country: formData.get('country'),
    defaultPersonalQuota: formData.get('defaultPersonalQuota'),
    allowUncheck: formData.get('allowUncheck'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details.' };
  }
  const { venueId, ...fields } = parsed.data;

  const callerRoles = await callerRolesAt(venueId, user.id);
  if (!callerRoles.includes('admin')) {
    return { ok: false, error: 'Only an admin can change the venue settings.' };
  }

  const supabase = await createClient();
  const { error, count } = await supabase
    .from('venues')
    .update(
      {
        name: fields.name,
        retention_months: fields.retentionMonths,
        company_name: fields.companyName,
        kvk_number: fields.kvkNumber,
        vat_number: fields.vatNumber,
        finance_email: fields.financeEmail,
        address_line: fields.addressLine,
        postal_code: fields.postalCode,
        city: fields.city,
        country: fields.country,
        default_personal_quota: fields.defaultPersonalQuota,
        allow_uncheck: fields.allowUncheck,
      },
      { count: 'exact' }
    )
    .eq('id', venueId);

  if (error || !count) {
    if (error) console.error('updateVenueSettings: update failed', error.message);
    return { ok: false, error: "Couldn't save the settings." };
  }

  revalidatePath('/admin/venue');
  return { ok: true, message: 'Settings saved.' };
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
  if (!user) return { ok: false, error: "You're not logged in." };

  const parsed = memberRolesSchema.safeParse({
    venueId: formData.get('venueId'),
    userId: formData.get('userId'),
    roles: formData.getAll('roles'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details.' };
  }
  const { venueId, userId, roles } = parsed.data;
  const newRoles = roles as VenueRole[];

  const callerRoles = await callerRolesAt(venueId, user.id);
  const currentRoles = await memberRolesAt(venueId, userId);
  if (!currentRoles) return { ok: false, error: 'Member not found.' };

  // Escalation guard, both directions (mirrors RLS USING + WITH CHECK).
  if (!canGrantRoles(callerRoles, currentRoles) || !canGrantRoles(callerRoles, newRoles)) {
    return { ok: false, error: "You can't change these roles here." };
  }

  const others = await otherAdminCount(venueId, userId);
  if (roleChangeWouldOrphanVenue(currentRoles, newRoles, others)) {
    return {
      ok: false,
      error: 'This is the last admin. Make someone else an admin first.',
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
    return { ok: false, error: "Couldn't change the roles (no access)." };
  }

  revalidatePath('/admin/team');
  return { ok: true, message: 'Roles updated.' };
}

/**
 * Remove a membership (decision #24): revokes access to THIS venue only — the
 * user account and any other venue/event access stay intact. Manager authority
 * + escalation guard (mirrors RLS venue_memberships_delete, role-only) + the
 * last-admin guard. Soft-delete does not apply: a membership is an access grant,
 * not guest history, and DELETE on it is allowed by the schema (decision #21/#24).
 */
export async function removeMemberAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };

  const parsed = removeMemberSchema.safeParse({
    venueId: formData.get('venueId'),
    userId: formData.get('userId'),
  });
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };
  const { venueId, userId } = parsed.data;

  const callerRoles = await callerRolesAt(venueId, user.id);
  const targetRoles = await memberRolesAt(venueId, userId);
  if (!targetRoles) return { ok: false, error: 'Member not found.' };

  if (!canGrantRoles(callerRoles, targetRoles)) {
    return { ok: false, error: "You can't remove this member here." };
  }

  const others = await otherAdminCount(venueId, userId);
  if (removalWouldOrphanVenue(targetRoles, others)) {
    return {
      ok: false,
      error: 'This is the last admin. Make someone else an admin first.',
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
    return { ok: false, error: "Couldn't remove the member (no access, or MFA required)." };
  }

  revalidatePath('/admin/team');
  return { ok: true, message: 'Access to this venue revoked.' };
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
  const { name, address, venueType, retentionMonths, kvkNumber, vatNumber, financeEmail, city, complete, termsAccepted } =
    parsed.data;

  // Legal consent (#40): a venue can only be created with explicit agreement.
  if (!termsAccepted) {
    return invalidInput('Please agree to the terms and privacy policy to create a venue.');
  }

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { data, error } = await supabase.rpc('create_venue_with_owner', {
    p_name: name,
    p_address: address,
    p_venue_type: venueType,
    p_retention_months: retentionMonths,
    // Company/billing profile (switcher quick-create); the wizard omits these, so
    // they fall through to the RPC's null defaults.
    p_kvk_number: kvkNumber ?? undefined,
    p_vat_number: vatNumber ?? undefined,
    p_finance_email: financeEmail ?? undefined,
    p_city: city ?? undefined,
    // true → ready-to-use venue (skip resume guard + mark onboarding complete).
    p_complete: complete,
    // Records the company consent on the venue (who/when/version), server-stamped.
    p_terms_version: TERMS_VERSION,
  });
  if (error || !data) return mapMutationError(error);

  // A new membership changes the nav + onboarding gate everywhere.
  revalidatePath('/', 'layout');
  revalidatePath('/app');
  return { ok: true, venueId: data };
}
