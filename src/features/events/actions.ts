'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { alreadyRegistered, sendInviteEmail } from '@/features/auth/invite-mail';
import { getAuthContext } from '@/lib/auth/context';
import { mapMutationError, unauthorized, invalidInput, notFound, type MutationError } from '@/lib/db-errors';
import { assertVenueBillingActive } from '@/features/billing/gate';
import { buildEventSlug } from './slug';
import type { Database } from '@/lib/database.types';
import {
  createEventSchema,
  updateEventSchema,
  setCancelledSchema,
  setLandingActiveSchema,
  setLockSchema,
  setAutoLockSchema,
  setAllowUncheckSchema,
  createTierSchema,
  updateTierSchema,
  deleteTierSchema,
  assignOrganizerSchema,
  inviteExternalCrewSchema,
  removeOrganizerSchema,
  resendCrewInviteSchema,
  setEventUserQuotaSchema,
  setEventDefaultMemberQuotaSchema,
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
  type SetCancelledInput,
  type SetLandingActiveInput,
  type SetLockInput,
  type SetAutoLockInput,
  type SetAllowUncheckInput,
  type CreateTierInput,
  type UpdateTierInput,
  type DeleteTierInput,
  type AssignOrganizerInput,
  type InviteExternalCrewInput,
  type RemoveOrganizerInput,
  type ResendCrewInviteInput,
  type SetEventUserQuotaInput,
  type SetEventDefaultMemberQuotaInput,
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

// ── Event CRUD ──────────────────────────────────────────────────────────────

/** Create an event (admin only — RLS events_insert_admin). Slug auto-generated. */
export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId, name, startsAt, endsAt, landingActive } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  // Soft-block (#32 refinement): a canceled venue / lapsed unpaid trial adds no
  // NEW events; existing events keep running (door included).
  const blocked = await assertVenueBillingActive(venueId);
  if (blocked) return blocked;

  // Retry on the astronomically rare slug collision with a fresh suffix.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from('events')
      // default_member_quota is trigger-seeded from the venue default
      // (events_set_default_member_quota); omit it from the row and cast so the
      // NOT-NULL Insert type doesn't demand a client-supplied value (T10).
      .insert({
        venue_id: venueId,
        name,
        starts_at: startsAt,
        ends_at: endsAt ?? null,
        landing_active: landingActive,
        landing_slug: buildEventSlug(name, startsAt),
      } as Database['public']['Tables']['events']['Insert'])
      .select('id')
      .single();

    if (!error && data) {
      revalidatePath(listPath);
      return { ok: true, eventId: data.id };
    }
    if (error?.code === '23505') continue; // slug clash → new suffix
    return mapMutationError(error);
  }
  return { ok: false, code: 'slug', message: "Couldn't generate a unique landing link. Try again." };
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

  const { error, count } = await supabase
    .from('events')
    .update({ cancelled_at: cancelled ? new Date().toISOString() : null }, { count: 'exact' })
    .eq('id', eventId);
  if (error) return mapMutationError(error);
  if (!count) return notFound();
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

  const { error, count } = await supabase
    .from('events')
    .update({ landing_active: active }, { count: 'exact' })
    .eq('id', eventId);
  if (error) return mapMutationError(error);
  if (!count) return notFound();
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

  const { error, count } = await supabase
    .from('events')
    .update(patch, { count: 'exact' })
    .eq('id', eventId);
  if (error) return mapMutationError(error);
  if (!count) return notFound();
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

  const { error, count } = await supabase
    .from('events')
    .update({ auto_lock_at: autoLockAt }, { count: 'exact' })
    .eq('id', eventId);
  if (error) return mapMutationError(error);
  if (!count) return notFound();
  revalidateEvent(eventId);
  return { ok: true };
}

// ── Uitchecken toestaan — per-event override (#3 / S1.1) ────────────────────────

/**
 * Set (or clear) the per-event "uitchecken toestaan" override. true/false force
 * the setting for this event; null inherits the venue (company) default. An
 * immediate operational control like setListLock — not part of the form save. RLS
 * (admin/organizer events update) is the boundary; the change is audited
 * (the consolidated audit_events trigger, C7 20260708100000) and the effective
 * value gates the door/cockpit void write via the RESTRICTIVE check_ins policy.
 */
export async function setEventAllowUncheck(input: SetAllowUncheckInput): Promise<ActionResult> {
  const parsed = setAllowUncheckSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, allowUncheck } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { error, count } = await supabase
    .from('events')
    .update({ allow_uncheck: allowUncheck }, { count: 'exact' })
    .eq('id', eventId);
  if (error) return mapMutationError(error);
  if (!count) return notFound();
  revalidateEvent(eventId);
  return { ok: true };
}

// ── Tiers (#8) ─────────────────────────────────────────────────────────────────

/** Define a tier (admin or organizer of the event — RLS guest_tiers_insert). */
export async function createTier(input: CreateTierInput): Promise<ActionResult> {
  const parsed = createTierSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, name, description, color, maxGuests, doorPriceCents, vatPercent, aliases } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  // venue_id is populated by the set_event_scope BEFORE INSERT trigger
  // (migration 20260708120000); cast over the omitted column.
  const { error } = await supabase.from('guest_tiers').insert({
    event_id: eventId,
    name,
    description,
    color,
    max_guests: maxGuests ?? null,
    door_price_cents: doorPriceCents ?? null,
    vat_percent: vatPercent ?? null,
    aliases,
  } as Database['public']['Tables']['guest_tiers']['Insert']);
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
  const { tierId, name, description, color, maxGuests, doorPriceCents, vatPercent, aliases } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const patch = {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(maxGuests !== undefined ? { max_guests: maxGuests } : {}),
    ...(doorPriceCents !== undefined ? { door_price_cents: doorPriceCents } : {}),
    ...(vatPercent !== undefined ? { vat_percent: vatPercent } : {}),
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

// ── External crew (event_organizers, #6/#24 + 86ey21vre) ─────────────────────
// "External crew" = event-scoped people (DJ/artist/guest organizer). Writes are
// admin role-only (RLS, AAL2 dropped 2026-06-24). They are no longer quota-exempt
// (migration 20260625120000), so add/invite carry an optional per-event guest
// quota written to event_quotas.quota_override.

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** Upsert a crew member's per-event guest quota (event_quotas, PK event+user). */
async function upsertCrewQuota(supabase: ServerClient, eventId: string, userId: string, quota: number) {
  return supabase
    .from('event_quotas')
    .upsert({ event_id: eventId, user_id: userId, quota_override: quota }, { onConflict: 'event_id,user_id' });
}

/** Add an existing (external) user as crew of an event, with an optional guest
 *  quota (admin — RLS; role-only since the #20 refinement 2026-06-24). */
export async function assignOrganizer(input: AssignOrganizerInput): Promise<ActionResult> {
  const parsed = assignOrganizerSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, userId, quota } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { error } = await supabase
    .from('event_organizers')
    .insert({ event_id: eventId, user_id: userId });
  if (error) {
    if (error.code === '23505') {
      return { ok: false, code: '23505', message: 'This person is already on this event’s crew.' };
    }
    return mapMutationError(error);
  }
  if (quota !== undefined) {
    const { error: qErr } = await upsertCrewQuota(supabase, eventId, userId, quota);
    if (qErr) return mapMutationError(qErr);
  }
  revalidateEvent(eventId);
  return { ok: true };
}

/**
 * Invite a brand-new external (#24) crew member by e-mail and add them to one or
 * more events, each with an optional guest quota. Mirrors the venue invite flow:
 * the auth identity + profile are provisioned server-side (service role — the
 * documented exception, so invite-only OTP login works and the FK resolves), then
 * each event_organizers scope + event_quotas override is written through the
 * USER-scoped client so RLS (admin) re-validates. No venue membership is created —
 * external crew stay out of the venue (#24).
 */
export async function inviteExternalCrew(input: InviteExternalCrewInput): Promise<ActionResult> {
  const parsed = inviteExternalCrewSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { email, eventIds, quota } = parsed.data;

  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  // C1 (security review 7/7): authorize BEFORE any service-role side effect.
  // Provisioning an auth account + sending the invite mail must never run for a
  // caller who isn't an admin of the venue(s) owning the target events — else any
  // authenticated user could drive an invite-only bypass, spam mail, and probe
  // account existence. Mirror resendCrewInvite: read through the USER-scoped
  // client so RLS backs the evidence. A non-admin, or an event id in a venue the
  // caller can't see, fails here generically (no oracle) — before line 470's
  // inviteUserByEmail.
  const supabase = await createClient();
  const uniqueEventIds = [...new Set(eventIds)];
  const { data: targetEvents, error: eventsError } = await supabase
    .from('events')
    .select('id, venue_id')
    .in('id', uniqueEventIds);
  if (eventsError) return mapMutationError(eventsError);
  if (!targetEvents || targetEvents.length !== uniqueEventIds.length) return unauthorized();

  const venueIds = [...new Set(targetEvents.map((e) => e.venue_id))];
  const { data: adminMemberships, error: membershipError } = await supabase
    .from('venue_memberships')
    .select('venue_id, roles')
    .eq('user_id', ctx.user.id)
    .in('venue_id', venueIds);
  if (membershipError) return mapMutationError(membershipError);
  const adminVenues = new Set(
    (adminMemberships ?? []).filter((m) => m.roles.includes('admin')).map((m) => m.venue_id),
  );
  if (!venueIds.every((v) => adminVenues.has(v))) return unauthorized();

  const fullName = email.split('@')[0];
  const service = createServiceClient();
  // inviteUserByEmail provisions the account AND sends the "You've been
  // invited" mail in one step (T8 fix — createUser sent no e-mail at all, so
  // external crew never heard about their access).
  const { data: created, error: createError } = await service.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
  });

  if (createError) {
    if (alreadyRegistered(createError)) {
      // The account already exists. We deliberately don't resolve their id
      // server-side (no enumeration); steer the admin to the returning-crew list.
      return {
        ok: false,
        code: 'exists',
        message:
          'This email already has an account. If they’ve worked here before, add them from the returning-crew list instead.',
      };
    }
    console.error('inviteExternalCrew: createUser failed', createError.message);
    return { ok: false, code: 'invite', message: "Couldn't create the invite. Try again." };
  }

  const crewUserId = created?.user?.id;
  if (!crewUserId) {
    return { ok: false, code: 'invite', message: "Couldn't create the invite. Try again." };
  }

  // Pre-provision the profile so event_organizers.user_id FK resolves. The user
  // owns it from first login (decision #24); accept_pending_invites leaves it be.
  const { error: profileError } = await service
    .from('user_profiles')
    .upsert({ id: crewUserId, full_name: fullName, email }, { onConflict: 'id', ignoreDuplicates: true });
  if (profileError) {
    console.error('inviteExternalCrew: profile upsert failed', profileError.message);
    return { ok: false, code: 'invite', message: "Couldn't record the invite." };
  }

  for (const eventId of eventIds) {
    const { error } = await supabase
      .from('event_organizers')
      .insert({ event_id: eventId, user_id: crewUserId });
    // A fresh account can't already be crew; tolerate 23505 defensively per event.
    if (error && error.code !== '23505') return mapMutationError(error);
    if (quota !== undefined) {
      const { error: qErr } = await upsertCrewQuota(supabase, eventId, crewUserId, quota);
      if (qErr) return mapMutationError(qErr);
    }
    revalidateEvent(eventId);
  }
  return { ok: true };
}

/**
 * Set an event's per-event default member quota — the value the add-crew flow
 * prefills (T10, 86ey4j1p5). Admin OR event organizer (RLS
 * events_update_admin_organizer is the boundary); the events audit trigger logs
 * the before/after. Changing one event's default never touches another event.
 */
export async function setEventDefaultMemberQuota(
  input: SetEventDefaultMemberQuotaInput,
): Promise<ActionResult> {
  const parsed = setEventDefaultMemberQuotaSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, quota } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { error } = await supabase
    .from('events')
    .update({ default_member_quota: quota })
    .eq('id', eventId);
  if (error) return mapMutationError(error);
  revalidateEvent(eventId);
  return { ok: true };
}

/** Set (or change) an external crew member's per-event guest quota (admin — RLS). */
export async function setEventUserQuota(input: SetEventUserQuotaInput): Promise<ActionResult> {
  const parsed = setEventUserQuotaSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, userId, quota } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { error } = await upsertCrewQuota(supabase, eventId, userId, quota);
  if (error) return mapMutationError(error);
  revalidateEvent(eventId);
  return { ok: true };
}

/**
 * Resend an external crew member's invite (T8, 86ey4j1mu): e-mail them a fresh
 * login link. Crew access was already granted directly (event_organizers), so
 * unlike a venue invite there is nothing to extend — the mail is the whole
 * resend. No DB write, so the boundary is the app-layer check: the caller must
 * be an ADMIN of the venue (mirrors all crew writes) and the target must be
 * crew on one of that venue's events — both read through the USER-scoped
 * client, so RLS backs the evidence.
 */
export async function resendCrewInvite(input: ResendCrewInviteInput): Promise<ActionResult> {
  const parsed = resendCrewInviteSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId, userId } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { data: membership } = await supabase
    .from('venue_memberships')
    .select('roles')
    .eq('venue_id', venueId)
    .eq('user_id', ctx.user.id)
    .maybeSingle();
  if (!membership?.roles.includes('admin')) return unauthorized();

  const { data: crewRow } = await supabase
    .from('event_organizers')
    .select('user_id, events!inner(venue_id)')
    .eq('user_id', userId)
    .eq('events.venue_id', venueId)
    .limit(1)
    .maybeSingle();
  if (!crewRow) {
    return { ok: false, code: 'noop', message: "This person isn't crew at this venue." };
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  if (!profile?.email) {
    return { ok: false, code: 'noop', message: "Couldn't find this person's e-mail." };
  }

  // Invite-first, magic-link fallback (shared with the venue-invite resend).
  // The order matters: a crew member who never accepted is an UNCONFIRMED
  // account, and signInWithOtp refuses those ("Signups not allowed") — only a
  // re-invite reaches them; a confirmed account takes the magic-link path.
  const sent = await sendInviteEmail(profile.email);
  if (!sent.ok) {
    return { ok: false, code: 'invite', message: "Couldn't send the e-mail. Try again." };
  }
  return { ok: true };
}

/** Remove a crew scope (admin — RLS, role-only since #20 2026-06-24). The user/account is untouched (#24). */
export async function removeOrganizer(input: RemoveOrganizerInput): Promise<ActionResult> {
  const parsed = removeOrganizerSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, userId } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

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
  const { templateId, name, description, color, maxGuests, doorPriceCents, vatPercent, aliases } = parsed.data;

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
    vat_percent: vatPercent ?? null,
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
  const { tierId, name, description, color, maxGuests, doorPriceCents, vatPercent, aliases } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const patch = {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(maxGuests !== undefined ? { max_guests: maxGuests } : {}),
    ...(doorPriceCents !== undefined ? { door_price_cents: doorPriceCents } : {}),
    ...(vatPercent !== undefined ? { vat_percent: vatPercent } : {}),
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

  // Same soft-block as createEvent: resolve the template's venue (RLS-scoped
  // read; a non-member simply sees nothing and fails on the RPC as before).
  const { data: tpl } = await supabase
    .from('event_templates')
    .select('venue_id')
    .eq('id', templateId)
    .maybeSingle();
  if (tpl) {
    const blocked = await assertVenueBillingActive(tpl.venue_id);
    if (blocked) return blocked;
  }

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
