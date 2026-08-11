import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { Database } from '../database.types';
import { requiredServerEnv } from '../env';

/**
 * The old `!` assertions weren't actually the silent-`undefined` hazard they
 * looked like: supabase-js's own constructor already throws synchronously if
 * either argument is falsy ('supabaseUrl is required.' / 'supabaseKey is
 * required.'), so a missing var never reached a network call unnoticed. What
 * this guard actually buys is a clearer message: naming the real env var
 * (`SUPABASE_SERVICE_ROLE_KEY`) instead of supabase-js's generic internal
 * parameter name (`supabaseKey`), which by itself doesn't say which of the
 * two env vars this factory reads was the one left unset.
 */
export const createServiceClient = () => {
  const supabaseUrl = requiredServerEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requiredServerEnv('SUPABASE_SERVICE_ROLE_KEY');
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};
