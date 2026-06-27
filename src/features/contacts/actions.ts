'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import {
  upsertContactSchema,
  togglePermanentSchema,
  syncPermanentSchema,
  addContactToEventSchema,
  importContactsSchema,
  forgetContactSchema,
  promoteGuestToContactSchema,
  type UpsertContactInput,
  type TogglePermanentInput,
  type SyncPermanentInput,
  type AddContactToEventInput,
  type ImportContactsInput,
  type ForgetContactInput,
  type PromoteGuestToContactInput,
} from './schemas';

export type ActionResult = { ok: true } | MutationError;
/** Sync reports how many house guests it added (for the toast). */
export type SyncResult = { ok: true; added: number } | MutationError;
/** Import reports per-row outcome for the toast. */
export type ImportResult =
  | { ok: true; inserted: number; updated: number; skipped: number }
  | MutationError;

// Every action: verify the session server-side, validate with Zod, then mutate
// through the USER-scoped client so RLS (manager-only writes, #24) and the quota
// engine (#22/#31) stay the real boundary — never the service client (CLAUDE.md).
// The permanent sync / add-to-event paths are SECURITY DEFINER RPCs that
// self-guard role + list-lock and write past RLS deliberately.

const APP_PATH = '/app';

/** Create or edit a single address-book contact (manager-only via RLS). */
export async function upsertContact(input: UpsertContactInput): Promise<ActionResult> {
  const parsed = upsertContactSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { id, venueId, fullName, email, phone, birthdate, preferredRole, note, isPermanent } =
    parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  if (id) {
    // Edit: never touch venue_id / created_by; *_norm are generated.
    const patch = {
      full_name: fullName,
      email: email ?? null,
      phone: phone ?? null,
      birthdate: birthdate ?? null,
      preferred_role: preferredRole ?? null,
      note: note ?? null,
      ...(isPermanent !== undefined ? { is_permanent: isPermanent } : {}),
    };
    const { error } = await supabase.from('contacts').update(patch).eq('id', id);
    if (error) return mapMutationError(error);
  } else {
    const { error } = await supabase.from('contacts').insert({
      venue_id: venueId,
      full_name: fullName,
      email: email ?? null,
      phone: phone ?? null,
      birthdate: birthdate ?? null,
      preferred_role: preferredRole ?? null,
      note: note ?? null,
      is_permanent: isPermanent ?? false,
      created_by: user.id,
    });
    if (error) return mapMutationError(error);
  }

  revalidatePath(APP_PATH);
  return { ok: true };
}

/**
 * On-request erasure (AVG art. 17 / #29): immediately anonymize one address-book
 * contact + all its linked guests + their refusals, ignoring the retention
 * window. The forget_contact RPC self-guards admin-of-venue (the DB is the
 * boundary); admin is an MFA-mandatory role, so no extra per-action AAL2 step-up.
 * Irreversible — the UI confirms before calling this.
 */
export async function forgetContact(input: ForgetContactInput): Promise<ActionResult> {
  const parsed = forgetContactSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { error } = await supabase.rpc('forget_contact', {
    p_contact_id: parsed.data.contactId,
  });
  if (error) return mapMutationError(error);

  revalidatePath(APP_PATH);
  return { ok: true };
}

/** Star/unstar a contact as a permanent guest (#11). RLS limits this to managers. */
export async function toggleContactPermanent(input: TogglePermanentInput): Promise<ActionResult> {
  const parsed = togglePermanentSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { contactId, isPermanent } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { error } = await supabase
    .from('contacts')
    .update({ is_permanent: isPermanent })
    .eq('id', contactId);
  if (error) return mapMutationError(error);

  revalidatePath(APP_PATH);
  return { ok: true };
}

/**
 * Sync the venue's permanent contacts onto an event (#11). Idempotent and
 * re-runnable; skips contacts manually removed from this event ("respect the
 * removal"). The RPC self-guards admin/organizer + list-lock.
 */
export async function syncPermanentGuests(input: SyncPermanentInput): Promise<SyncResult> {
  const parsed = syncPermanentSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase.rpc('sync_permanent_guests_into_event', {
    p_event_id: eventId,
  });
  if (error) return mapMutationError(error);

  revalidatePath(APP_PATH);
  revalidatePath(`/events/${eventId}/guests`);
  return { ok: true, added: data ?? 0 };
}

/**
 * Add one address-book contact to an event (Adresboek "+"). A deliberate manual
 * add clears any prior "respect the removal" exclusion. The RPC self-guards
 * can_write_guests; the quota engine charges the actor as for any source=app add.
 */
export async function addContactToEvent(input: AddContactToEventInput): Promise<ActionResult> {
  const parsed = addContactToEventSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { contactId, eventId, tierId, plusOnes } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { error } = await supabase.rpc('add_contact_to_event', {
    p_contact_id: contactId,
    p_event_id: eventId,
    ...(tierId ? { p_tier_id: tierId } : {}),
    ...(plusOnes ? { p_plus_ones: plusOnes } : {}),
  });
  if (error) return mapMutationError(error);

  revalidatePath(APP_PATH);
  revalidatePath(`/events/${eventId}/guests`);
  return { ok: true };
}

/**
 * Bulk-import contacts into the address book (#10): paste / CSV / phone-contacts.
 * Idempotent + deduped in the upsert_contacts RPC (self-guarded admin/organizer).
 */
export async function importContacts(input: ImportContactsInput): Promise<ImportResult> {
  const parsed = importContactsSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId, rows } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const payload = rows.map((r) => ({
    full_name: r.fullName,
    email: r.email ?? null,
    phone: r.phone ?? null,
    birthdate: r.birthdate ?? null,
    preferred_role: r.preferredRole ?? null,
  }));

  const { data, error } = await supabase.rpc('upsert_contacts', {
    p_venue_id: venueId,
    p_rows: payload,
  });
  if (error) return mapMutationError(error);

  const r = (data ?? {}) as { inserted?: number; updated?: number; skipped?: number };
  revalidatePath(APP_PATH);
  return {
    ok: true,
    inserted: r.inserted ?? 0,
    updated: r.updated ?? 0,
    skipped: r.skipped ?? 0,
  };
}

/**
 * Explicit promote: create a contact from a name-only guest (no dedup key needed).
 * Calls the promote_guest_to_contact SECURITY DEFINER RPC (20260625100000).
 * When the guest already has email/phone the trigger path (updateGuest) is preferred;
 * this is the fallback for truly name-only guests.
 */
export async function promoteGuestToContact(input: PromoteGuestToContactInput): Promise<ActionResult> {
  const parsed = promoteGuestToContactSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { error } = await supabase.rpc('promote_guest_to_contact', {
    p_guest_id: parsed.data.guestId,
  });
  if (error) return mapMutationError(error);

  revalidatePath(APP_PATH);
  return { ok: true };
}
