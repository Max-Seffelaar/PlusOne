'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import { updateVenueSchema, type UpdateVenueInput } from './schemas';

export type ActionResult = { ok: true } | MutationError;

/**
 * Edit venue settings: name, location address (#platform — feeds guest comms),
 * AVG retention. Same contract as the other domain actions — session verified
 * server-side, Zod-validated, mutated through the USER-scoped client so RLS
 * (venues_update_admin: admin at this venue) is the real boundary, never the
 * service client. Note: venues is NOT in the audited entity set (spec #4 scopes
 * the audit log to the guest-list/quota/check-in tables), so no audit row is
 * written here — access is admin-gated by RLS. Auditing venue settings (esp. the
 * AVG retention window) is a possible future hardening.
 */
export async function updateVenue(input: UpdateVenueInput): Promise<ActionResult> {
  const parsed = updateVenueSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId, name, address, retentionMonths } = parsed.data;

  const patch = {
    ...(name !== undefined ? { name } : {}),
    // '' clears the address back to null; a value stores it as-is.
    ...(address !== undefined ? { address: address.length > 0 ? address : null } : {}),
    ...(retentionMonths !== undefined ? { retention_months: retentionMonths } : {}),
  };
  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { error } = await supabase.from('venues').update(patch).eq('id', venueId);
  if (error) return mapMutationError(error);

  revalidatePath('/dashboard');
  return { ok: true };
}
