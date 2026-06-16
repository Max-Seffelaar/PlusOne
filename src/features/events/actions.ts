'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import {
  createEventSchema,
  updateEventSchema,
  setListLockSchema,
  createTierSchema,
  updateTierSchema,
  type CreateEventInput,
  type UpdateEventInput,
  type SetListLockInput,
  type CreateTierInput,
  type UpdateTierInput,
} from './schemas';

// Same contract as guests/quotas actions: verify the session server-side,
// validate with Zod, then mutate through the USER-scoped client so RLS (venue
// role, organizer scope, list-lock #23, #24) is the real boundary — never the
// service client. Event/tier mutations are picked up by the audit triggers.

export type ActionResult = { ok: true } | MutationError;
export type CreateResult = { ok: true; id: string } | MutationError;

const uuidRe = /^[0-9a-f-]{36}$/i;

/** URL-safe slug for the public landing link, with a short unique suffix. */
function landingSlug(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 40) || 'event';
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

// ── Events ──────────────────────────────────────────────────────────────────

/** Create an event in a venue. RLS decides who may (admin/organizer, #6/#24). */
export async function createEvent(input: CreateEventInput): Promise<CreateResult> {
  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId, name, startsAt, endsAt, landingActive } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from('events')
    .insert({
      venue_id: venueId,
      name,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt ? endsAt.toISOString() : null,
      landing_slug: landingSlug(name),
      landing_active: landingActive ?? false,
    })
    .select('id')
    .single();
  if (error || !data) return mapMutationError(error);

  revalidatePath('/dashboard');
  return { ok: true, id: data.id };
}

/**
 * Duplicate an event as a fresh draft (event-template, #recurring nights). Copies
 * the basics + the whole tier setup (names/aliases/caps — the reusable part) but
 * NEVER the guests or check-ins. The copy lands as a draft with the landing page
 * off and a new slug; lock/live state is reset. All reads + writes go through the
 * user-scoped client so RLS (admin/organizer at the venue, #6/#24) gates it, and
 * the audit triggers record the new event + tiers.
 */
export async function duplicateEvent(eventId: string): Promise<CreateResult> {
  if (!uuidRe.test(eventId)) return invalidInput();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  // Source basics (RLS: the caller can only read events in their own venues).
  const { data: src, error: srcErr } = await supabase
    .from('events')
    .select('venue_id, name, starts_at, ends_at')
    .eq('id', eventId)
    .single();
  if (srcErr || !src) return mapMutationError(srcErr);

  const copyName = `${src.name} (kopie)`;
  const { data: created, error: createErr } = await supabase
    .from('events')
    .insert({
      venue_id: src.venue_id,
      name: copyName,
      starts_at: src.starts_at,
      ends_at: src.ends_at,
      landing_slug: landingSlug(copyName),
      landing_active: false,
    })
    .select('id')
    .single();
  if (createErr || !created) return mapMutationError(createErr);

  // Clone the tier setup. Best-effort: if this fails the draft event still
  // exists (tiers can be re-added by hand), so we don't fail the whole copy —
  // unique (event_id, name) can't collide since the new event has no tiers yet.
  const { data: tiers } = await supabase
    .from('guest_tiers')
    .select('name, description, color, max_guests, aliases')
    .eq('event_id', eventId);
  if (tiers && tiers.length > 0) {
    await supabase.from('guest_tiers').insert(
      tiers.map((t) => ({
        event_id: created.id,
        name: t.name,
        description: t.description,
        color: t.color,
        max_guests: t.max_guests,
        aliases: t.aliases ?? [],
      }))
    );
  }

  revalidatePath('/dashboard');
  return { ok: true, id: created.id };
}

/** Edit event basics. List-lock has its own action (audited separately, #23). */
export async function updateEvent(input: UpdateEventInput): Promise<ActionResult> {
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, name, startsAt, endsAt, landingActive } = parsed.data;

  const patch = {
    ...(name !== undefined ? { name } : {}),
    ...(startsAt !== undefined ? { starts_at: startsAt.toISOString() } : {}),
    ...(endsAt !== undefined ? { ends_at: endsAt ? endsAt.toISOString() : null } : {}),
    ...(landingActive !== undefined ? { landing_active: landingActive } : {}),
  };
  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { error } = await supabase.from('events').update(patch).eq('id', eventId);
  if (error) return mapMutationError(error);

  revalidatePath('/dashboard');
  revalidatePath(`/events/${eventId}/guests`);
  return { ok: true };
}

/** Lock/unlock the guest list (#6/#23 — its own audited action). */
export async function setListLock(input: SetListLockInput): Promise<ActionResult> {
  const parsed = setListLockSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, locked } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { error } = await supabase
    .from('events')
    .update({
      list_locked: locked,
      locked_at: locked ? new Date().toISOString() : null,
      locked_by: locked ? user.id : null,
    })
    .eq('id', eventId);
  if (error) return mapMutationError(error);

  revalidatePath('/dashboard');
  revalidatePath(`/events/${eventId}/guests`);
  return { ok: true };
}

// ── Tiers ───────────────────────────────────────────────────────────────────

/** Add a tier to an event. aliases[] feed the quick-add parser (#33). */
export async function createTier(input: CreateTierInput): Promise<CreateResult> {
  const parsed = createTierSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, name, color, maxGuests, description, aliases } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from('guest_tiers')
    .insert({
      event_id: eventId,
      name,
      color: color ?? null,
      max_guests: maxGuests ?? null,
      description: description ?? null,
      aliases: aliases ?? [],
    })
    .select('id')
    .single();
  if (error || !data) return mapMutationError(error);

  revalidatePath(`/events/${eventId}/guests`);
  return { ok: true, id: data.id };
}

/** Edit a tier (name/colour/max/aliases). */
export async function updateTier(input: UpdateTierInput): Promise<ActionResult> {
  const parsed = updateTierSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { tierId, name, color, maxGuests, description, aliases } = parsed.data;

  const patch = {
    ...(name !== undefined ? { name } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(maxGuests !== undefined ? { max_guests: maxGuests } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(aliases !== undefined ? { aliases } : {}),
  };
  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from('guest_tiers')
    .update(patch)
    .eq('id', tierId)
    .select('event_id')
    .maybeSingle();
  if (error) return mapMutationError(error);
  if (data?.event_id) revalidatePath(`/events/${data.event_id}/guests`);
  return { ok: true };
}

/** Remove a tier. The DB FK blocks deletion while guests still reference it. */
export async function deleteTier(tierId: string): Promise<ActionResult> {
  if (!uuidRe.test(tierId)) return invalidInput();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from('guest_tiers')
    .delete()
    .eq('id', tierId)
    .select('event_id')
    .maybeSingle();
  if (error) return mapMutationError(error);
  if (data?.event_id) revalidatePath(`/events/${data.event_id}/guests`);
  return { ok: true };
}
