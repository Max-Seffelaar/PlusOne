import 'server-only';

import { createClient } from '@/lib/supabase/server';

export interface SessionRow {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  notAfter: string | null;
  userAgent: string | null;
  ip: string | null;
  aal: string | null;
  isCurrent: boolean;
}

// The caller's own active sessions (RPC reads auth.sessions for auth.uid()).
export async function listOwnSessions(): Promise<SessionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc('list_own_sessions');
  return (data ?? []).map((s) => ({
    sessionId: s.session_id,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    notAfter: s.not_after,
    userAgent: s.user_agent,
    ip: s.ip,
    aal: s.aal,
    isCurrent: s.is_current ?? false,
  }));
}

// A member's sessions, for the admin remote-logout screen. The RPC enforces
// admin-at-a-shared-venue + AAL2; on denial it errors and we surface nothing.
export async function adminListSessions(targetUserId: string): Promise<SessionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_list_user_sessions', {
    p_target: targetUserId,
  });
  if (error) return [];
  return (data ?? []).map((s) => ({
    sessionId: s.session_id,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    notAfter: s.not_after,
    userAgent: s.user_agent,
    ip: s.ip,
    aal: s.aal,
    isCurrent: false,
  }));
}
