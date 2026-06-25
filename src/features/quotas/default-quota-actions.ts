'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/context';
import type { VenueRole } from '@/features/auth/roles';
import { defaultQuotaSchema } from './schemas';

// Default-quota writes for the venue dashboard use the auth-feature ActionState
// shape (useActionState forms), separate from the request-flow actions.ts which
// uses the db-errors MutationError shape for its input-object callers.
export interface ActionState {
  ok: boolean;
  error?: string;
  message?: string;
}

async function callerRolesAt(venueId: string, userId: string): Promise<VenueRole[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('venue_memberships')
    .select('roles')
    .eq('venue_id', venueId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.roles ?? [];
}

/**
 * Set a member's default quota at a venue (decision #4, role matrix §2: quota is
 * admin-only and per-user). Security checklist: session verified server-side,
 * admin role confirmed in the app AND by RLS (quotas_insert/update_admin), input
 * through Zod. Quota grants are NOT MFA-gated (decision 2026-06-24: AAL2 is scoped
 * to invite / member add-remove-rolechange / remote-logout). The audit trigger
 * logs an increase as 'quota_grant'.
 */
export async function setDefaultQuotaAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };

  const parsed = defaultQuotaSchema.safeParse({
    venueId: formData.get('venueId'),
    userId: formData.get('userId'),
    defaultCount: formData.get('defaultCount'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details.' };
  }
  const { venueId, userId, defaultCount } = parsed.data;

  const callerRoles = await callerRolesAt(venueId, user.id);
  if (!callerRoles.includes('admin')) {
    return { ok: false, error: 'Only an admin can set allowances.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('quotas')
    .upsert({ venue_id: venueId, user_id: userId, default_count: defaultCount }, { onConflict: 'venue_id,user_id' });

  if (error) {
    console.error('setDefaultQuota: upsert failed', error.message);
    return { ok: false, error: "Couldn't save the allowance (no access)." };
  }

  revalidatePath('/admin/venue');
  return { ok: true, message: 'Allowance saved.' };
}
