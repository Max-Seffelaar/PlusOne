'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertAal2, AuthorizationError } from '@/lib/auth/guards';
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

  revalidatePath('/settings/profile');
  return { ok: true, message: 'Session ended.' };
}

/**
 * Remote-logout for admins (spec §5). AAL2 asserted in the app for good copy;
 * the RPC re-enforces admin-at-a-shared-venue + AAL2 as the real boundary.
 */
export async function adminRevokeSessionAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = sessionIdSchema.safeParse({ sessionId: formData.get('sessionId') });
  if (!parsed.success) return { ok: false, error: 'Invalid session.' };

  try {
    await assertAal2();
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return {
        ok: false,
        error: e.reason === 'aal2_required' ? 'This action needs MFA.' : "You're not logged in.",
      };
    }
    throw e;
  }

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
