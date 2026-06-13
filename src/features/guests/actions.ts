'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import {
  addGuestSchema,
  bulkAddSchema,
  updateGuestSchema,
  changeTierSchema,
  type AddGuestInput,
  type BulkAddInput,
  type UpdateGuestInput,
  type ChangeTierInput,
} from './schemas';

export type ActionResult = { ok: true } | MutationError;

// Every action: verify the session server-side, validate input with Zod, then
// mutate through the USER-scoped client so RLS (membership, role, list-lock,
// #24) and the quota engine (#22/#31) are the real boundary — never the service
// client (CLAUDE.md). The quota/tier triggers surface as 45001/45002.

function guestsPath(eventId: string) {
  return `/events/${eventId}/guests`;
}

/** Add one guest (quick-add resolved line, or door add-on-the-spot). */
export async function addGuest(input: AddGuestInput): Promise<ActionResult> {
  const parsed = addGuestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { id, eventId, tierId, fullName, plusOnes, email, phone, source } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  // added_by MUST be the actor — RLS pins it, we never accept it from the client (#27).
  const { error } = await supabase.from('guests').insert({
    ...(id ? { id } : {}),
    event_id: eventId,
    tier_id: tierId,
    full_name: fullName,
    plus_ones: plusOnes,
    email,
    phone,
    source,
    added_by: user.id,
  });
  if (error) return mapMutationError(error);

  revalidatePath(guestsPath(eventId));
  return { ok: true };
}

/**
 * Add many guests in one statement. The insert is atomic: if the quota engine
 * rejects any row, the whole batch rolls back (#33 "blokkeert de batch").
 */
export async function addGuestsBulk(input: BulkAddInput): Promise<ActionResult> {
  const parsed = bulkAddSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, guests, source } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const rows = guests.map((g) => ({
    ...(g.id ? { id: g.id } : {}),
    event_id: eventId,
    tier_id: g.tierId,
    full_name: g.fullName,
    plus_ones: g.plusOnes,
    source,
    added_by: user.id,
  }));

  const { error } = await supabase.from('guests').insert(rows);
  if (error) return mapMutationError(error);

  revalidatePath(guestsPath(eventId));
  return { ok: true };
}

/** Edit an existing guest (classic form). Staff may only touch their own (RLS). */
export async function updateGuest(input: UpdateGuestInput): Promise<ActionResult> {
  const parsed = updateGuestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { guestId, fullName, plusOnes, email, phone, note, notePriority } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  // Build a typed partial so supabase-js's strict update typing is satisfied.
  const patch = {
    ...(fullName !== undefined ? { full_name: fullName } : {}),
    ...(plusOnes !== undefined ? { plus_ones: plusOnes } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(notePriority !== undefined ? { note_priority: notePriority } : {}),
  };
  if (Object.keys(patch).length === 0) return { ok: true };

  const { data, error } = await supabase
    .from('guests')
    .update(patch)
    .eq('id', guestId)
    .select('event_id')
    .maybeSingle();
  if (error) return mapMutationError(error);
  if (data?.event_id) revalidatePath(guestsPath(data.event_id));
  return { ok: true };
}

/** Move a guest to another tier (#5; audit trigger derives 'tier_change'). */
export async function changeGuestTier(input: ChangeTierInput): Promise<ActionResult> {
  const parsed = changeTierSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { guestId, tierId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from('guests')
    .update({ tier_id: tierId })
    .eq('id', guestId)
    .select('event_id')
    .maybeSingle();
  if (error) return mapMutationError(error);
  if (data?.event_id) revalidatePath(guestsPath(data.event_id));
  return { ok: true };
}

/** Soft delete (#21): status -> removed. Hard delete is revoked at the DB. */
export async function removeGuest(guestId: string): Promise<ActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(guestId)) return invalidInput();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from('guests')
    .update({ status: 'removed' })
    .eq('id', guestId)
    .select('event_id')
    .maybeSingle();
  if (error) return mapMutationError(error);
  if (data?.event_id) revalidatePath(guestsPath(data.event_id));
  return { ok: true };
}
