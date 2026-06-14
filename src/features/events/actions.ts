'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthContext } from '@/lib/auth/context';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import { buildEventSlug } from './slug';
import type { EventStatus } from './status';
import {
  createEventSchema,
  updateEventSchema,
  changeStatusSchema,
  setLandingActiveSchema,
  setLockSchema,
  setAutoLockSchema,
  createTierSchema,
  updateTierSchema,
  deleteTierSchema,
  assignOrganizerSchema,
  inviteOrganizerSchema,
  removeOrganizerSchema,
  type CreateEventInput,
  type UpdateEventInput,
  type ChangeStatusInput,
  type SetLandingActiveInput,
  type SetLockInput,
  type SetAutoLockInput,
  type CreateTierInput,
  type UpdateTierInput,
  type DeleteTierInput,
  type AssignOrganizerInput,
  type InviteOrganizerInput,
  type RemoveOrganizerInput,
} from './schemas';

// Every action follows the CLAUDE.md security checklist: verify the session
// server-side, validate input with Zod, then mutate through the USER-scoped
// client so RLS (membership/role/AAL2, #23/#24) and the fase-6 status trigger
// (SQLSTATE 45004) are the real boundary — never the service client, except the
// documented organizer-invite account provisioning. Invalid status moves surface
// as 45004 → src/lib/db-errors.ts.

export type ActionResult = { ok: true } | MutationError;
export type CreateEventResult = { ok: true; eventId: string } | MutationError;

const listPath = '/events';
const managePath = (id: string) => `/events/${id}`;
const guestsPath = (id: string) => `/events/${id}/guests`;

function revalidateEvent(id: string): void {
  revalidatePath(listPath);
  revalidatePath(managePath(id));
  revalidatePath(guestsPath(id));
}

// Sensitive event-scope grants (organizer assign/remove) require AAL2 — RLS
// enforces it, but we check up front for a precise message (mirrors invite flow).
function aal2Gate(isAal2: boolean): MutationError | null {
  return isAal2
    ? null
    : { ok: false, code: 'aal2_required', message: 'Deze actie vereist MFA. Verifieer eerst met je authenticator.' };
}

function alreadyRegistered(error: { code?: string; status?: number; message?: string }): boolean {
  return (
    error.code === 'email_exists' ||
    error.status === 422 ||
    Boolean(error.message && /already|exists|registered/i.test(error.message))
  );
}

// ── Event CRUD ──────────────────────────────────────────────────────────────

/** Create an event (admin only — RLS events_insert_admin). Slug auto-generated. */
export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId, name, startsAt, endsAt, landingActive } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  // Retry on the astronomically rare slug collision with a fresh suffix.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from('events')
      .insert({
        venue_id: venueId,
        name,
        starts_at: startsAt,
        ends_at: endsAt ?? null,
        landing_active: landingActive,
        landing_slug: buildEventSlug(name),
      })
      .select('id')
      .single();

    if (!error && data) {
      revalidatePath(listPath);
      return { ok: true, eventId: data.id };
    }
    if (error?.code === '23505') continue; // slug clash → new suffix
    return mapMutationError(error);
  }
  return { ok: false, code: 'slug', message: 'Kon geen unieke landingslink genereren. Probeer het opnieuw.' };
}

/** Edit name / start / end (admin or organizer — RLS). */
export async function updateEvent(input: UpdateEventInput): Promise<ActionResult> {
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, name, startsAt, endsAt } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const patch = {
    ...(name !== undefined ? { name } : {}),
    ...(startsAt !== undefined ? { starts_at: startsAt } : {}),
    ...(endsAt !== undefined ? { ends_at: endsAt } : {}),
  };
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from('events').update(patch).eq('id', eventId);
  if (error) return mapMutationError(error);
  revalidateEvent(eventId);
  return { ok: true };
}

/**
 * Move the event along the status lifecycle (#26). The fase-6 trigger validates
 * the graph (45004) and that corrective reversals are admin-only; RLS already
 * limited writes to admin/organizer.
 */
export async function changeEventStatus(input: ChangeStatusInput): Promise<ActionResult> {
  const parsed = changeStatusSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, status } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { error } = await supabase
    .from('events')
    .update({ status: status as EventStatus })
    .eq('id', eventId);
  if (error) return mapMutationError(error);
  revalidateEvent(eventId);
  return { ok: true };
}

// ── Landing page (#28) ────────────────────────────────────────────────────────

/** Toggle the public request link without closing the event (#28). */
export async function setLandingActive(input: SetLandingActiveInput): Promise<ActionResult> {
  const parsed = setLandingActiveSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, active } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { error } = await supabase.from('events').update({ landing_active: active }).eq('id', eventId);
  if (error) return mapMutationError(error);
  revalidateEvent(eventId);
  return { ok: true };
}

// ── List lock (#23) ────────────────────────────────────────────────────────────

/**
 * Lock or unlock the guest list (#23). Locking stamps locked_by/locked_at (the
 * CHECK constraint requires them); the fase-3 trigger logs lock/unlock. RLS lets
 * admin and organizer do this.
 */
export async function setListLock(input: SetLockInput): Promise<ActionResult> {
  const parsed = setLockSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, locked } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const patch = locked
    ? { list_locked: true, locked_by: ctx.user.id, locked_at: new Date().toISOString() }
    : { list_locked: false, locked_by: null, locked_at: null };

  const { error } = await supabase.from('events').update(patch).eq('id', eventId);
  if (error) return mapMutationError(error);
  revalidateEvent(eventId);
  return { ok: true };
}

/**
 * Schedule (or clear) an automatic lock (#23). Once auto_lock_at passes, staff
 * lose guest mutations — enforced in the database by can_write_guests, so a
 * direct API call after the time is rejected too. null clears the schedule.
 */
export async function setAutoLock(input: SetAutoLockInput): Promise<ActionResult> {
  const parsed = setAutoLockSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, autoLockAt } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { error } = await supabase.from('events').update({ auto_lock_at: autoLockAt }).eq('id', eventId);
  if (error) return mapMutationError(error);
  revalidateEvent(eventId);
  return { ok: true };
}

// ── Tiers (#8) ─────────────────────────────────────────────────────────────────

/** Define a tier (admin or organizer of the event — RLS guest_tiers_insert). */
export async function createTier(input: CreateTierInput): Promise<ActionResult> {
  const parsed = createTierSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, name, description, color, maxGuests, aliases } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { error } = await supabase.from('guest_tiers').insert({
    event_id: eventId,
    name,
    description,
    color,
    max_guests: maxGuests ?? null,
    aliases,
  });
  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: '23505', message: 'Er bestaat al een tier met deze naam.' };
    }
    return mapMutationError(error);
  }
  revalidateEvent(eventId);
  return { ok: true };
}

/** Edit a tier (partial). Lowering max below current occupancy is allowed (it
 *  only blocks future adds — the quota engine enforces on guest writes). */
export async function updateTier(input: UpdateTierInput): Promise<ActionResult> {
  const parsed = updateTierSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { tierId, name, description, color, maxGuests, aliases } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const patch = {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(maxGuests !== undefined ? { max_guests: maxGuests } : {}),
    ...(aliases !== undefined ? { aliases } : {}),
  };
  if (Object.keys(patch).length === 0) return { ok: true };

  const { data, error } = await supabase
    .from('guest_tiers')
    .update(patch)
    .eq('id', tierId)
    .select('event_id')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: '23505', message: 'Er bestaat al een tier met deze naam.' };
    }
    return mapMutationError(error);
  }
  if (data?.event_id) revalidateEvent(data.event_id);
  return { ok: true };
}

/** Delete a tier. Blocked by FK if guests still reference it (23503). */
export async function deleteTier(input: DeleteTierInput): Promise<ActionResult> {
  const parsed = deleteTierSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { tierId } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  // Capture event_id for revalidation before the row is gone.
  const { data: tier } = await supabase
    .from('guest_tiers')
    .select('event_id')
    .eq('id', tierId)
    .maybeSingle();

  const { error } = await supabase.from('guest_tiers').delete().eq('id', tierId);
  if (error) {
    if (error.code === '23503') {
      return {
        ok: false,
        code: '23503',
        message: 'Deze tier heeft nog gasten. Verplaats ze eerst naar een andere tier.',
      };
    }
    return mapMutationError(error);
  }
  if (tier?.event_id) revalidateEvent(tier.event_id);
  return { ok: true };
}

// ── Organizers (#6/#24) ──────────────────────────────────────────────────────

/** Assign an existing user as organizer (admin + AAL2 — RLS). */
export async function assignOrganizer(input: AssignOrganizerInput): Promise<ActionResult> {
  const parsed = assignOrganizerSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, userId } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const gate = aal2Gate(ctx.isAal2);
  if (gate) return gate;

  const { error } = await supabase
    .from('event_organizers')
    .insert({ event_id: eventId, user_id: userId });
  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: '23505', message: 'Deze gebruiker is al organisator van dit event.' };
    }
    return mapMutationError(error);
  }
  revalidateEvent(eventId);
  return { ok: true };
}

/**
 * Invite a new (possibly external, #24) organizer by e-mail. Mirrors the venue
 * invite flow: the auth identity + a profile row are provisioned server-side
 * (service role — the documented exception, so invite-only OTP login works and
 * the FK resolves), then the event_organizers scope is written through the
 * USER-scoped client so RLS (admin + AAL2) re-validates. No venue membership is
 * created — an external organizer stays out of the venue (#24).
 */
export async function inviteOrganizer(input: InviteOrganizerInput): Promise<ActionResult> {
  const parsed = inviteOrganizerSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, email } = parsed.data;

  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const gate = aal2Gate(ctx.isAal2);
  if (gate) return gate;

  const fullName = email.split('@')[0];
  const service = createServiceClient();
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });

  if (createError) {
    if (alreadyRegistered(createError)) {
      // The account already exists (e.g. at another venue). We deliberately do
      // not resolve their id server-side; guide the admin to the existing-user
      // path instead — no enumeration, no service-role profile snooping.
      return {
        ok: false,
        code: 'exists',
        message:
          'Dit e-mailadres heeft al een account. Laat de persoon één keer inloggen en koppel ’m dan als bestaande gebruiker.',
      };
    }
    console.error('inviteOrganizer: createUser failed', createError.message);
    return { ok: false, code: 'invite', message: 'Kon de uitnodiging niet aanmaken. Probeer het opnieuw.' };
  }

  const organizerUserId = created?.user?.id;
  if (!organizerUserId) {
    return { ok: false, code: 'invite', message: 'Kon de uitnodiging niet aanmaken. Probeer het opnieuw.' };
  }

  // Pre-provision the profile so event_organizers.user_id FK resolves. The user
  // owns it from first login (decision #24); accept_pending_invites leaves it be.
  const { error: profileError } = await service
    .from('user_profiles')
    .upsert({ id: organizerUserId, full_name: fullName, email }, { onConflict: 'id', ignoreDuplicates: true });
  if (profileError) {
    console.error('inviteOrganizer: profile upsert failed', profileError.message);
    return { ok: false, code: 'invite', message: 'Kon de uitnodiging niet vastleggen.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('event_organizers')
    .insert({ event_id: eventId, user_id: organizerUserId });
  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: '23505', message: 'Deze persoon is al organisator van dit event.' };
    }
    return mapMutationError(error);
  }
  revalidateEvent(eventId);
  return { ok: true };
}

/** Remove an organizer scope (admin + AAL2 — RLS). The user/account is untouched (#24). */
export async function removeOrganizer(input: RemoveOrganizerInput): Promise<ActionResult> {
  const parsed = removeOrganizerSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, userId } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const gate = aal2Gate(ctx.isAal2);
  if (gate) return gate;

  const { error, count } = await supabase
    .from('event_organizers')
    .delete({ count: 'exact' })
    .eq('event_id', eventId)
    .eq('user_id', userId);
  if (error) return mapMutationError(error);
  if (!count) {
    return { ok: false, code: 'noop', message: 'Kon de organisator niet verwijderen (geen toegang).' };
  }
  revalidateEvent(eventId);
  return { ok: true };
}
