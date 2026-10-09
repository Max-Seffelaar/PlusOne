'use server';

// A company's saved locations (z8uq9m444c). Security checklist: session
// verified server-side (getUser), input through Zod, every write through the
// USER-scoped client so RLS is the role gate (company_locations_insert/update:
// has_venue_role admin, which also covers a platform admin, #49) and proves
// the row belongs to the caller's venue — a client-supplied id from another
// venue updates 0 rows and comes back not-found. No delete: archive only (the
// table grants no DELETE). Errors to the client are generic.
//
// Online-only admin settings, so a server action (not the door outbox).

import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/context';
import { mapMutationError, invalidInput, notFound, unauthorized, type MutationError } from '@/lib/db-errors';
import {
  archiveCompanyLocationSchema,
  createCompanyLocationSchema,
  updateCompanyLocationSchema,
  type ArchiveCompanyLocationInput,
  type CreateCompanyLocationInput,
  type UpdateCompanyLocationInput,
} from './location-schemas';

export type LocationActionResult = { ok: true } | MutationError;
export type CreateLocationResult = { ok: true; locationId: string } | MutationError;

export async function createCompanyLocationAction(input: CreateCompanyLocationInput): Promise<CreateLocationResult> {
  const parsed = createCompanyLocationSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { venueId, name, addressLine, postalCode, city, country, placeId } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('company_locations')
    .insert({
      venue_id: venueId,
      name,
      address_line: addressLine,
      postal_code: postalCode,
      city,
      country,
      place_id: placeId ?? null,
    })
    .select('id')
    .single();
  if (error || !data) {
    if (error) console.error('createCompanyLocation: insert failed', error.code);
    return mapMutationError(error);
  }
  return { ok: true, locationId: data.id };
}

export async function updateCompanyLocationAction(input: UpdateCompanyLocationInput): Promise<LocationActionResult> {
  const parsed = updateCompanyLocationSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const { locationId, name, addressLine, postalCode, city, country, placeId } = parsed.data;
  const supabase = await createClient();
  const { error, count } = await supabase
    .from('company_locations')
    .update(
      {
        name,
        address_line: addressLine,
        postal_code: postalCode,
        city,
        country,
        // Absent = keep; a manual edit sends null (the pick no longer applies).
        ...(placeId !== undefined ? { place_id: placeId } : {}),
      },
      { count: 'exact' }
    )
    .eq('id', locationId)
    .is('archived_at', null);
  if (error) return mapMutationError(error);
  if (!count) return notFound();
  return { ok: true };
}

export async function archiveCompanyLocationAction(input: ArchiveCompanyLocationInput): Promise<LocationActionResult> {
  const parsed = archiveCompanyLocationSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const supabase = await createClient();
  const { error, count } = await supabase
    .from('company_locations')
    .update({ archived_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', parsed.data.locationId)
    .is('archived_at', null);
  if (error) return mapMutationError(error);
  if (!count) return notFound();
  return { ok: true };
}
