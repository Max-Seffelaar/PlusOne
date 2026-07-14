'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/database.types';
import {
  mapMutationError,
  unauthorized,
  invalidInput,
  notFound,
  type MutationError,
} from '@/lib/db-errors';
import {
  addGuestSchema,
  bulkAddSchema,
  updateGuestSchema,
  changeTierSchema,
  changeTierBulkSchema,
  type AddGuestInput,
  type BulkAddInput,
  type UpdateGuestInput,
  type ChangeTierInput,
  type ChangeTierBulkInput,
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
  // venue_id is populated by the set_event_scope BEFORE INSERT trigger
  // (migration 20260708120000); cast over the omitted column.
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
  } as Database['public']['Tables']['guests']['Insert']);
  if (error) return mapMutationError(error);

  revalidatePath(guestsPath(eventId));
  return { ok: true };
}

const DEADLOCK_DETECTED = '40P01';
const BULK_DEADLOCK_RETRIES = 2;

/**
 * Add many guests in one statement. The insert is atomic: if the quota engine
 * rejects any row, the whole batch rolls back (#33 "blokkeert de batch").
 *
 * A batch spanning multiple tiers acquires the per-tier advisory locks
 * (86ey9e8ar, migration 20260714100000_quota_capacity_trigger_locking) in
 * row order, which two concurrent bulk imports touching the same capped
 * tiers in opposite order can deadlock on — Postgres aborts one side with
 * 40P01. The abort is atomic (nothing partially inserted), so a retry is
 * safe; it is not a masked oversell, just a rare contention error worth
 * absorbing rather than surfacing as a batch failure.
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
    email: g.email ?? null,
    phone: g.phone ?? null,
    source,
    added_by: user.id,
  }));

  // venue_id is populated by the set_event_scope BEFORE INSERT trigger
  // (migration 20260708120000); cast over the omitted column.
  let error = null;
  for (let attempt = 0; attempt <= BULK_DEADLOCK_RETRIES; attempt += 1) {
    ({ error } = await supabase.from('guests').insert(rows as Database['public']['Tables']['guests']['Insert'][]));
    if (!error || error.code !== DEADLOCK_DETECTED) break;
  }
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

  const { data, error, count } = await supabase
    .from('guests')
    .update(patch, { count: 'exact' })
    .eq('id', guestId)
    .select('event_id')
    .maybeSingle();
  if (error) return mapMutationError(error);
  if (!count) return notFound();
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

  const { data, error, count } = await supabase
    .from('guests')
    .update({ tier_id: tierId }, { count: 'exact' })
    .eq('id', guestId)
    .select('event_id')
    .maybeSingle();
  if (error) return mapMutationError(error);
  if (!count) return notFound();
  if (data?.event_id) revalidatePath(guestsPath(data.event_id));
  return { ok: true };
}

/** Move multiple guests to the same tier in one update (RLS filters to accessible rows). */
export async function changeGuestsTierBulk(input: ChangeTierBulkInput): Promise<ActionResult> {
  const parsed = changeTierBulkSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { guestIds, tierId, eventId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  // C15 guard, extended to the bulk path: a `.update().in()` that RLS filters to
  // zero rows returns NO error — returning ok:true would be a silent total
  // failure (locked list, or staff moving guests they don't own). `count:'exact'`
  // surfaces it. count > 0 (some rows filtered) is an accepted partial success.
  const { error, count } = await supabase
    .from('guests')
    .update({ tier_id: tierId }, { count: 'exact' })
    .in('id', guestIds)
    .select('id');
  if (error) return mapMutationError(error);
  if (!count) return notFound();

  revalidatePath(guestsPath(eventId));
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

  const { data, error, count } = await supabase
    .from('guests')
    .update({ status: 'removed' }, { count: 'exact' })
    .eq('id', guestId)
    .select('event_id')
    .maybeSingle();
  if (error) return mapMutationError(error);
  if (!count) return notFound();
  if (data?.event_id) revalidatePath(guestsPath(data.event_id));
  return { ok: true };
}
