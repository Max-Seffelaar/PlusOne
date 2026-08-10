import { createClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';

/**
 * Anon-key client for the public /api/health round-trip (86ey9ea00 #55) — a
 * public, middleware-exempt, unauthenticated, unrate-limited route has no
 * business holding an RLS-bypassing service-role credential. RLS filters every
 * table to zero rows for an anon caller with no session; that's fine — a
 * head+count query still proves Postgres/PostgREST is reachable and answering,
 * without ever touching row data or needing the privileged key.
 */
export const createHealthClient = () => {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
};
