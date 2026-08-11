'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { sessionIdSchema } from './schemas';

export interface ActionState {
  ok: boolean;
  error?: string;
  message?: string;
}

/** End one of your OWN sessions (RLS-equivalent guard lives in the RPC). */
export async function revokeOwnSessionAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = sessionIdSchema.safeParse({ sessionId: formData.get('sessionId') });
  if (!parsed.success) return { ok: false, error: 'Invalid session.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('revoke_own_session', {
    p_session_id: parsed.data.sessionId,
  });
  if (error || !data) return { ok: false, error: "Couldn't end the session." };

  revalidatePath('/app/profile'); // was '/settings/profile' — a dead route, no-op (86ey9ea00 #56)
  return { ok: true, message: 'Session ended.' };
}

/**
 * Remote-logout for admins (spec §5). The RPC enforces admin-at-a-shared-venue
 * as the boundary (role-only — MFA is optional since the #20 refinement).
 */
export async function adminRevokeSessionAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = sessionIdSchema.safeParse({ sessionId: formData.get('sessionId') });
  if (!parsed.success) return { ok: false, error: 'Invalid session.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_revoke_session', {
    p_session_id: parsed.data.sessionId,
  });
  if (error || !data) {
    return { ok: false, error: "Couldn't end the session (no access)." };
  }

  revalidatePath('/admin/sessions');
  return { ok: true, message: 'User logged out remotely.' };
}
