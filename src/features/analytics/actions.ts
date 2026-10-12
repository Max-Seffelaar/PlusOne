'use server';

/**
 * Profile → Product analytics: the caller turns in-app analytics off or back on
 * for themselves (plan §5, decision 1: on by default, self-service off).
 *
 * Security checklist (CLAUDE.md): session verified with getUser(); input is a
 * Zod-parsed boolean; the write goes through the USER-SCOPED client, where the
 * column grant (20261018120000: UPDATE (analytics_opt_out_at) only) and the RLS
 * policy user_profiles_update_self (id = auth.uid()) confine it to the caller's
 * own row. No id comes from the client. No PII in logs.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/context';
import { invalidInput, mapMutationError, unauthorized, type MutationError } from '@/lib/db-errors';

const optOutSchema = z.object({ optOut: z.boolean() }).strict();

export type SetAnalyticsOptOutResult = { ok: true; optedOut: boolean } | MutationError;

export async function setAnalyticsOptOutAction(input: unknown): Promise<SetAnalyticsOptOutResult> {
  const parsed = optOutSchema.safeParse(input);
  if (!parsed.success) return invalidInput();
  const user = await getSessionUser();
  if (!user) return unauthorized();

  const supabase = await createClient();
  const { error } = await supabase
    .from('user_profiles')
    .update({ analytics_opt_out_at: parsed.data.optOut ? new Date().toISOString() : null })
    .eq('id', user.id);
  if (error) return mapMutationError(error);

  // The /app layout hands AnalyticsGate the stored choice; refresh it so the gate
  // agrees with the switch on the next render.
  revalidatePath('/app', 'layout');
  return { ok: true, optedOut: parsed.data.optOut };
}
