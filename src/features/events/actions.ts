'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthContext } from '@/lib/auth/context';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import type { EventStatus } from './status';
import type { Database } from '@/lib/database.types';
import {
  createEventSchema,
  updateEventSchema,
  changeStatusSchema,
  setCancelledSchema,
  setLandingActiveSchema,
  setLockSchema,
  setAutoLockSchema,
  setAllowUncheckSchema,
  createTierSchema,
  updateTierSchema,
  deleteTierSchema,
  assignOrganizerSchema,
  inviteOrganizerSchema,
  removeOrganizerSchema,
  createTemplateSchema,
  updateTemplateSchema,
  deleteTemplateSchema,
  createTemplateTierSchema,
  updateTemplateTierSchema,
  deleteTemplateTierSchema,
  createEventFromTemplateSchema,
  createTemplateFromEventSchema,
  type CreateEventInput,
  type UpdateEventInput,
  type ChangeStatusInput,
  type SetCancelledInput,
  type SetLandingActiveInput,
  type SetLockInput,
  type SetAutoLockInput,
  type SetAllowUncheckInput,
  type CreateTierInput,
  type UpdateTierInput,
  type DeleteTierInput,
  type AssignOrganizerInput,
  type InviteOrganizerInput,
  type RemoveOrganizerInput,
  type CreateTemplateInput,
  type UpdateTemplateInput,
  type DeleteTemplateInput,
  type CreateTemplateTierInput,
  type UpdateTemplateTierInput,
  type DeleteTemplateTierInput,
  type CreateEventFromTemplateInput,
  type CreateTemplateFromEventInput,
} from './schemas';

// Every action follows the CLAUDE.md security checklist: verify the session
// server-side, validate input with Zod, then mutate through the USER-scoped
// client so RLS (membership/role/AAL2, #23/#24) and the fase-6 status trigger
// (SQLSTATE 45004) are the real boundary — never the service client, except the
// documented organizer-invite account provisioning. Invalid status moves surface
// as 45004 → src/lib/db-errors.ts.

export type ActionResult = { ok: true } | MutationError;
export type CreateEventResult = { ok: true; eventId: string } | MutationError;
export type CreateTemplateResult = { ok: true; templateId: string } | MutationError;

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
    : { ok: false, code: 'aal2_required', message: 'This action needs MFA. Verify with your authenticator first.' };
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

  // landing_slug '' → the BEFORE-INSERT trigger generates name-yyyy-mm-dd
  // (collision → name-yyyy-mm-dd-2, -3, …), so no retry loop needed.
  const { data, error } = await supabase
    .from('events')
    .insert({
      venue_id: venueId,
      name,
      starts_at: startsAt,
      ends_at: endsAt ?? null,
      landing_active: landingActive,
      landing_slug: '',
    })
    .select('id')
    .single();

  if (!error && data) {
    revalidatePath(listPath);
    return { ok: true, eventId: data.id };
  }
  return mapMutationError(error);
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

/**
 * Cancel (or un-cancel) an event (replaces the retired status='closed', 24 jun
 * 2026). A cancelled event is admin-only and stops taking check-ins and public
 * requests — all enforced in the database (can_write_guests / can_check_in /
 * events_select_landing). RLS (events_update_admin_organizer) is the boundary; the
 * generic events audit trigger records who toggled it.
 */
export async function setEventCancelled(input: SetCancelledInput): Promise<ActionResult> {
  const parsed = setCancelledSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, cancelled } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { error } = await supabase
    .from('events')
    .update({ cancelled_at: cancelled ? new Date().toISOString() : null })
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

// ── Uitchecken toestaan — per-event override (#3 / S1.1) ────────────────────────

/**
 * Set (or clear) the per-event "uitchecken toestaan" override. true/false force
 * the setting for this event; null inherits the venue (company) default. An
 * immediate operational control like setListLock — not part of the form save. RLS
 * (admin/organizer events update) is the boundary; the change is audited
 * (audit_events_allow_uncheck) and the effective value gates the door/cockpit void
 * write via the RESTRICTIVE check_ins policy.
 */
export async function setEventAllowUncheck(input: SetAllowUncheckInput): Promise<ActionResult> {
  const parsed = setAllowUncheckSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, allowUncheck } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { error } = await supabase.from('events').update({ allow_uncheck: allowUncheck }).eq('id', eventId);
  if (error) return mapMutationError(error);
  revalidateEvent(eventId);
  return { ok: true };
}

// ── Tiers (#8) ─────────────────────────────────────────────────────────────────

/** Define a tier (admin or organizer of the event — RLS guest_tiers_insert). */
export async function createTier(input: CreateTierInput): Promise<ActionResult> {
  const parsed = createTierSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, name, description, color, maxGuests, doorPriceCents, aliases } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { error } = await supabase.from('guest_tiers').insert({
    event_id: eventId,
    name,
    description,
    color,
    max_guests: maxGuests ?? null,
    door_price_cents: doorPriceCents ?? null,
    aliases,
  });
  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: '23505', message: 'A tier with this name already exists.' };
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
  const { tierId, name, description, color, maxGuests, doorPriceCents, aliases } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const patch = {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(maxGuests !== undefined ? { max_guests: maxGuests } : {}),
    ...(doorPriceCents !== undefined ? { door_price_cents: doorPriceCents } : {}),
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
      return { ok: false, code: '23505', message: 'A tier with this name already exists.' };
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
        message: 'This tier still has guests. Move them to another tier first.',
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
      return { ok: false, code: '23505', message: 'This user is already an organizer of this event.' };
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
          'This email already has an account. Have them log in once, then link them as an existing user.',
      };
    }
    console.error('inviteOrganizer: createUser failed', createError.message);
    return { ok: false, code: 'invite', message: "Couldn't create the invite. Try again." };
  }

  const organizerUserId = created?.user?.id;
  if (!organizerUserId) {
    return { ok: false, code: 'invite', message: "Couldn't create the invite. Try again." };
  }

  // Pre-provision the profile so event_organizers.user_id FK resolves. The user
  // owns it from first login (decision #24); accept_pending_invites leaves it be.
  const { error: profileError } = await service
    .from('user_profiles')
    .upsert({ id: organizerUserId, full_name: fullName, email }, { onConflict: 'id', ignoreDuplicates: true });
  if (profileError) {
    console.error('inviteOrganizer: profile upsert failed', profileError.message);
    return { ok: false, code: 'invite', message: "Couldn't record the invite." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('event_organizers')
    .insert({ event_id: eventId, user_id: organizerUserId });
  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: '23505', message: 'This person is already an organizer of this event.' };
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
    return { ok: false, code: 'noop', message: "Couldn't remove the organizer (no access)." };
  }
  revalidateEvent(eventId);
  return { ok: true };
}

// ── Event templates (86exyp8gn) ─────────────────────────────────────────────
// Reusable per-event-type setups (tiers + capacity + default settings). MANAGEMENT
// (create/update/delete a template + its tiers) is admin OR venue-organizer — RLS
// (event_templates_* / event_template_tiers_*) is the boundary, the same authority
// as the address book. Creating an event FROM a template stays admin-only (the RPC
// re-checks). No (app)-route revalidation: the po React-Query layer owns freshness.

type TemplateTierInsert = Database['public']['Tables']['event_template_tiers']['Insert'];

/** Create a template (admin or venue-organizer — RLS event_templates_insert). */
export async function createTemplate(input: CreateTemplateInput): Promise<CreateTemplateResult> {
  const parsed = createTemplateSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId, name, capacity, allowUncheck, landingActive, autoLockOffsetMinutes } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { data, error } = await supabase
    .from('event_templates')
    .insert({
      venue_id: venueId,
      name,
      capacity: capacity ?? null,
      allow_uncheck: allowUncheck ?? null,
      landing_active: landingActive,
      auto_lock_offset_minutes: autoLockOffsetMinutes ?? null,
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: '23505', message: 'A template with this name already exists.' };
    }
    return mapMutationError(error);
  }
  return { ok: true, templateId: data.id };
}

/** Edit a template (partial; admin or venue-organizer — RLS). */
export async function updateTemplate(input: UpdateTemplateInput): Promise<ActionResult> {
  const parsed = updateTemplateSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { templateId, name, capacity, allowUncheck, landingActive, autoLockOffsetMinutes } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const patch = {
    ...(name !== undefined ? { name } : {}),
    ...(capacity !== undefined ? { capacity } : {}),
    ...(allowUncheck !== undefined ? { allow_uncheck: allowUncheck } : {}),
    ...(landingActive !== undefined ? { landing_active: landingActive } : {}),
    ...(autoLockOffsetMinutes !== undefined ? { auto_lock_offset_minutes: autoLockOffsetMinutes } : {}),
  };
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from('event_templates').update(patch).eq('id', templateId);
  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: '23505', message: 'A template with this name already exists.' };
    }
    return mapMutationError(error);
  }
  return { ok: true };
}

/** Delete a template — cascades its tiers; already-created events are untouched. */
export async function deleteTemplate(input: DeleteTemplateInput): Promise<ActionResult> {
  const parsed = deleteTemplateSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { templateId } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { error } = await supabase.from('event_templates').delete().eq('id', templateId);
  if (error) return mapMutationError(error);
  return { ok: true };
}

/** Add a tier to a template (admin or venue-organizer — RLS). */
export async function createTemplateTier(input: CreateTemplateTierInput): Promise<ActionResult> {
  const parsed = createTemplateTierSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { templateId, name, description, color, maxGuests, doorPriceCents, aliases } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  // venue_id is filled by set_template_tier_scope (NOT NULL, trigger-stamped from the
  // parent template); omit it from the row and cast, so the client never supplies it.
  const row = {
    template_id: templateId,
    name,
    description,
    color,
    max_guests: maxGuests ?? null,
    door_price_cents: doorPriceCents ?? null,
    aliases,
  };
  const { error } = await supabase.from('event_template_tiers').insert(row as TemplateTierInsert);
  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: '23505', message: 'A tier with this name already exists.' };
    }
    return mapMutationError(error);
  }
  return { ok: true };
}

/** Edit a template tier (partial). */
export async function updateTemplateTier(input: UpdateTemplateTierInput): Promise<ActionResult> {
  const parsed = updateTemplateTierSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { tierId, name, description, color, maxGuests, doorPriceCents, aliases } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const patch = {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(maxGuests !== undefined ? { max_guests: maxGuests } : {}),
    ...(doorPriceCents !== undefined ? { door_price_cents: doorPriceCents } : {}),
    ...(aliases !== undefined ? { aliases } : {}),
  };
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from('event_template_tiers').update(patch).eq('id', tierId);
  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: '23505', message: 'A tier with this name already exists.' };
    }
    return mapMutationError(error);
  }
  return { ok: true };
}

/** Delete a template tier. */
export async function deleteTemplateTier(input: DeleteTemplateTierInput): Promise<ActionResult> {
  const parsed = deleteTemplateTierSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { tierId } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { error } = await supabase.from('event_template_tiers').delete().eq('id', tierId);
  if (error) return mapMutationError(error);
  return { ok: true };
}

/**
 * Create an event from a template (admin-only — create_event_from_template re-checks
 * admin on the template's venue). The RPC seeds tiers + capacity + settings atomically
 * and returns the new event id; the fase-6 BEFORE trigger fills a unique landing slug.
 */
export async function createEventFromTemplate(
  input: CreateEventFromTemplateInput,
): Promise<CreateEventResult> {
  const parsed = createEventFromTemplateSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { templateId, name, startsAt, endsAt } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { data, error } = await supabase.rpc('create_event_from_template', {
    p_template_id: templateId,
    p_name: name,
    p_starts_at: startsAt,
    p_ends_at: endsAt ?? undefined,
  });
  if (error) return mapMutationError(error);
  revalidatePath(listPath);
  return { ok: true, eventId: data as string };
}

/**
 * Save an existing event's setup (tiers + capacity + default settings) as a new
 * reusable template (admin OR venue-organizer — create_template_from_event re-checks).
 */
export async function createTemplateFromEvent(
  input: CreateTemplateFromEventInput,
): Promise<CreateTemplateResult> {
  const parsed = createTemplateFromEventSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, name } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { data, error } = await supabase.rpc('create_template_from_event', {
    p_event_id: eventId,
    p_name: name,
  });
  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: '23505', message: 'A template with this name already exists.' };
    }
    return mapMutationError(error);
  }
  return { ok: true, templateId: data as string };
}
