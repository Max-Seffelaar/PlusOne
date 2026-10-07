'use server';

import { createClient } from '@/lib/supabase/server';
import { sendInviteEmail } from '@/features/auth/invite-mail';
import { inviteMailCapReached } from '@/features/mail/limits';
import { getAuthContext, getMyProfile } from '@/lib/auth/context';
import { isDemoReviewUser } from '@/features/auth/review-window';
import { DEMO_USER_ID } from '@/features/auth/demo-account';
import { t } from '@/lib/i18n';
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
// client so RLS (membership/role, #23/#24) and the fase-6 status trigger
// (SQLSTATE 45004) are the real boundary — never the service client, except the
// documented organizer-invite account provisioning. Invalid status moves surface
// as 45004 → src/lib/db-errors.ts.

export type ActionResult = { ok: true } | MutationError;
export type CreateEventResult = { ok: true; eventId: string } | MutationError;
export type CreateTemplateResult = { ok: true; templateId: string } | MutationError;

// ── Event CRUD ──────────────────────────────────────────────────────────────

/** Create an event (admin only — RLS events_insert_admin). Slug auto-generated. */
export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId, name, startsAt, endsAt, landingActive, locationName, locationAddress } = parsed.data;

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
        location_name: locationName ?? null,
        location_address: locationAddress ?? null,
        landing_slug: buildEventSlug(name, startsAt),
      } as Database['public']['Tables']['events']['Insert'])
      .select('id')
      .single();

    if (!error && data) {
      return { ok: true, eventId: data.id };
    }
    if (error?.code === '23505') continue; // slug clash → new suffix
    return mapMutationError(error);
  }
  return { ok: false, code: 'slug', message: "Couldn't generate a unique landing link. Try again." };
}

/** Edit name / start / end / location (admin or organizer — RLS). */
export async function updateEvent(input: UpdateEventInput): Promise<ActionResult> {
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, name, startsAt, endsAt, locationName, locationAddress } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const patch = {
    ...(name !== undefined ? { name } : {}),
    ...(startsAt !== undefined ? { starts_at: startsAt } : {}),
    ...(endsAt !== undefined ? { ends_at: endsAt } : {}),
    ...(locationName !== undefined ? { location_name: locationName } : {}),
    ...(locationAddress !== undefined ? { location_address: locationAddress } : {}),
  };
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase.from('events').update(patch).eq('id', eventId);
  if (error) return mapMutationError(error);
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
  // C15 guard (as on the event toggles): an update RLS filters to zero rows
  // returns no error and no row. Now that the tier sheet edits every field
  // (z8uq9m0hw3), a silent no-op must surface as a failure, not "saved".
  if (!data) return notFound();
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
  // The store-review demo account adds no crew (86ey6bfug): the real stop is
  // the event_organizers trigger (20260925150000), this only gives the UI a
  // clear message.
  if (isDemoReviewUser(ctx.user)) return { ok: false, code: '42501', message: t.auth.demoNoInvites };
  // Nor is the demo account ever added as crew, by anyone (round 10: the
  // trigger refuses organizer rows for the demo user too).
  if (userId === DEMO_USER_ID) return { ok: false, code: '42501', message: t.auth.demoCannotJoin };

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
  return { ok: true };
}

const CREW_INVITE_TTL_DAYS = 7;

/** The per-crew-invite mail outcome as the crew sheet should show it. */
function crewMailFailure(reason: 'provision' | 'notify' | 'recent' | 'cap'): ActionResult | null {
  if (reason === 'recent') return { ok: false, code: 'mail_recent', message: t.auth.inviteMailRecent };
  if (reason === 'cap') return { ok: false, code: 'mail_cap', message: t.auth.inviteMailCapReached };
  if (reason === 'provision') return { ok: false, code: 'invite', message: "Couldn't send the invite. Try again." };
  // 'notify': the account exists and the invite row is what grants access on
  // accept; a lost notification is not a failed invite (same as a team invite).
  return null;
}

/**
 * Invite someone as external crew (#6/#24) on one or more events, each with an
 * optional guest quota (z8uq9m2yvp, decision Max 2026-10-07). ONE path for a new
 * and an existing account: an open crew invite per event (invites with no venue
 * roles, one event id, crew_quota), written through the USER-scoped client so
 * RLS (invites_insert: admin of the venue, every event in that venue) is the
 * boundary, then the invitation mail. Nothing about the target changes until
 * THEY accept (accept_my_invites in the Home banner; a brand-new account accepts
 * at its first login): only then does an event_organizers row exist, so only
 * then can the company see their profile (can_view_profile). The server never
 * looks an account up by e-mail, and the result is the same for a new address,
 * an existing account, a member of this company (nothing written) and someone
 * already on the crew (nothing written): no enumeration oracle.
 */
export async function inviteExternalCrew(input: InviteExternalCrewInput): Promise<ActionResult> {
  const parsed = inviteExternalCrewSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { email, eventIds, quota } = parsed.data;

  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  // The store-review demo account never invites (86ey6bfug). The invites
  // trigger refuses the demo venue too; this gives the UI the clear message and
  // keeps the provisioning mail below from ever running for it.
  if (isDemoReviewUser(ctx.user)) return { ok: false, code: '42501', message: t.auth.demoNoInvites };

  // C1 (security review 7/7): authorize BEFORE any service-role side effect (the
  // invitation mail provisions an auth account). The caller must be an admin of
  // the venue(s) owning every target event, read through the USER-scoped client
  // so RLS backs the evidence; a non-admin, or an event in a venue the caller
  // can't see, fails here generically. RLS on the invite insert re-checks.
  const supabase = await createClient();
  const uniqueEventIds = [...new Set(eventIds)];
  const { data: targetEvents, error: eventsError } = await supabase
    .from('events')
    .select('id, venue_id, name')
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

  // Daily invitation-mail cap per company (decision Max 2026-10-07): refuse
  // before anything is created, so no invite row is left without its mail.
  for (const venueId of venueIds) {
    if (await inviteMailCapReached(venueId)) {
      return { ok: false, code: 'mail_cap', message: t.auth.inviteMailCapReached };
    }
  }

  // Who is already in: a member of the venue never becomes crew of its own
  // company's event (review should-fix), and someone already on an event's crew
  // gets no new invite (their quota stays as it is). Both read through RLS: the
  // admin already sees their own team and their own events' crew, so this
  // learns nothing new. Profile e-mail is owner-editable, so this is a
  // convenience; accept_invites_for_caller re-checks membership at accept time.
  const [{ data: memberRows }, { data: crewRows }] = await Promise.all([
    supabase
      .from('venue_memberships')
      .select('venue_id, user_profiles!inner(email)')
      .in('venue_id', venueIds)
      .ilike('user_profiles.email', likeLiteral(email)),
    supabase
      .from('event_organizers')
      .select('event_id, user_profiles!inner(email)')
      .in('event_id', uniqueEventIds)
      .ilike('user_profiles.email', likeLiteral(email)),
  ]);
  const memberVenues = new Set((memberRows ?? []).map((r) => r.venue_id));
  const crewEvents = new Set((crewRows ?? []).map((r) => r.event_id));

  const expiresAt = new Date(Date.now() + CREW_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Events per venue that got a new or refreshed invite: one mail per venue.
  const invitedByVenue = new Map<string, string[]>();
  for (const ev of targetEvents) {
    if (memberVenues.has(ev.venue_id) || crewEvents.has(ev.id)) continue;
    const { error } = await supabase.from('invites').insert({
      venue_id: ev.venue_id,
      email,
      roles: [],
      event_ids: [ev.id],
      crew_quota: quota ?? null,
      invited_by: ctx.user.id,
      expires_at: expiresAt,
    });
    if (error) {
      if (error.code !== '23505') {
        // The invites trigger refuses the demo account's address (20260925150000).
        if (error.code === '42501' && /demo/i.test(error.message)) {
          return { ok: false, code: '42501', message: t.auth.demoCannotJoin };
        }
        return mapMutationError(error);
      }
      // An open invite for this person and event exists: re-inviting is a
      // resend. Fresh expiry (RLS invites_update_resend), quota untouched.
      const { error: bumpError } = await supabase
        .from('invites')
        .update({ expires_at: expiresAt })
        .eq('venue_id', ev.venue_id)
        .ilike('email', likeLiteral(email))
        .is('accepted_at', null)
        .filter('roles', 'eq', '{}')
        .contains('event_ids', [ev.id]);
      if (bumpError) return mapMutationError(bumpError);
    }
    invitedByVenue.set(ev.venue_id, [...(invitedByVenue.get(ev.venue_id) ?? []), ev.name]);
  }

  // The invitation mail, per venue. New or never-accepted address: Supabase's
  // invite mail (provisions the account; counted toward the company's cap).
  // Confirmed account: the crew mail ("invited you … accept in the app") or,
  // with no venue name, the magic-link fallback. The mail is identical in
  // shape for both, and the response below does not depend on which went out.
  if (invitedByVenue.size > 0) {
    const myProfile = await getMyProfile();
    for (const [venueId, eventNames] of invitedByVenue) {
      const { data: venue } = await supabase.from('venues').select('name').eq('id', venueId).maybeSingle();
      const existingAccountMail = venue?.name
        ? {
            template: 'team_added_to_event' as const,
            venueId,
            inviterName: myProfile?.full_name ?? null,
            companyName: venue.name,
            eventName: eventNames.join(', '),
            quota,
          }
        : undefined;
      const sent = await sendInviteEmail(email, { existingAccountMail, mailCapVenueId: venueId });
      if (!sent.ok) {
        const failure = crewMailFailure(sent.reason);
        if (failure) return failure;
      }
    }
  }
  return { ok: true };
}

/** `_`, `%` and `\` taken literally in an ILIKE pattern (crewEmail lower-cases
 *  and refuses `%`/`\`; `_` is legal in an address). */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
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
  // Same demo refusal as inviteExternalCrew (86ey6bfug): no invite mail from the demo account.
  if (isDemoReviewUser(ctx.user)) return { ok: false, code: '42501', message: t.auth.demoNoInvites };

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

  // Daily invitation-mail cap per company (decision Max 2026-10-07).
  if (await inviteMailCapReached(venueId)) {
    return { ok: false, code: 'mail_cap', message: t.auth.inviteMailCapReached };
  }

  // Display context for the crew reminder a CONFIRMED account gets (Mail-infra
  // F0): the caller's own name and the venue name, both through RLS. No venue
  // name = no context = the magic-link fallback below, unchanged.
  const [myProfile, { data: venue }] = await Promise.all([
    getMyProfile(),
    supabase.from('venues').select('name').eq('id', venueId).maybeSingle(),
  ]);
  const existingAccountMail = venue?.name
    ? {
        template: 'team_resend' as const,
        kind: 'event' as const,
        venueId,
        inviterName: myProfile?.full_name ?? null,
        companyName: venue.name,
      }
    : undefined;

  // Invite-first, then the team mail or the magic-link fallback (shared with
  // the venue-invite resend). The order matters: a crew member who never
  // accepted is an UNCONFIRMED account, and signInWithOtp refuses those
  // ("Signups not allowed") — only a re-invite reaches them; a confirmed
  // account takes the team-mail (or magic-link) path.
  const sent = await sendInviteEmail(profile.email, { existingAccountMail, mailCapVenueId: venueId });
  if (!sent.ok) {
    if (sent.reason === 'recent') return { ok: false, code: 'mail_recent', message: t.auth.inviteMailRecent };
    if (sent.reason === 'cap') return { ok: false, code: 'mail_cap', message: t.auth.inviteMailCapReached };
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
  const { venueId, name, capacity, allowUncheck, landingActive, autoLockOffsetMinutes, locationName, locationAddress } = parsed.data;

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
      location_name: locationName ?? null,
      location_address: locationAddress ?? null,
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
  const { templateId, name, capacity, allowUncheck, landingActive, autoLockOffsetMinutes, locationName, locationAddress } = parsed.data;

  const supabase = await createClient();
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const patch = {
    ...(name !== undefined ? { name } : {}),
    ...(capacity !== undefined ? { capacity } : {}),
    ...(allowUncheck !== undefined ? { allow_uncheck: allowUncheck } : {}),
    ...(landingActive !== undefined ? { landing_active: landingActive } : {}),
    ...(autoLockOffsetMinutes !== undefined ? { auto_lock_offset_minutes: autoLockOffsetMinutes } : {}),
    ...(locationName !== undefined ? { location_name: locationName } : {}),
    ...(locationAddress !== undefined ? { location_address: locationAddress } : {}),
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
