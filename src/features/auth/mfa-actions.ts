'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/context';

export interface ActionState {
  ok: boolean;
  error?: string;
}

const snoozeSchema = z.enum(['week', 'never']);

// "Don't ask again" writes a far-future timestamp (not 'infinity' — that string
// round-trips awkwardly through PostgREST/JS Date; a year-9999 value behaves
// identically for the recommendation check and parses everywhere).
const NEVER = '9999-12-31T00:00:00Z';

/**
 * Snooze the MFA recommendation (#20 refinement 2026-07-02 — MFA is optional;
 * the enroll screen is a skippable nudge). 'week' = ask again in 7 days,
 * 'never' = don't ask again. Security: session verified server-side, input
 * through Zod, write scoped to the caller's own row (user_profiles_update_self).
 */
export async function snoozeMfaAction(choice: string): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };

  const parsed = snoozeSchema.safeParse(choice);
  if (!parsed.success) return { ok: false, error: 'Invalid choice.' };

  const until =
    parsed.data === 'never'
      ? NEVER
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const supabase = await createClient();
  const { error } = await supabase
    .from('user_profiles')
    .update({ mfa_snooze_until: until })
    .eq('id', user.id);
  if (error) return { ok: false, error: "Couldn't save your choice." };

  revalidatePath('/', 'layout');
  return { ok: true };
}
