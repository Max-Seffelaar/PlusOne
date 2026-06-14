'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import { retentionSchema, type RetentionInput } from './schemas';

export type ActionResult = { ok: true } | MutationError;

/**
 * Update a venue's AVG retention window (#16/#29). Admin-only — enforced by RLS
 * (venues_update_admin); we still verify the session and validate input, and
 * write through the USER-scoped client so RLS stays the security boundary
 * (CLAUDE.md security checklist). The job in run_privacy_retention() reads this
 * value the next time it runs. No AAL2: the venues update policy intentionally
 * does not require it (unlike role/quota changes).
 */
export async function updateVenueRetentionAction(input: RetentionInput): Promise<ActionResult> {
  const parsed = retentionSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId, retentionMonths } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  // .select() back: under RLS a non-admin's update silently matches 0 rows
  // (no error). An empty result therefore means "not allowed" — surface it
  // rather than reporting a false success.
  const { data, error } = await supabase
    .from('venues')
    .update({ retention_months: retentionMonths })
    .eq('id', venueId)
    .select('id');
  if (error) return mapMutationError(error);
  if (!data || data.length === 0) {
    return { ok: false, code: 'forbidden', message: 'Je hebt hier geen rechten voor.' };
  }

  revalidatePath('/admin/venue');
  return { ok: true };
}
